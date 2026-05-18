import { promises as fs } from 'fs';
import path from 'path';
import { getLiveClients } from '../db/prismaClients';
import type { ActiveBaseQuery } from '../routes/schemas';
import type { PrismaClient } from '@prisma/client';

type SystemName = 'consulth' | 'sisth';
type AgingRange = '0-90' | '91-180' | '181-360' | '361+' | 'SEM VENCIMENTO';

type ActiveBaseCacheRow = {
  sistema: SystemName;
  credor: string;
  faixa: AgingRange;
  processos: number;
};

type ActiveBaseCache = {
  updated_at: string | null;
  status: 'empty' | 'refreshing' | 'ready' | 'error';
  error?: string;
  rows: ActiveBaseCacheRow[];
};

type ActiveBaseRawRow = {
  credor: string;
  faixa: AgingRange;
  processos: number | string;
};

const CACHE_FILE = process.env.ACTIVE_BASE_CACHE_FILE ?? path.resolve(process.cwd(), 'data', 'base_ativa_cache.json');
const REFRESH_HOUR = Number(process.env.ACTIVE_BASE_REFRESH_HOUR ?? 5);

let refreshPromise: Promise<ActiveBaseCache> | null = null;
let schedulerStarted = false;

function emptyCache(): ActiveBaseCache {
  return { updated_at: null, status: 'empty', rows: [] };
}

async function readCache(): Promise<ActiveBaseCache> {
  try {
    const raw = await fs.readFile(CACHE_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<ActiveBaseCache>;
    return {
      updated_at: parsed.updated_at ?? null,
      status: parsed.status ?? 'empty',
      error: parsed.error,
      rows: Array.isArray(parsed.rows) ? parsed.rows : [],
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return emptyCache();
    throw error;
  }
}

async function writeCache(cache: ActiveBaseCache) {
  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}

async function queryActiveBaseCacheRows(prisma: PrismaClient, empresaId: number) {
  const sisthCredorFilter = empresaId === 1007 ? 'AND c.id != 31084' : '';

  return prisma.$queryRawUnsafe<ActiveBaseRawRow[]>(
    `
      WITH active_processes AS (
        SELECT
            d.processo,
            TRIM(c.grupo) AS credor
        FROM tb_devedor d
        JOIN tb_credor c ON c.id = d.idcredor
        LEFT JOIN tb_processo p ON p.processo = d.processo
        WHERE d.idempresa = $1
          ${sisthCredorFilter}
          AND c.status = 'ATIVO'
          AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUÇÃO','DEVOLUCAO','BAIXADO','QUITADO'))
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
  );
}

export async function refreshActiveBaseCache() {
  if (refreshPromise) return refreshPromise;

  refreshPromise = (async () => {
    const current = await readCache();
    await writeCache({ ...current, status: 'refreshing', error: undefined });

    try {
      const rows: ActiveBaseCacheRow[] = [];
      for (const { empresaId, prisma } of getLiveClients('total')) {
        const sistema: SystemName = empresaId === 401 ? 'consulth' : 'sisth';
        const result = await queryActiveBaseCacheRows(prisma, empresaId);
        rows.push(
          ...result.map((row) => ({
            sistema,
            credor: String(row.credor),
            faixa: row.faixa,
            processos: Number(row.processos ?? 0),
          }))
        );
      }

      const cache: ActiveBaseCache = {
        updated_at: new Date().toISOString(),
        status: 'ready',
        rows,
      };
      await writeCache(cache);
      return cache;
    } catch (error) {
      const fallback = await readCache();
      const cache: ActiveBaseCache = {
        ...fallback,
        status: fallback.rows.length > 0 ? 'ready' : 'error',
        error: error instanceof Error ? error.message : 'Erro ao atualizar base ativa.',
      };
      await writeCache(cache);
      return cache;
    } finally {
      refreshPromise = null;
    }
  })();

  return refreshPromise;
}

export async function getActiveBase(filter: ActiveBaseQuery) {
  const cache = await readCache();
  if (cache.status === 'empty' || cache.status === 'refreshing') {
    void refreshActiveBaseCache();
  }

  const selectedSystems = filter.sistema === 'total' ? new Set<SystemName>(['consulth', 'sisth']) : new Set<SystemName>([filter.sistema]);
  const selectedCreditors = new Set((filter.credores ?? []).map((creditor) => creditor.trim()).filter(Boolean));
  const rows = cache.rows.filter((row) => selectedSystems.has(row.sistema) && (selectedCreditors.size === 0 || selectedCreditors.has(row.credor)));

  const byCreditor = new Map<string, number>();
  const aging = new Map<AgingRange, number>([
    ['0-90', 0],
    ['91-180', 0],
    ['181-360', 0],
    ['361+', 0],
    ['SEM VENCIMENTO', 0],
  ]);

  for (const row of rows) {
    byCreditor.set(row.credor, (byCreditor.get(row.credor) ?? 0) + row.processos);
    aging.set(row.faixa, (aging.get(row.faixa) ?? 0) + row.processos);
  }

  return {
    data: {
      updated_at: cache.updated_at,
      status: cache.status,
      error: cache.error,
      total_processos: rows.reduce((sum, row) => sum + row.processos, 0),
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
    if (cache.status === 'empty' || cache.status === 'refreshing') void refreshActiveBaseCache();
  });

  setInterval(() => {
    const now = new Date();
    if (now.getHours() === REFRESH_HOUR && now.getMinutes() < 10) {
      void refreshActiveBaseCache();
    }
  }, 10 * 60 * 1000);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}
