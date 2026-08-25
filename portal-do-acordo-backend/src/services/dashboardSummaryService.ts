import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import type { BaseQuery } from '../routes/schemas';
import { addSqlParam, buildExcludedDashboardAccessFilter, buildExcludedDashboardCreditorFilter, buildSqlInFilter, getPeriodRange, NEGOTIATORS } from '../utils/reportFilters';
import { CACHE_TTL, cacheKey, getCached } from '../utils/cache';

type PaymentSummaryRow = {
  total_recuperado: number | string | null;
  capital_recuperado: number | string | null;
  faturamento: number | string | null;
  acordos_pagos: number | string | null;
};

type AgreementSummaryRow = {
  acordos: number | string | null;
  valor_acordos: number | string | null;
};

type AccessSummaryRow = {
  acessos: number | string | null;
  acessos_com_acordo: number | string | null;
};

type ResultSummary = {
  total_recuperado: number;
  capital_recuperado: number;
  faturamento: number;
  acordos: number;
  valor_acordos: number;
  acordos_pagos: number;
  acessos: number;
  acessos_com_acordo: number;
  conversao: number;
};

function previousPeriod(periodo?: string) {
  const range = getPeriodRange(periodo);
  const date = new Date(range.start);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function queryPaymentSummary(prisma: PrismaClient, empresaId: number, filter: BaseQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = NEGOTIATORS.map((negociador) => addSqlParam(params, negociador)).join(', ');
  const credorFilter = buildSqlInFilter("TRIM(COALESCE(c.grupo, 'OUTROS'))", filter.credores, params);

const rows = await prisma.$queryRawUnsafe<PaymentSummaryRow[]>(
    `
      SELECT
        -- O Total Real (Sem invenção de moda, o que veio da Cubo)
        COALESCE(SUM(COALESCE(b.totalpago, 0)), 0) AS total_recuperado,

        COALESCE(SUM(COALESCE(b.capitalpago, 0)), 0) AS capital_recuperado,

        -- Faturamento (Soma exata das taxas)
        COALESCE(SUM(
          COALESCE(b.honorariospago, 0) + 
          COALESCE(b.taxapago, 0) + 
          COALESCE(b.taxaadmpago, 0) + 
          COALESCE(b.taxaoutpago, 0) + 
          COALESCE(b.pdpago, 0) + 
          COALESCE(b.protestopago, 0)
        ), 0) AS faturamento,

        COUNT(DISTINCT b.processo)::bigint AS acordos_pagos
      FROM tb_baixas b
      INNER JOIN tb_recebimentos r ON r.id = b.idrecebimento
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND r.data_cad >= $2
        AND r.data_cad < $3
        AND b.negociador IN (${negociadores})
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        ${buildExcludedDashboardCreditorFilter('b.idcredor')}
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
    `,
    ...params
  );

  return rows[0];
}

async function queryAgreementSummary(prisma: PrismaClient, empresaId: number, filter: BaseQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = NEGOTIATORS.map((negociador) => addSqlParam(params, negociador)).join(', ');
  const credorFilter = buildSqlInFilter("TRIM(COALESCE(c.grupo, 'OUTROS'))", filter.credores, params);

  const rows = await prisma.$queryRawUnsafe<AgreementSummaryRow[]>(
    `
      SELECT
        COUNT(*)::bigint AS acordos,
        COALESCE(SUM(COALESCE(ac.tot_sub_total, 0)), 0) AS valor_acordos
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
    `,
    ...params
  );

  return rows[0];
}

async function queryAccessSummary(prisma: PrismaClient, empresaId: number, filter: BaseQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = NEGOTIATORS.map((negociador) => addSqlParam(params, negociador)).join(', ');
  const credorFilter = buildSqlInFilter("TRIM(COALESCE(b.credor, 'OUTROS'))", filter.credores, params);

  const rows = await prisma.$queryRawUnsafe<AccessSummaryRow[]>(
    `
      SELECT
        COUNT(*)::bigint AS acessos,
        COUNT(ac.id)::bigint AS acessos_com_acordo
      FROM tb_portal_neg_acessos a
      LEFT JOIN (
        SELECT DISTINCT tb_baixas.processo, tb_baixas.idempresa,
               TRIM(COALESCE(tb_credor.grupo, 'OUTROS')) AS credor
        FROM tb_baixas
        LEFT JOIN tb_recebimentos r ON r.id = tb_baixas.idrecebimento
        LEFT JOIN tb_credor ON tb_credor.id = tb_baixas.idcredor
        WHERE tb_baixas.idempresa = $1
          AND tb_baixas.totalpago > 0
          AND r.data_cad >= $2
          AND r.data_cad < $3
          AND tb_baixas.negociador IN (${negociadores})
          AND tb_baixas.idcredor IS NOT NULL
          ${buildExcludedDashboardCreditorFilter('tb_baixas.idcredor')}
          AND TRIM(COALESCE(tb_credor.grupo, '')) != ''
      ) b ON b.processo = a.processo AND b.idempresa = a.idempresa
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
        ${buildExcludedDashboardCreditorFilter('ac.idcredor')}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${buildExcludedDashboardAccessFilter('a')}
        ${credorFilter}
    `,
    ...params
  );

  return rows[0];
}

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function mergeSummary(rows: Array<{ payments: PaymentSummaryRow; agreements: AgreementSummaryRow; accesses: AccessSummaryRow }>): ResultSummary {
  const total = rows.reduce(
    (sum, row) => ({
      total_recuperado: sum.total_recuperado + toNumber(row.payments.total_recuperado),
      capital_recuperado: sum.capital_recuperado + toNumber(row.payments.capital_recuperado),
      faturamento: sum.faturamento + toNumber(row.payments.faturamento),
      acordos: sum.acordos + toNumber(row.agreements.acordos),
      valor_acordos: sum.valor_acordos + toNumber(row.agreements.valor_acordos),
      acordos_pagos: sum.acordos_pagos + toNumber(row.payments.acordos_pagos),
      acessos: sum.acessos + toNumber(row.accesses.acessos),
      acessos_com_acordo: sum.acessos_com_acordo + toNumber(row.accesses.acessos_com_acordo),
    }),
    { total_recuperado: 0, capital_recuperado: 0, faturamento: 0, acordos: 0, valor_acordos: 0, acordos_pagos: 0, acessos: 0, acessos_com_acordo: 0 }
  );

  return {
    ...total,
    conversao: total.acessos > 0 ? (total.acordos / total.acessos) * 100 : 0,
  };
}

async function buildResultSummary(filter: BaseQuery) {
  const rows = await Promise.all(
    getLiveClients(filter.sistema).map(({ empresaId, query }) =>
      query(async (prisma) => ({
        payments: await queryPaymentSummary(prisma, empresaId, filter),
        agreements: await queryAgreementSummary(prisma, empresaId, filter),
        accesses: await queryAccessSummary(prisma, empresaId, filter),
      }))
    )
  );

  return mergeSummary(rows);
}

export async function getDashboardResultSummary(filter: BaseQuery) {
  return getCached(cacheKey('dashboard-result-summary', filter), CACHE_TTL.RESULTS, async () => {
    const periodoAnterior = previousPeriod(filter.periodo);
    const [atual, anterior] = await Promise.all([
      buildResultSummary(filter),
      buildResultSummary({ ...filter, periodo: periodoAnterior }),
    ]);

    return {
      data: {
        periodo: filter.periodo ?? null,
        periodo_anterior: periodoAnterior,
        atual,
        anterior,
      },
    };
  });
}
