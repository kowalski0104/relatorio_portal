import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import { addSqlParam, buildSqlInFilter, getPeriodRange, NEGOTIATORS, ReportFilter } from '../utils/reportFilters';

type BaixaRow = {
  id: number | string;
  idempresa: number | string;
  data: Date | string;
  credor: string;
  negociador: string;
  processo: number | string;
  capital_pago: number | string;
  juros_pago: number | string;
  multa_pago: number | string;
  honorarios_pago_portal: number | string;
  total_pago_portal: number | string;
  taxa_pago: number | string;
  taxa_adm_pago: number | string;
};

async function queryPayments(prisma: PrismaClient, empresaId: number, filter: ReportFilter) {
  const periodo = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, periodo.start, periodo.end];
  const negociadores = NEGOTIATORS.map((negociador) => addSqlParam(params, negociador)).join(', ');
  const credorFilter = buildSqlInFilter("TRIM(COALESCE(c.grupo, 'OUTROS'))", filter.credores, params);

  const query = `
    SELECT
        b.id, b.idempresa, b.databaixa::date AS data,
        TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor,
        TRIM(COALESCE(b.negociador, 'SEM NEGOCIADOR')) AS negociador,
        b.processo,
        COALESCE(b.capitalpago, 0) AS capital_pago,
        COALESCE(b.jurospago, 0) AS juros_pago,
        COALESCE(b.multapago, 0) AS multa_pago,
        COALESCE(b.honorariospago, 0) AS honorarios_pago_portal,
        COALESCE(b.totalpago, 0) AS total_pago_portal,
        COALESCE(b.taxapago, 0) AS taxa_pago,
        COALESCE(b.taxaadmpago, 0) AS taxa_adm_pago
    FROM tb_baixas b
    LEFT JOIN tb_credor c ON c.id = b.idcredor
    WHERE b.idempresa = $1
      AND b.databaixa >= $2
      AND b.databaixa < $3
      AND b.negociador IN (${negociadores})
      AND b.totalpago > 0
      AND b.idcredor IS NOT NULL
      AND TRIM(COALESCE(c.grupo, '')) != ''
      ${credorFilter}
    ORDER BY b.databaixa DESC
  `;

  return prisma.$queryRawUnsafe<BaixaRow[]>(query, ...params);
}

export async function getPayments(filter: ReportFilter) {
  const results = await Promise.all(
    getLiveClients(filter.sistema).map(({ empresaId, prisma }) => queryPayments(prisma, empresaId, filter))
  );
  const allData = results.flat();

  return {
    data: allData.map(row => ({
      id: String(row.id),
      processo: String(row.processo),
      data: row.data instanceof Date ? row.data.toISOString().slice(0, 10) : String(row.data).slice(0, 10),
      sistema: Number(row.idempresa) === 401 ? 'consulth' : 'sisth',
      idempresa: Number(row.idempresa),
      credor: String(row.credor),
      negociador: String(row.negociador),
      capital_pago: Number(row.capital_pago),
      juros_pago: Number(row.juros_pago),
      multa_pago: Number(row.multa_pago),
      honorarios_pago_portal: Number(row.honorarios_pago_portal),
      total_pago_portal: Number(row.total_pago_portal),
      taxa_pago: Number(row.taxa_pago),
      taxa_adm_pago: Number(row.taxa_adm_pago),
    }))
  };
}



