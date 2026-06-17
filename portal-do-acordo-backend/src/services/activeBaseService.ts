import { promises as fs } from 'fs';
import path from 'path';
import { getLiveClients } from '../db/prismaClients';
import type { ActiveBaseQuery } from '../routes/schemas';
import type { PrismaClient } from '@prisma/client';
import { buildExcludedDashboardCreditorFilter, isExcludedDashboardCreditorName } from '../utils/reportFilters';

type SystemName = 'consulth' | 'sisth';
type AgingRange = '0-30' | '31-60' | '61-90' | '91-180' | '181-360' | '361-730' | '730+' | 'SEM VENCIMENTO';
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
  valor_total: number;
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
  valor_total: number | string | null;
};

const CACHE_FILE = process.env.ACTIVE_BASE_CACHE_FILE ?? path.resolve(process.cwd(), 'data', 'base_ativa_cache.json');
const REFRESH_HOUR = Number(process.env.ACTIVE_BASE_REFRESH_HOUR ?? 5);
const SUMMARY_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_SUMMARY_TIMEOUT_MS ?? 60000);
const AGING_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_AGING_TIMEOUT_MS ?? 180000);
const AGING_CREDITOR_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_AGING_CREDITOR_TIMEOUT_MS ?? 900000);
const AGING_BATCH_SIZE = Number(process.env.ACTIVE_BASE_AGING_BATCH_SIZE ?? 1000);
const REFRESHING_STALE_MS = Number(process.env.ACTIVE_BASE_REFRESHING_STALE_MS ?? 5 * 60 * 1000);
const AUTO_REFRESH_ON_START = process.env.ACTIVE_BASE_AUTO_REFRESH_ON_START === 'true';
const AGING_ORDER: AgingRange[] = ['0-30', '31-60', '61-90', '91-180', '181-360', '361-730', '730+', 'SEM VENCIMENTO'];
const AGING_ORDER_INDEX = new Map(AGING_ORDER.map((faixa, index) => [faixa, index]));
const LEGACY_AGING_RANGES = new Set(['0-90', '361+']);

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

function creditorKey(row: Pick<ActiveBaseCreditorCacheRow, 'sistema' | 'credor'>) {
  return `${row.sistema}::${row.credor}`;
}

function hasCompleteAging(creditors: ActiveBaseCreditorCacheRow[], aging: ActiveBaseAgingCacheRow[]) {
  if (creditors.length === 0) return false;
  if (aging.some((row) => LEGACY_AGING_RANGES.has(row.faixa))) return false;
  const agingKeys = new Set(aging.map(creditorKey));
  return creditors.every((row) => agingKeys.has(creditorKey(row))) && aging.every((row) => Number.isFinite(row.valor_total));
}

