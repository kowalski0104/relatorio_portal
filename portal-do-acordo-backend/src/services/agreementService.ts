import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import { addSqlParam, buildExcludedDashboardCreditorFilter, buildSqlInFilter, getPeriodRange, NEGOTIATORS, ReportFilter } from '../utils/reportFilters';

type AcordoRow = {
  id: number | string;
  idempresa: number | string;
  data: Date | string;
  hora: number | string | null;
  credor: string;
  negociador: string;
  processo: number | string;
  tot_sub_total: number | string;
  tot_ho: number | string;
  status: string;
};

async function queryAgreements(prisma: PrismaClient, empresaId: number, filter: ReportFilter) {
  const periodo = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, periodo.start, periodo.end];
  const negociadores = NEGOTIATORS.map((negociador) => addSqlParam(params, negociador)).join(', ');
  const credorFilter = buildSqlInFilter("TRIM(COALESCE(c.grupo, 'OUTROS'))", filter.credores, params);

  const query = `
    SELECT
        ac.id, ac.idempresa, ac.data_acordo::date AS data,
        CASE
          WHEN TRIM(COALESCE(ac.hora_acordo, '')) ~ '^[0-9]{1,2}'
          THEN LEAST(SUBSTRING(TRIM(ac.hora_acordo) FROM '^[0-9]{1,2}')::int, 23)
          ELSE 0
        END AS hora,
        TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor,
        TRIM(COALESCE(ac.negociador, 'SEM NEGOCIADOR')) AS negociador,
        ac.processo,
        COALESCE(ac.tot_sub_total, 0) AS tot_sub_total,
        COALESCE(ac.tot_ho, 0) AS tot_ho,
        ac.status
    FROM tb_acordo ac
    LEFT JOIN tb_credor c ON c.id = ac.idcredor
    WHERE ac.idempresa = $1
      ${buildExcludedDashboardCreditorFilter('ac.idcredor')}
      AND ac.data_acordo >= $2
      AND ac.data_acordo < $3
      AND ac.negociador IN (${negociadores})
      AND ac.status = 'ANDAMENTO'
      AND ac.idcredor IS NOT NULL
      AND TRIM(COALESCE(c.grupo, '')) != ''
      ${credorFilter}
    ORDER BY ac.data_acordo DESC
  `;

  return prisma.$queryRawUnsafe<AcordoRow[]>(query, ...params);
}

export async function getAgreements(filter: ReportFilter) {
  const results = await Promise.all(
    getLiveClients(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryAgreements(prisma, empresaId, filter)))
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
      credor: String(row.credor),
      negociador: String(row.negociador),
      tot_sub_total: Number(row.tot_sub_total),
      tot_ho: Number(row.tot_ho),
      status: String(row.status),
    }))
  };
}



