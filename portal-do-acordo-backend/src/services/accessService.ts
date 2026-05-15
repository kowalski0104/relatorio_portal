import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import { addSqlParam, buildSqlInFilter, getPeriodRange, NEGOTIATORS, ReportFilter } from '../utils/reportFilters';

type AcessoRow = {
  id: number | string;
  idempresa: number | string;
  data: Date | string;
  hora: number | string | null;
  credor: string | null;
  processo: number | string;
  situacao: 'COM ACORDO' | 'SEM ACORDO';
};

async function queryAccesses(prisma: PrismaClient, empresaId: number, filter: ReportFilter) {
  const periodo = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, periodo.start, periodo.end];
  const negociadores = NEGOTIATORS.map((negociador) => addSqlParam(params, negociador)).join(', ');
  const credorFilter = buildSqlInFilter("TRIM(COALESCE(b.credor, 'OUTROS'))", filter.credores, params);

  const query = `
    SELECT
        a.id, a.idempresa, a.data_cad::date AS data,
        CASE
          WHEN TRIM(COALESCE(a.hora_cad, '')) ~ '^[0-9]{1,2}'
          THEN LEAST(SUBSTRING(TRIM(a.hora_cad) FROM '^[0-9]{1,2}')::int, 23)
          ELSE 0
        END AS hora,
        TRIM(COALESCE(b.credor, 'OUTROS')) AS credor,
        a.processo,
        CASE
            WHEN ac.id IS NOT NULL THEN 'COM ACORDO'
            ELSE 'SEM ACORDO'
        END AS situacao
    FROM tb_portal_neg_acessos a
    LEFT JOIN (
        SELECT DISTINCT tb_baixas.processo, tb_baixas.idempresa,
               TRIM(COALESCE(tb_credor.grupo, 'OUTROS')) AS credor
        FROM tb_baixas
        LEFT JOIN tb_credor ON tb_credor.id = tb_baixas.idcredor
        WHERE tb_baixas.totalpago > 0
          AND tb_baixas.databaixa >= $2
          AND tb_baixas.databaixa < $3
          AND tb_baixas.negociador IN (${negociadores})
          AND tb_baixas.idcredor IS NOT NULL
          AND TRIM(COALESCE(tb_credor.grupo, '')) != ''
    ) b ON b.processo = a.processo AND b.idempresa = a.idempresa
    LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
    WHERE a.idempresa = $1
      AND a.data_cad >= $2
      AND a.data_cad < $3
      ${credorFilter}
    ORDER BY a.data_cad DESC
  `;

  return prisma.$queryRawUnsafe<AcessoRow[]>(query, ...params);
}

export async function getAccesses(filter: ReportFilter) {
  const results = await Promise.all(
    getLiveClients(filter.sistema).map(({ empresaId, prisma }) => queryAccesses(prisma, empresaId, filter))
  );
  const allData = results.flat();

  return {
    data: allData.map(row => ({
      id: String(row.id),
      processo: String(row.processo),
      data: row.data instanceof Date ? row.data.toISOString().slice(0, 10) : String(row.data).slice(0, 10),
      hora: Number(row.hora ?? 0),
      sistema: Number(row.idempresa) === 401 ? 'consulth' : 'sisth',
      idempresa: Number(row.idempresa),
      credor: row.credor ? String(row.credor) : null,
      situacao: String(row.situacao) as 'COM ACORDO' | 'SEM ACORDO',
    }))
  };
}



