import { promises as fs } from 'fs';
import path from 'path';
import { getLiveClients } from '../db/prismaClients';
import type { ActiveBaseQuery } from '../routes/schemas';
import type { PrismaClient } from '@prisma/client';

type SystemName = 'consulth' | 'sisth';
type AgingRange = '0-90' | '91-180' | '181-360' | '361+' | 'SEM VENCIMENTO';
type CacheStatus = 'empty' | 'refreshing' | 'partial' | 'ready' | 'error';
type PrismaExecutor = Pick<PrismaClient, '$executeRawUnsafe' | '$queryRawUnsafe'>;

type ActiveBaseCreditorCacheRow = {
  sistema: SystemName;
  credor: string;
  processos: number;
};

type ActiveBaseAgingCacheRow = {
  sistema: SystemName;
  credor: string;
  faixa: AgingRange;
  processos: number;
};

type ActiveBaseCache = {
  updated_at: string | null;
  aging_updated_at: string | null;
  status: CacheStatus;
  error?: string;
  by_credor: ActiveBaseCreditorCacheRow[];
  aging: ActiveBaseAgingCacheRow[];
};

type ActiveBaseCreditorRawRow = {
  credor: string;
  processos: number | string;
};

type ActiveBaseAgingRawRow = {
  credor: string;
  faixa: AgingRange;
  processos: number | string;
};

const CACHE_FILE = process.env.ACTIVE_BASE_CACHE_FILE ?? path.resolve(process.cwd(), 'data', 'base_ativa_cache.json');
const REFRESH_HOUR = Number(process.env.ACTIVE_BASE_REFRESH_HOUR ?? 5);
const SUMMARY_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_SUMMARY_TIMEOUT_MS ?? 60000);
const AGING_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_AGING_TIMEOUT_MS ?? 180000);
const REFRESHING_STALE_MS = Number(process.env.ACTIVE_BASE_REFRESHING_STALE_MS ?? 5 * 60 * 1000);

let refreshPromise: Promise<ActiveBaseCache> | null = null;
let schedulerStarted = false;

function emptyCache(): ActiveBaseCache {
  return {
    updated_at: null,
    aging_updated_at: null,
    status: 'empty',
    by_credor: [],
    aging: [],
  };
}

async function readCache(): Promise<ActiveBaseCache> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ActiveBaseCache> & {
      rows?: ActiveBaseAgingCacheRow[];
    };

    const cache: ActiveBaseCache = {
      updated_at: parsed.updated_at ?? null,
      aging_updated_at: parsed.aging_updated_at ?? null,
      status: parsed.status ?? 'empty',
      error: parsed.error,
      by_credor: Array.isArray(parsed.by_credor) ? parsed.by_credor : [],
      aging: Array.isArray(parsed.aging) ? parsed.aging : Array.isArray(parsed.rows) ? parsed.rows : [],
    };

    if (cache.status === 'refreshing' && cache.updated_at && Date.now() - new Date(cache.updated_at).getTime() > REFRESHING_STALE_MS) {
      return {
        ...cache,
        status: cache.by_credor.length > 0 ? 'partial' : 'error',
        error: cache.error ?? 'Atualização anterior interrompida antes de concluir vencimentos.',
      };
    }

    return cache;
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return emptyCache();
    throw error;
  }
}

async function writeCache(cache: ActiveBaseCache) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