function pendingAgingCreditors(creditors: ActiveBaseCreditorCacheRow[], aging: ActiveBaseAgingCacheRow[]) {
  const agingKeys = new Set(aging.map(creditorKey));
  return creditors.filter((row) => !agingKeys.has(creditorKey(row)));
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
      const hasCreditorData = cache.by_credor.length > 0;
      const completeAging = hasCompleteAging(cache.by_credor, cache.aging);
      return {
        ...cache,
        status: completeAging ? 'ready' : hasCreditorData ? 'partial' : 'error',
        error: completeAging || hasCreditorData ? undefined : cache.error ?? 'Nao foi possivel atualizar as Bases.',
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

function companyFilter(_empresaId: number) {
  return buildExcludedDashboardCreditorFilter('c.id');
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
        LEFT JOIN tb_processo p ON p.processo = d.processo AND p.idempresa = d.idempresa
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

async function queryActiveBaseAgingForCreditor(prisma: PrismaClient, empresaId: number, credor: string) {
  const creditorRows = await withStatementTimeout(prisma, SUMMARY_TIMEOUT_MS, (tx) =>
    tx.$queryRawUnsafe<Array<{ id: number | string }>>(
      `
        SELECT c.id
        FROM tb_credor c
        WHERE c.idempresa = $1
          AND TRIM(c.grupo) = $2
          ${companyFilter(empresaId)}
          AND c.status = 'ATIVO'
      `,
      empresaId,
      credor
    )
  );
  const creditorIds = creditorRows.map((row) => Number(row.id));
  if (creditorIds.length === 0) return [];

  const countRows = await withStatementTimeout(prisma, SUMMARY_TIMEOUT_MS, (tx) =>
    tx.$queryRawUnsafe<Array<{ total: number | string }>>(
      `
        SELECT COUNT(*)::bigint AS total
        FROM (
          SELECT DISTINCT d.processo
          FROM tb_devedor d
          LEFT JOIN tb_processo p ON p.processo = d.processo AND p.idempresa = d.idempresa
          WHERE d.idempresa = $1
            AND d.idcredor = ANY($2::int[])
            AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUCAO','BAIXADO','QUITADO'))
        ) base
      `,
      empresaId,
      creditorIds
    )
  );

  const sistema = systemName(empresaId);
  const total = Number(countRows[0]?.total ?? 0);
  const totals = new Map<AgingRange, { processos: number; valor_total: number }>();

  for (let offset = 0; offset < total; offset += AGING_BATCH_SIZE) {
    const batchRows = await queryActiveBaseAgingBatch(prisma, empresaId, credor, creditorIds, AGING_BATCH_SIZE, offset);
    for (const row of batchRows) {
      const current = totals.get(row.faixa) ?? { processos: 0, valor_total: 0 };
      current.processos += Number(row.processos ?? 0);
      current.valor_total += Number(row.valor_total ?? 0);
      totals.set(row.faixa, current);
    }
  }

  return Array.from(totals.entries()).map(([faixa, totals]) => ({
    sistema,
    credor,
    faixa,
    processos: totals.processos,
    valor_total: totals.valor_total,
  }));
}

async function queryActiveBaseAgingBatch(prisma: PrismaClient, empresaId: number, credor: string, creditorIds: number[], limit: number, offset: number) {
  return withStatementTimeout(prisma, AGING_TIMEOUT_MS, (tx) =>
    tx.$queryRawUnsafe<ActiveBaseAgingRawRow[]>(
      `
        WITH selected_processes AS (
          SELECT processo
          FROM (
            SELECT DISTINCT d.processo
            FROM tb_devedor d
            LEFT JOIN tb_processo p ON p.processo = d.processo AND p.idempresa = d.idempresa
            WHERE d.idempresa = $1
              AND d.idcredor = ANY($2::int[])
              AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUCAO','BAIXADO','QUITADO'))
            ORDER BY d.processo
            LIMIT $3 OFFSET $4
          ) base
        ),
        active_debtors AS (
          SELECT DISTINCT d.id AS iddevedor, d.processo
          FROM tb_devedor d
          JOIN selected_processes sp ON sp.processo = d.processo
          WHERE d.idempresa = $1
            AND d.idcredor = ANY($2::int[])
        ),
        process_titles AS (
          SELECT
              sp.processo,
              MIN(t.vencimento)::date AS vencimento_min,
              COALESCE(SUM(COALESCE(t.valor, 0)), 0) AS valor_total
          FROM selected_processes sp
          LEFT JOIN active_debtors ad ON ad.processo = sp.processo
          LEFT JOIN tb_titulos t ON t.iddevedor = ad.iddevedor AND t.idempresa = $1 AND t.status = 'aberto'
          GROUP BY sp.processo
        )
        SELECT
            $5::text AS credor,
            CASE
              WHEN vencimento_min IS NULL THEN 'SEM VENCIMENTO'
              WHEN CURRENT_DATE - vencimento_min <= 30 THEN '0-30'
              WHEN CURRENT_DATE - vencimento_min <= 60 THEN '31-60'
              WHEN CURRENT_DATE - vencimento_min <= 90 THEN '61-90'
              WHEN CURRENT_DATE - vencimento_min <= 180 THEN '91-180'
              WHEN CURRENT_DATE - vencimento_min <= 360 THEN '181-360'
              WHEN CURRENT_DATE - vencimento_min <= 730 THEN '361-730'
              ELSE '730+'
            END AS faixa,
            COUNT(*)::bigint AS processos,
            COALESCE(SUM(valor_total), 0) AS valor_total
        FROM process_titles
        GROUP BY credor, faixa
        ORDER BY credor, faixa
      `,
      empresaId,
      creditorIds,
      limit,
      offset,
      credor
    )
  );
}

function mergeAgingRows(currentRows: ActiveBaseAgingCacheRow[], newRows: ActiveBaseAgingCacheRow[]) {
  const newKeys = new Set(newRows.map(creditorKey));
  return [...currentRows.filter((row) => !newKeys.has(creditorKey(row))), ...newRows];
}

async function queryActiveBaseAgingByCreditor(creditors: ActiveBaseCreditorCacheRow[], onProgress?: (rows: ActiveBaseAgingCacheRow[]) => Promise<void>) {
  const clientBySystem = new Map(getLiveClients('total').map(({ empresaId, query }) => [systemName(empresaId), { empresaId, query }]));
  const rows: ActiveBaseAgingCacheRow[] = [];
  const errors: string[] = [];

  for (const creditor of creditors) {
    const client = clientBySystem.get(creditor.sistema);
    if (!client) continue;

    try {
      rows.push(
        ...(await withHardTimeout(
          client.query((prisma) => queryActiveBaseAgingForCreditor(prisma, client.empresaId, creditor.credor)),
          AGING_CREDITOR_TIMEOUT_MS + 15000,
          `vencimentos ${creditor.sistema} ${creditor.credor}`
        ))
      );
      if (onProgress) await onProgress(rows);
    } catch (error) {
      errors.push(`vencimentos ${creditor.sistema} ${creditor.credor}: ${formatError(error)}`);
    }
  }

  return { rows, errors };
}

export async function refreshActiveBaseCache() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const current = await readCache();
    await writeCache({ ...current, status: 'refreshing', error: undefined });

    const errors: string[] = [];
    const creditorResults = await Promise.all(
      getLiveClients('total').map(async ({ empresaId, query }) => {
        const sistema = systemName(empresaId);
        try {
          return { sistema, rows: await withHardTimeout(query((prisma) => queryActiveBaseByCreditor(prisma, empresaId)), SUMMARY_TIMEOUT_MS + 15000, `base ativa ${sistema}`) };
        } catch (error) {
          return { sistema, rows: [], error: `${sistema}: ${formatError(error)}` };
        }
      })
    );
    const refreshedSystems = new Set(creditorResults.filter((result) => !result.error).map((result) => result.sistema));
    const preservedRows = current.by_credor.filter((row) => !refreshedSystems.has(row.sistema));
    const byCreditor = [...preservedRows, ...creditorResults.flatMap((result) => result.rows)];
    errors.push(...creditorResults.flatMap((result) => (result.error ? [result.error] : [])));

    if (byCreditor.length === 0) {
      const cache: ActiveBaseCache = {
        ...current,
        status: current.by_credor.length > 0 ? 'partial' : 'error',
        error: errors.join(' | ') || 'Nao foi possivel atualizar as Bases.',
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

    const validCreditorKeys = new Set(byCreditor.map(creditorKey));
    const existingAging = partialCache.aging.filter((row) => validCreditorKeys.has(creditorKey(row)));
    const pendingBeforeRefresh = pendingAgingCreditors(byCreditor, existingAging).sort((a, b) => a.processos - b.processos);
    const creditorsToRefresh = pendingBeforeRefresh.length > 0 ? pendingBeforeRefresh : [...byCreditor].sort((a, b) => a.processos - b.processos);

    const agingResult = await queryActiveBaseAgingByCreditor(creditorsToRefresh, async (progressRows) => {
      const progressAging = mergeAgingRows(existingAging, progressRows);
      await writeCache({
        ...partialCache,
        status: hasCompleteAging(byCreditor, progressAging) ? 'ready' : 'partial',
        aging_updated_at: new Date().toISOString(),
        aging: progressAging,
      });
    });
    const aging = mergeAgingRows(existingAging, agingResult.rows);
    errors.push(...agingResult.errors);

    const completeAging = hasCompleteAging(byCreditor, aging);
    const pending = pendingAgingCreditors(byCreditor, aging);
    const cache: ActiveBaseCache = {
      ...partialCache,
      aging_updated_at: aging.length > 0 ? new Date().toISOString() : partialCache.aging_updated_at,
      status: completeAging ? 'ready' : 'partial',
      error: errors.length > 0 ? errors.join(' | ') : pending.length > 0 ? `Vencimentos pendentes: ${pending.map((row) => `${row.sistema}/${row.credor}`).join(', ')}` : undefined,
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
  if (cache.status === 'empty' || (cache.status === 'error' && cache.by_credor.length === 0) || !hasCompleteAging(cache.by_credor, cache.aging)) {
    void refreshActiveBaseCache();
  }

  const selectedSystems = filter.sistema === 'total' ? new Set<SystemName>(['consulth', 'sisth']) : new Set<SystemName>([filter.sistema]);
  const selectedCreditors = new Set((filter.credores ?? []).map((creditor) => creditor.trim()).filter(Boolean));
  const creditorRows = cache.by_credor.filter((row) => !isExcludedDashboardCreditorName(row.credor) && selectedSystems.has(row.sistema) && (selectedCreditors.size === 0 || selectedCreditors.has(row.credor)));
  const agingRows = cache.aging.filter((row) =>
    AGING_ORDER_INDEX.has(row.faixa)
    && !LEGACY_AGING_RANGES.has(row.faixa)
    && !isExcludedDashboardCreditorName(row.credor)
    && selectedSystems.has(row.sistema)
    && (selectedCreditors.size === 0 || selectedCreditors.has(row.credor))
  );
  const agingComplete = hasCompleteAging(creditorRows, agingRows);
  const pending = pendingAgingCreditors(creditorRows, agingRows);

  const byCreditor = new Map<string, number>();
  const aging = new Map<AgingRange, { processos: number; valor_total: number }>([
    ['0-30', { processos: 0, valor_total: 0 }],
    ['31-60', { processos: 0, valor_total: 0 }],
    ['61-90', { processos: 0, valor_total: 0 }],
    ['91-180', { processos: 0, valor_total: 0 }],
    ['181-360', { processos: 0, valor_total: 0 }],
    ['361-730', { processos: 0, valor_total: 0 }],
    ['730+', { processos: 0, valor_total: 0 }],
    ['SEM VENCIMENTO', { processos: 0, valor_total: 0 }],
  ]);
  const agingByCreditor = new Map<string, { credor: string; faixa: AgingRange; processos: number; valor_total: number }>();

  for (const row of creditorRows) {
    byCreditor.set(row.credor, (byCreditor.get(row.credor) ?? 0) + row.processos);
  }

  for (const row of agingRows) {
    const total = aging.get(row.faixa) ?? { processos: 0, valor_total: 0 };
    total.processos += row.processos;
    total.valor_total += Number(row.valor_total ?? 0);
    aging.set(row.faixa, total);
    const key = `${row.credor}::${row.faixa}`;
    const current = agingByCreditor.get(key) ?? { credor: row.credor, faixa: row.faixa, processos: 0, valor_total: 0 };
    current.processos += row.processos;
    current.valor_total += Number(row.valor_total ?? 0);
    agingByCreditor.set(key, current);
  }

  return {
    data: {
      updated_at: cache.updated_at,
      aging_updated_at: cache.aging_updated_at,
      status: agingComplete ? 'ready' : cache.status === 'ready' ? 'partial' : cache.status,
      error: agingComplete ? undefined : pending.length > 0 ? `Vencimentos pendentes: ${pending.map((row) => `${row.sistema}/${row.credor}`).join(', ')}` : cache.error,
      total_processos: creditorRows.reduce((sum, row) => sum + row.processos, 0),
      total_credores: byCreditor.size,
      aging_complete: agingComplete,
      by_credor: Array.from(byCreditor.entries())
        .map(([credor, processos]) => ({ credor, processos }))
        .sort((a, b) => b.processos - a.processos || a.credor.localeCompare(b.credor, 'pt-BR')),
      aging: Array.from(aging.entries()).map(([faixa, totals]) => ({ faixa, ...totals })),
      aging_by_credor: Array.from(agingByCreditor.values()).sort((a, b) => a.credor.localeCompare(b.credor, 'pt-BR') || (AGING_ORDER_INDEX.get(a.faixa) ?? 99) - (AGING_ORDER_INDEX.get(b.faixa) ?? 99)),
    },
  };
}

export function startActiveBaseCacheScheduler() {
  if (schedulerStarted) return;
  schedulerStarted = true;

  if (AUTO_REFRESH_ON_START) void readCache().then((cache) => {
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
