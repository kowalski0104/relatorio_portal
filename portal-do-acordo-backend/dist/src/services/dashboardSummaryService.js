"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardResultSummary = getDashboardResultSummary;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
const cache_1 = require("../utils/cache");
function previousPeriod(periodo) {
    const range = (0, reportFilters_1.getPeriodRange)(periodo);
    const date = new Date(range.start);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
async function queryPaymentSummary(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)("TRIM(COALESCE(c.grupo, 'OUTROS'))", filter.credores, params);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(COALESCE(b.capitalpago, 0) + COALESCE(b.jurospago, 0) + COALESCE(b.multapago, 0) + COALESCE(b.honorariospago, 0)), 0) AS total_recuperado,
        COALESCE(SUM(COALESCE(b.capitalpago, 0)), 0) AS capital_recuperado,
        COALESCE(SUM(COALESCE(b.honorariospago, 0) + COALESCE(b.taxapago, 0) + COALESCE(b.taxaadmpago, 0) + COALESCE(b.multapago, 0) + COALESCE(b.jurospago, 0)), 0) AS faturamento,
        COUNT(DISTINCT b.processo)::bigint AS acordos_pagos
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
    `, ...params);
    return rows[0];
}
async function queryAgreementSummary(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)("TRIM(COALESCE(c.grupo, 'OUTROS'))", filter.credores, params);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::bigint AS acordos,
        COALESCE(SUM(COALESCE(ac.tot_sub_total, 0)), 0) AS valor_acordos
      FROM tb_acordo ac
      LEFT JOIN tb_credor c ON c.id = ac.idcredor
      WHERE ac.idempresa = $1
        AND ac.idcredor != 31084
        AND ac.data_acordo >= $2
        AND ac.data_acordo < $3
        AND ac.negociador IN (${negociadores})
        AND ac.status = 'ANDAMENTO'
        AND ac.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
    `, ...params);
    return rows[0];
}
async function queryAccessSummary(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)("TRIM(COALESCE(b.credor, 'OUTROS'))", filter.credores, params);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::bigint AS acessos,
        COUNT(ac.id)::bigint AS acessos_com_acordo
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
    `, ...params);
    return rows[0];
}
function toNumber(value) {
    return Number(value ?? 0);
}
function mergeSummary(rows) {
    const total = rows.reduce((sum, row) => ({
        total_recuperado: sum.total_recuperado + toNumber(row.payments.total_recuperado),
        capital_recuperado: sum.capital_recuperado + toNumber(row.payments.capital_recuperado),
        faturamento: sum.faturamento + toNumber(row.payments.faturamento),
        acordos: sum.acordos + toNumber(row.agreements.acordos),
        valor_acordos: sum.valor_acordos + toNumber(row.agreements.valor_acordos),
        acordos_pagos: sum.acordos_pagos + toNumber(row.payments.acordos_pagos),
        acessos: sum.acessos + toNumber(row.accesses.acessos),
        acessos_com_acordo: sum.acessos_com_acordo + toNumber(row.accesses.acessos_com_acordo),
    }), { total_recuperado: 0, capital_recuperado: 0, faturamento: 0, acordos: 0, valor_acordos: 0, acordos_pagos: 0, acessos: 0, acessos_com_acordo: 0 });
    return {
        ...total,
        conversao: total.acessos > 0 ? (total.acordos / total.acessos) * 100 : 0,
    };
}
async function buildResultSummary(filter) {
    const rows = await Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query(async (prisma) => ({
        payments: await queryPaymentSummary(prisma, empresaId, filter),
        agreements: await queryAgreementSummary(prisma, empresaId, filter),
        accesses: await queryAccessSummary(prisma, empresaId, filter),
    }))));
    return mergeSummary(rows);
}
async function getDashboardResultSummary(filter) {
    return (0, cache_1.getCached)((0, cache_1.cacheKey)('dashboard-result-summary', filter), cache_1.CACHE_TTL.RESULTS, async () => {
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
//# sourceMappingURL=dashboardSummaryService.js.map