import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import type { ActiveBaseQuery } from '../routes/schemas';
import { buildSqlInFilter } from '../utils/reportFilters';

type ActiveBaseCreditorRow = {
  credor: string;
  processos: number | string;
};

type ActiveBaseAgingRow = {
  faixa: '0-90' | '91-180' | '181-360' | '361+' | 'SEM VENCIMENTO';
  processos: number | string;
};

type ActiveBaseSummaryRow = {
  total_processos: number | string;
  total_credores: number | string;
};

const AGING_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_AGING_TIMEOUT_MS ?? 20000);

function activeBaseWhereClause(empresaId: number, filter: ActiveBaseQuery, params: unknown[]) {
  const sisthCredorFilter = empresaId === 1007 ? 'AND c.id != 31084' : '';
  const credorFilter = buildSqlInFilter('TRIM(c.grupo)', filter.credores, params);

  return `
    d.idempresa = $1
    ${sisthCredorFilter}
    AND c.status = 'ATIVO'
    AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUÇÃO','DEVOLUCAO','BAIXADO','QUITADO'))
    AND c.grupo IS NOT NULL
    AND TRIM(c.grupo) <> ''
    ${credorFilter}
  `;
}

async function queryActiveBaseSummary(prisma: PrismaClient, empresaId: number, filter: ActiveBaseQuery) {
  const params: unknown[] = [empresaId];
  const whereClause = activeBaseWhereClause(empresaId, filter, params);

  const rows = await prisma.$queryRawUnsafe<ActiveBaseSummaryRow[]>(
    `
      SELECT
          COUNT(*)::bigint AS total_processos,
          COUNT(DISTINCT TRIM(c.grupo))::bigint AS total_credores
      FROM tb_devedor d
      JOIN tb_credor c ON c.id = d.idcredor
      LEFT JOIN tb_processo p ON p.processo = d.processo
      WHERE ${whereClause}
    `,
    ...params
  );

  return rows[0] ?? { total_processos: 0, total_credores: 0 };
}

async function queryActiveBaseByCreditor(prisma: PrismaClient, empresaId: number, filter: ActiveBaseQuery) {
  const params: unknown[] = [empresaId];
  const whereClause = activeBaseWhereClause(empresaId, filter, params);

  return prisma.$queryRawUnsafe<ActiveBaseCreditorRow[]>(
    `
      SELECT
          TRIM(c.grupo) AS credor,
          COUNT(*)::bigint AS processos
      FROM tb_devedor d
      JOIN tb_credor c ON c.id = d.idcredor
      LEFT JOIN tb_processo p ON p.processo = d.processo
      WHERE ${whereClause}
      GROUP BY TRIM(c.grupo)
      ORDER BY processos DESC, credor
    `,
    ...params
  );
}

async function queryActiveBaseAging(prisma: PrismaClient, empresaId: number, filter: ActiveBaseQuery) {
  const params: unknown[] = [empresaId];
  const whereClause = activeBaseWhereClause(empresaId, filter, params);

  return prisma.$queryRawUnsafe<ActiveBaseAgingRow[]>(
    `
      WITH active_processes AS (
        SELECT d.processo
        FROM tb_devedor d
        JOIN tb_credor c ON c.id = d.idcredor
        LEFT JOIN tb_processo p ON p.processo = d.processo
        WHERE ${whereClause}
      ),
      process_due_dates AS (
        SELECT
            ap.processo,
            MIN(t.vencimento)::date AS vencimento_min
        FROM active_processes ap
        JOIN tb_titulos t ON t.processo = ap.processo
        WHERE t.vencimento IS NOT NULL
        GROUP BY ap.processo
      )
      SELECT
          CASE
            WHEN CURRENT_DATE - vencimento_min <= 90 THEN '0-90'
            WHEN CURRENT_DATE - vencimento_min <= 180 THEN '91-180'
            WHEN CURRENT_DATE - vencimento_min <= 360 THEN '181-360'
            ELSE '361+'
          END AS faixa,
          COUNT(*)::bigint AS processos
      FROM process_due_dates
      GROUP BY faixa
    `,
    ...params
  );
}

async function withTimeout<T>(promise: Promise<T>, fallback: T, timeoutMs: number) {
  let timer: NodeJS.Timeout | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<T>((resolve) => {
        timer = setTimeout(() => resolve(fallback), timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

export async function getActiveBase(filter: ActiveBaseQuery) {
  const results = await Promise.all(
    getLiveClients(filter.sistema).map(async ({ empresaId, prisma }) => {
      const [summary, byCreditor] = await Promise.all([
        queryActiveBaseSummary(prisma, empresaId, filter),
        queryActiveBaseByCreditor(prisma, empresaId, filter),
      ]);
      const aging = await withTimeout(queryActiveBaseAging(prisma, empresaId, filter), [], AGING_TIMEOUT_MS);

      return { summary, byCreditor, aging };
    })
  );

  const byCreditor = new Map<string, number>();
  const aging = new Map<string, number>([
    ['0-90', 0],
    ['91-180', 0],
    ['181-360', 0],
    ['361+', 0],
  ]);

  let totalProcessos = 0;
  let totalCredores = 0;
  let agingComplete = true;

  for (const result of results) {
    totalProcessos += Number(result.summary.total_processos ?? 0);
    totalCredores += Number(result.summary.total_credores ?? 0);
    if (result.aging.length === 0) agingComplete = false;

    for (const row of result.byCreditor) {
      const creditor = String(row.credor);
      byCreditor.set(creditor, (byCreditor.get(creditor) ?? 0) + Number(row.processos ?? 0));
    }

    for (const row of result.aging) {
      const range = String(row.faixa);
      aging.set(range, (aging.get(range) ?? 0) + Number(row.processos ?? 0));
    }
  }

  return {
    data: {
      total_processos: totalProcessos,
      total_credores: totalCredores,
      aging_complete: agingComplete,
      by_credor: Array.from(byCreditor.entries())
        .map(([credor, processos]) => ({ credor, processos }))
        .sort((a, b) => b.processos - a.processos || a.credor.localeCompare(b.credor, 'pt-BR')),
      aging: Array.from(aging.entries()).map(([faixa, processos]) => ({ faixa, processos })),
    },
  };
}
