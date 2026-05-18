import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import { buildSqlInFilter, ReportFilter } from '../utils/reportFilters';

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

function formatDate(value: Date | string | null) {
  if (!value) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

async function queryActiveBase(prisma: PrismaClient, empresaId: number, filter: ReportFilter) {
  const params: unknown[] = [empresaId];
  const sisthCredorFilter = empresaId === 1007 ? 'AND c.id != 31084' : '';
  const credorFilter = buildSqlInFilter('TRIM(c.grupo)', filter.credores, params);

  const query = `
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
      WHERE d.idempresa = $1
        ${sisthCredorFilter}
        AND c.status = 'ATIVO'
        AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUÇÃO','DEVOLUCAO','BAIXADO','QUITADO'))
        AND c.grupo IS NOT NULL
        AND TRIM(c.grupo) <> ''
        ${credorFilter}
    )
    SELECT
        b.processo,
        b.cnpj,
        b.razaosocial,
        b.credor,
        b.credor_status,
        b.processo_status_desc,
        1 AS processo_elegivel,
        MIN(t.vencimento)::date AS vencimento_min,
        (DATE '1970-01-01' + ROUND(AVG(t.vencimento::date - DATE '1970-01-01'))::int)::date AS vencimento_medio
    FROM active_processes b
    LEFT JOIN tb_titulos t ON t.processo = b.processo AND t.vencimento IS NOT NULL
    GROUP BY
        b.processo,
        b.cnpj,
        b.razaosocial,
        b.credor,
        b.credor_status,
        b.processo_status_desc
    ORDER BY b.credor, b.processo
  `;

  return prisma.$queryRawUnsafe<ActiveBaseRow[]>(query, ...params);
}

export async function getActiveBase(filter: ReportFilter) {
  const results = await Promise.all(
    getLiveClients(filter.sistema).map(({ empresaId, prisma }) => queryActiveBase(prisma, empresaId, filter))
  );

  return {
    data: results.flat().map((row) => ({
      processo: String(row.processo),
      cnpj: row.cnpj ? String(row.cnpj) : '',
      razaosocial: row.razaosocial ? String(row.razaosocial) : '',
      credor: String(row.credor),
      credor_status: row.credor_status ? String(row.credor_status) : '',
      processo_status_desc: row.processo_status_desc ? String(row.processo_status_desc) : '',
      processo_elegivel: Number(row.processo_elegivel),
      vencimento_min: formatDate(row.vencimento_min),
      vencimento_medio: formatDate(row.vencimento_medio),
    })),
  };
}