async function withStatementTimeout<T>(prisma: PrismaClient, timeoutMs: number, query: (tx: PrismaExecutor) => Promise<T>) {
  return prisma.$transaction(
    async (tx) => {
      await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(timeoutMs, 1000)}`);
      return query(tx);
    },
    { timeout: timeoutMs + 5000, maxWait: 10000 }
  );
}

async function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const guardedPromise = promise.catch((error) => {
    throw error;
  });
  guardedPromise.catch(() => undefined);

  try {
    return await Promise.race([
      guardedPromise,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} excedeu ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function companyFilter(empresaId: number) {
  return empresaId === 1007 ? 'AND c.id != 31084' : '';
}

function systemName(empresaId: number): SystemName {
  return empresaId === 401 ? 'consulth' : 'sisth';
}

async function queryActiveBaseByCreditor(prisma: PrismaClient, empresaId: number) {
  const rows = await withStatementTimeout(prisma, SUMMARY_TIMEOUT_MS, (tx) =>
    tx.$queryRawUnsafe<ActiveBaseCreditorRawRow[]>(
      `
        SELECT
            TRIM(c.grupo) AS credor,
            COUNT(*)::bigint AS processos
        FROM tb_devedor d
        JOIN tb_credor c ON c.id = d.idcredor
        LEFT JOIN tb_processo p ON p.processo = d.processo
        WHERE d.idempresa = $1
          ${companyFilter(empresaId)}
          AND c.status = 'ATIVO'
          AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUCAO','BAIXADO','QUITADO'))
          AND c.grupo IS NOT NULL
          AND TRIM(c.grupo) <> ''
        GROUP BY TRIM(c.grupo)
        ORDER BY processos DESC, credor
      `,
      empresaId
    )
  );

  const sistema = systemName(empresaId);
  return rows.map((row) => ({
    sistema,
    credor: String(row.credor),
    processos: Number(row.processos ?? 0),
  }));
}

async function queryActiveBaseAging(prisma: PrismaClient, empresaId: number) {
  const rows = await withStatementTimeout(prisma, AGING_TIMEOUT_MS, (tx) =>
    tx.$queryRawUnsafe<ActiveBaseAgingRawRow[]>(
      `
        WITH active_processes AS (
          SELECT DISTINCT
              d.processo,
              TRIM(c.grupo) AS credor
          FROM tb_devedor d
          JOIN tb_credor c ON c.id = d.idcredor
          LEFT JOIN tb_processo p ON p.processo = d.processo
          WHERE d.idempresa = $1
            ${companyFilter(empresaId)}
            AND c.status = 'ATIVO'
            AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUCAO','BAIXADO','QUITADO'))
            AND c.grupo IS NOT NULL
            AND TRIM(c.grupo) <> ''
        ),
        process_due_dates AS (
          SELECT
              ap.processo,
              ap.credor,
              MIN(t.vencimento)::date AS vencimento_min
          FROM active_processes ap
          LEFT JOIN tb_titulos t ON t.processo = ap.processo AND t.vencimento IS NOT NULL
          GROUP BY ap.processo, ap.credor
        )
        SELECT
            credor,
            CASE
              WHEN vencimento_min IS NULL THEN 'SEM VENCIMENTO'
              WHEN CURRENT_DATE - vencimento_min <= 90 THEN '0-90'
              WHEN CURRENT_DATE - vencimento_min <= 180 THEN '91-180'
              WHEN CURRENT_DATE - vencimento_min <= 360 THEN '181-360'
              ELSE '361+'
            END AS faixa,
            COUNT(*)::bigint AS processos
        FROM process_due_dates
        GROUP BY credor, faixa
        ORDER BY credor, faixa
      `,
      empresaId
    )
  );

  const sistema = systemName(empresaId);
  return rows.map((row) => ({
    sistema,
    credor: String(row.credor),
    faixa: row.faixa,
    processos: Number(row.processos ?? 0),
  }));
}

export async function refreshActiveBaseCache() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const current = await readCache();
    await writeCache({ ...current, status: 'refreshing', error: undefined });

    const errors: string[] = [];
    const creditorResults = await Promise.all(
      getLiveClients('total').map(async ({ empresaId, prisma }) => {
        try {
          return { rows: await withHardTimeout(queryActiveBaseByCreditor(prisma, empresaId), SUMMARY_TIMEOUT_MS + 15000, `base ativa ${systemName(empresaId)}`) };
        } catch (error) {
          return { rows: [], error: `${systemName(empresaId)}: ${formatError(error)}` };
        }
      })
    );
    const byCreditor = creditorResults.flatMap((result) => result.rows);
    errors.push(...creditorResults.flatMap((result) => (result.error ? [result.error] : [])));

    if (byCreditor.length === 0) {
      const cache: ActiveBaseCache = {
        ...current,
        status: current.by_credor.length > 0 ? 'partial' : 'error',
        error: errors.join(' | ') || 'Não foi possível atualizar a Base Ativa.',
      };
      await writeCache(cache);
      refreshPromise = null;
      return cache;
    }

    const partialCache: ActiveBaseCache = {
      ...current,
      updated_at: new Date().toISOString(),
      status: 'refreshing',
      error: errors.length > 0 ? errors.join(' | ') : undefined,
      by_credor: byCreditor,
    };
    await writeCache(partialCache);

    const agingResults = await Promise.all(
      getLiveClients('total').map(async ({ empresaId, prisma }) => {
        try {
          return { rows: await withHardTimeout(queryActiveBaseAging(prisma, empresaId), AGING_TIMEOUT_MS + 15000, `vencimentos ${systemName(empresaId)}`) };
        } catch (error) {
          return { rows: [], error: `vencimentos ${systemName(empresaId)}: ${formatError(error)}` };
        }
      })
    );
    const aging = agingResults.flatMap((result) => result.rows);
    errors.push(...agingResults.flatMap((result) => (result.error ? [result.error] : [])));

    const cache: ActiveBaseCache = {
      ...partialCache,
      aging_updated_at: aging.length > 0 ? new Date().toISOString() : partialCache.aging_updated_at,
      status: aging.length > 0 ? 'ready' : 'partial',
      error: errors.length > 0 ? errors.join(' | ') : undefined,
      aging: aging.length > 0 ? aging : partialCache.aging,
    };
    await writeCache(cache);
    refreshPromise = null;
    return cache;
  })();

  return refreshPromise;
}

export async function getActiveBase(filter: ActiveBaseQuery) {
  const cache = await readCache();
  if (cache.status === 'empty' || (cache.status === 'error' && cache.by_credor.length === 0)) {
    void refreshActiveBaseCache();
  }

  const selectedSystems = filter.sistema === 'total' ? new Set<SystemName>(['consulth', 'sisth']) : new Set<SystemName>([filter.sistema]);
  const selectedCreditors = new Set((filter.credores ?? []).map((creditor) => creditor.trim()).filter(Boolean));
  const creditorRows = cache.by_credor.filter((row) => selectedSystems.has(row.sistema) && (selectedCreditors.size === 0 || selectedCreditors.has(row.credor)));
  const agingRows = cache.aging.filter((row) => selectedSystems.has(row.sistema) && (selectedCreditors.size === 0 || selectedCreditors.has(row.credor)));

  const byCreditor = new Map<string, number>();
  const aging = new Map<AgingRange, number>([
    ['0-90', 0],
    ['91-180', 0],
    ['181-360', 0],
    ['361+', 0],
    ['SEM VENCIMENTO', 0],
  ]);

  for (const row of creditorRows) {
    byCreditor.set(row.credor, (byCreditor.get(row.credor) ?? 0) + row.processos);
  }

  for (const row of agingRows) {
    aging.set(row.faixa, (aging.get(row.faixa) ?? 0) + row.processos);
  }

  return {
    data: {
      updated_at: cache.updated_at,
      aging_updated_at: cache.aging_updated_at,
      status: cache.status,
      error: cache.error,
      total_processos: creditorRows.reduce((sum, row) => sum + row.processos, 0),
      total_credores: byCreditor.size,
      aging_complete: cache.status === 'ready',
      by_credor: Array.from(byCreditor.entries())
        .map(([credor, processos]) => ({ credor, processos }))
        .sort((a, b) => b.processos - a.processos || a.credor.localeCompare(b.credor, 'pt-BR')),
      aging: Array.from(aging.entries()).map(([faixa, processos]) => ({ faixa, processos })),
    },
  };
}

export function startActiveBaseCacheScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  void readCache().then((cache) => {
    if (cache.status === 'empty' || (cache.status === 'error' && cache.by_credor.length === 0)) void refreshActiveBaseCache();
  });

  setInterval(() => {
    const now = new Date();
    if (now.getHours() === REFRESH_HOUR && now.getMinutes() < 10) {
      void refreshActiveBaseCache();
    }
  }, 10 * 60 * 1000);
}

function formatError(error: unknown) {
  return error instanceof Error ? error.message : 'erro desconhecido';
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
