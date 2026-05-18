import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import type { ActiveBaseQuery } from '../routes/schemas';
import { addSqlParam, buildSqlInFilter } from '../utils/reportFilters';

type ActiveBaseRow = {
  processo: number | string;
  cnpj: string | null;
  razaosocial: string | null;
  credor: string;
  credor_status: string | null;
  processo_status_desc: string | null;
  processo_elegivel: number | string;
  vencimento_min: Date | string | null;
  vencimento_medio: Date | string | null;
};

type ActiveBaseCreditorRow = {
  credor: string;
  processos: number | string;
};

function formatDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

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

async function queryActiveBaseRows(prisma: PrismaClient, empresaId: number, filter: ActiveBaseQuery) {
  const params: unknown[] = [empresaId];
  const whereClause = activeBaseWhereClause(empresaId, filter, params);
  const limitParam = addSqlParam(params, filter.limit);

  return prisma.$queryRawUnsafe<ActiveBaseRow[]>(
    `
      WITH active_processes AS (
        SELECT
            d.processo,
            TRIM(d.cnpj) AS cnpj,
            TRIM(d.razaosocial) AS razaosocial,
            TRIM(c.grupo) AS credor,
            c.status AS credor_status,
            p.status_desc AS processo_status_desc
        FROM tb_devedor d
        JOIN tb_credor c ON c.id = d.idcredor
        LEFT JOIN tb_processo p ON p.processo = d.processo
        WHERE ${whereClause}
        ORDER BY TRIM(c.grupo), d.processo
        LIMIT ${limitParam}
      )
      SELECT
          b.processo,
          b.cnpj,
          b.razaosocial,
          b.credor,
          b.credor_status,
          b.processo_status_desc,
          1 AS processo_elegivel,
          v.vencimento_min,
          v.vencimento_medio
      FROM active_processes b
      LEFT JOIN LATERAL (
        SELECT
            MIN(t.vencimento)::date AS vencimento_min,
            (DATE '1970-01-01' + ROUND(AVG(t.vencimento::date - DATE '1970-01-01'))::int)::date AS vencimento_medio
        FROM tb_titulos t
        WHERE t.processo = b.processo
          AND t.vencimento IS NOT NULL
      ) v ON true
      ORDER BY b.credor, b.processo
    `,
    ...params
  );
}

export async function getActiveBase(filter: ActiveBaseQuery) {
  const results = await Promise.all(
    getLiveClients(filter.sistema).map(async ({ empresaId, prisma }) => {
      const [summary, rows] = await Promise.all([
        queryActiveBaseSummary(prisma, empresaId, filter),
        queryActiveBaseRows(prisma, empresaId, filter),
      ]);

      return { summary, rows };
    })
  );

  const byCreditor = new Map<string, number>();
  for (const result of results) {
    for (const row of result.summary) {
      const creditor = String(row.credor);
      byCreditor.set(creditor, (byCreditor.get(creditor) ?? 0) + Number(row.processos ?? 0));
    }
  }

  const rows = results.flatMap((result) => result.rows).map((row) => ({
    processo: String(row.processo),
    cnpj: row.cnpj ? String(row.cnpj) : '',
    razaosocial: row.razaosocial ? String(row.razaosocial) : '',
    credor: String(row.credor),
    credor_status: row.credor_status ? String(row.credor_status) : '',
    processo_status_desc: row.processo_status_desc ? String(row.processo_status_desc) : '',
    processo_elegivel: Number(row.processo_elegivel),
    vencimento_min: formatDate(row.vencimento_min),
    vencimento_medio: formatDate(row.vencimento_medio),
  }));

  const byCredor = Array.from(byCreditor.entries())
    .map(([credor, processos]) => ({ credor, processos }))
    .sort((a, b) => b.processos - a.processos || a.credor.localeCompare(b.credor, 'pt-BR'));

  return {
    data: {
      total_processos: byCredor.reduce((sum, row) => sum + row.processos, 0),
      total_credores: byCredor.length,
      limit: filter.limit,
      by_credor: byCredor,
      rows,
    },
  };
}
