"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardPerformanceSummary = getDashboardPerformanceSummary;
exports.getDashboardPerformanceGraphs = getDashboardPerformanceGraphs;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
const cache_1 = require("../utils/cache");
function toNumber(value) {
    return Number(value ?? 0);
}
function dateKey(value) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function monthKey(value) {
    return dateKey(value).slice(0, 7);
}
function previousPeriod(periodo) {
    const range = (0, reportFilters_1.getPeriodRange)(periodo);
    const date = new Date(range.start);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function yearRange(periodo) {
    const parsed = (0, reportFilters_1.parsePeriod)(periodo);
    const year = parsed ? parsed.start.getUTCFullYear() : new Date().getUTCFullYear();
    return {
        start: new Date(Date.UTC(year, 0, 1)),
        end: new Date(Date.UTC(year + 1, 0, 1)),
    };
}
function negociadorValues(filter) {
    return filter.negociador ? [filter.negociador] : reportFilters_1.NEGOTIATORS;
}
function buildNegotiatorList(params, filter) {
    return negociadorValues(filter).map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
}
function buildCredorFilter(params, filter, expression) {
    return (0, reportFilters_1.buildSqlInFilter)(expression, filter.credores, params);
}
function accessCreditorSubquery(params, filter, startParam = '$2', endParam = '$3') {
    const negociadores = buildNegotiatorList(params, filter);
    return `
    SELECT DISTINCT tb_baixas.processo,
           tb_baixas.idempresa,
           TRIM(COALESCE(tb_credor.grupo, 'OUTROS')) AS credor,
           TRIM(COALESCE(tb_baixas.negociador, 'SEM NEGOCIADOR')) AS negociador
    FROM tb_baixas
    LEFT JOIN tb_credor ON tb_credor.id = tb_baixas.idcredor
    WHERE tb_baixas.idempresa = $1
      AND tb_baixas.totalpago > 0
      AND tb_baixas.databaixa >= ${startParam}
      AND tb_baixas.databaixa < ${endParam}
      AND tb_baixas.negociador IN (${negociadores})
      AND tb_baixas.idcredor IS NOT NULL
      ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('tb_baixas.idcredor')}
      AND TRIM(COALESCE(tb_credor.grupo, '')) != ''
  `;
}
async function queryPaymentMetrics(prisma, empresaId, filter, periodo) {
    const range = (0, reportFilters_1.getPeriodRange)(periodo ?? filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(COALESCE(b.totalpago, 0)), 0) AS recuperado,
        COUNT(DISTINCT b.processo)::bigint AS pagos
      FROM tb_baixas b
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND b.databaixa >= $2
        AND b.databaixa < $3
        AND b.negociador IN (${negociadores})
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('b.idcredor')}
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
    `, ...params);
    return rows[0] ?? { recuperado: 0, pagos: 0 };
}
async function queryAgreementMetrics(prisma, empresaId, filter, periodo) {
    const range = (0, reportFilters_1.getPeriodRange)(periodo ?? filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    const rows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::bigint AS acordos
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
    return rows[0] ?? { acordos: 0 };
}
async function queryAccessMetrics(prisma, empresaId, filter, periodo) {
    const range = (0, reportFilters_1.getPeriodRange)(periodo ?? filter.periodo);
    const params = [empresaId, range.start, range.end];
    const baixaSubquery = accessCreditorSubquery(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(b.credor, 'OUTROS'))");
    const negociadorFilter = filter.negociador ? 'AND b.negociador IS NOT NULL' : '';
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::bigint AS acessos,
        COUNT(CASE WHEN ac.id IS NOT NULL THEN 1 END)::bigint AS "acessosComAcordo",
        COUNT(DISTINCT a.id_portal_neg)::bigint AS negociacoes
      FROM tb_portal_neg_acessos a
      LEFT JOIN (${baixaSubquery}) b ON b.processo = a.processo AND b.idempresa = a.idempresa
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${(0, reportFilters_1.buildExcludedDashboardAccessFilter)('a')}
        ${credorFilter}
        ${negociadorFilter}
    `, ...params);
    return rows[0] ?? { acessos: 0, acessosComAcordo: 0, negociacoes: 0 };
}
async function querySummaryMetrics(prisma, empresaId, filter, periodo) {
    const [payments, agreements, accesses] = await Promise.all([
        queryPaymentMetrics(prisma, empresaId, filter, periodo),
        queryAgreementMetrics(prisma, empresaId, filter, periodo),
        queryAccessMetrics(prisma, empresaId, filter, periodo),
    ]);
    return {
        recuperado: payments.recuperado,
        pagos: payments.pagos,
        acordos: agreements.acordos,
        acessos: accesses.acessos,
        acessosComAcordo: accesses.acessosComAcordo,
        negociacoes: accesses.negociacoes,
    };
}
async function queryPaymentsByNegotiator(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    return prisma.$queryRawUnsafe(`
      SELECT
        TRIM(COALESCE(b.negociador, 'SEM NEGOCIADOR')) AS negociador,
        COALESCE(SUM(COALESCE(b.totalpago, 0)), 0) AS recuperado,
        COUNT(*)::bigint AS pagamentos
      FROM tb_baixas b
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND b.databaixa >= $2
        AND b.databaixa < $3
        AND b.negociador IN (${negociadores})
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('b.idcredor')}
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
      GROUP BY TRIM(COALESCE(b.negociador, 'SEM NEGOCIADOR'))
    `, ...params);
}
async function queryAgreementsByNegotiator(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    return prisma.$queryRawUnsafe(`
      SELECT
        TRIM(COALESCE(ac.negociador, 'SEM NEGOCIADOR')) AS negociador,
        COUNT(*)::bigint AS acordos
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
      GROUP BY TRIM(COALESCE(ac.negociador, 'SEM NEGOCIADOR'))
    `, ...params);
}
async function queryAccessesByNegotiator(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const hasCreditorFilter = filter.credores.length > 0;
    if (!hasCreditorFilter) {
        const negociadores = buildNegotiatorList(params, filter);
        return prisma.$queryRawUnsafe(`
        SELECT
          TRIM(COALESCE(ac_credor.negociador, 'SEM NEGOCIADOR')) AS negociador,
          COUNT(*)::bigint AS acessos
        FROM tb_portal_neg_acessos a
        LEFT JOIN tb_acordo ac_credor ON ac_credor.id = a.idacordo
          AND ac_credor.idempresa = a.idempresa
        WHERE a.idempresa = $1
          AND a.data_cad >= $2
          AND a.data_cad < $3
          ${(0, reportFilters_1.buildExcludedDashboardAccessFilter)('a')}
          ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac_credor.idcredor')}
          AND ac_credor.negociador IN (${negociadores})
        GROUP BY TRIM(COALESCE(ac_credor.negociador, 'SEM NEGOCIADOR'))
      `, ...params);
    }
    const baixaSubquery = accessCreditorSubquery(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(b.credor, 'OUTROS'))");
    const negociadorFilter = filter.negociador ? 'AND b.negociador IS NOT NULL' : '';
    return prisma.$queryRawUnsafe(`
      SELECT
        TRIM(COALESCE(b.negociador, 'SEM NEGOCIADOR')) AS negociador,
        COUNT(*)::bigint AS acessos
      FROM tb_portal_neg_acessos a
      LEFT JOIN (${baixaSubquery}) b ON b.processo = a.processo AND b.idempresa = a.idempresa
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${(0, reportFilters_1.buildExcludedDashboardAccessFilter)('a')}
        AND b.negociador IS NOT NULL
        ${credorFilter}
        ${negociadorFilter}
      GROUP BY TRIM(COALESCE(b.negociador, 'SEM NEGOCIADOR'))
    `, ...params);
}
async function queryMonthlyPayments(prisma, empresaId, filter) {
    const range = yearRange(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    return prisma.$queryRawUnsafe(`
      SELECT date_trunc('month', b.databaixa)::date AS mes,
             COALESCE(SUM(COALESCE(b.totalpago, 0)), 0) AS recuperado
      FROM tb_baixas b
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND b.databaixa >= $2
        AND b.databaixa < $3
        AND b.negociador IN (${negociadores})
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('b.idcredor')}
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
      GROUP BY 1
      ORDER BY 1
    `, ...params);
}
async function queryMonthlyAgreements(prisma, empresaId, filter) {
    const range = yearRange(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    return prisma.$queryRawUnsafe(`
      SELECT date_trunc('month', ac.data_acordo)::date AS mes,
             COUNT(*)::bigint AS acordos
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
      GROUP BY 1
      ORDER BY 1
    `, ...params);
}
async function queryMonthlyAccesses(prisma, empresaId, filter) {
    const range = yearRange(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const accessRange = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const accessFilterForCreditor = { ...filter, periodo: filter.periodo };
    const baixaSubquery = accessCreditorSubquery(params, accessFilterForCreditor, (0, reportFilters_1.addSqlParam)(params, accessRange.start), (0, reportFilters_1.addSqlParam)(params, accessRange.end));
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(b.credor, 'OUTROS'))");
    const negociadorFilter = filter.negociador ? 'AND b.negociador IS NOT NULL' : '';
    return prisma.$queryRawUnsafe(`
      SELECT date_trunc('month', a.data_cad)::date AS mes,
             COUNT(*)::bigint AS acessos
      FROM tb_portal_neg_acessos a
      LEFT JOIN (${baixaSubquery}) b ON b.processo = a.processo AND b.idempresa = a.idempresa
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${(0, reportFilters_1.buildExcludedDashboardAccessFilter)('a')}
        ${credorFilter}
        ${negociadorFilter}
      GROUP BY 1
      ORDER BY 1
    `, ...params);
}
async function queryDailyPayments(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    return prisma.$queryRawUnsafe(`
      SELECT b.databaixa::date AS dia,
             COALESCE(SUM(COALESCE(b.totalpago, 0)), 0) AS recuperado
      FROM tb_baixas b
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND b.databaixa >= $2
        AND b.databaixa < $3
        AND b.negociador IN (${negociadores})
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('b.idcredor')}
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
      GROUP BY b.databaixa::date
      ORDER BY dia
    `, ...params);
}
async function queryDailyAgreements(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    return prisma.$queryRawUnsafe(`
      SELECT ac.data_acordo::date AS dia,
             COUNT(*)::bigint AS acordos
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
      GROUP BY ac.data_acordo::date
      ORDER BY dia
    `, ...params);
}
async function queryDailyAccesses(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const baixaSubquery = accessCreditorSubquery(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(b.credor, 'OUTROS'))");
    const negociadorFilter = filter.negociador ? 'AND b.negociador IS NOT NULL' : '';
    return prisma.$queryRawUnsafe(`
      SELECT a.data_cad::date AS dia,
             COUNT(*)::bigint AS acessos
      FROM tb_portal_neg_acessos a
      LEFT JOIN (${baixaSubquery}) b ON b.processo = a.processo AND b.idempresa = a.idempresa
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${(0, reportFilters_1.buildExcludedDashboardAccessFilter)('a')}
        ${credorFilter}
        ${negociadorFilter}
      GROUP BY a.data_cad::date
      ORDER BY dia
    `, ...params);
}
async function queryHourlyAgreements(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(c.grupo, 'OUTROS'))");
    return prisma.$queryRawUnsafe(`
      SELECT
        CASE
          WHEN TRIM(COALESCE(ac.hora_acordo, '')) ~ '^[0-9]{1,2}'
          THEN LEAST(SUBSTRING(TRIM(ac.hora_acordo) FROM '^[0-9]{1,2}')::int, 23)
          ELSE 0
        END AS hora,
        COUNT(*)::bigint AS acordos
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
      GROUP BY hora
      ORDER BY hora
    `, ...params);
}
async function queryHourlyAccesses(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const baixaSubquery = accessCreditorSubquery(params, filter);
    const credorFilter = buildCredorFilter(params, filter, "TRIM(COALESCE(b.credor, 'OUTROS'))");
    const negociadorFilter = filter.negociador ? 'AND b.negociador IS NOT NULL' : '';
    return prisma.$queryRawUnsafe(`
      SELECT
        CASE
          WHEN TRIM(COALESCE(a.hora_cad, '')) ~ '^[0-9]{1,2}'
          THEN LEAST(SUBSTRING(TRIM(a.hora_cad) FROM '^[0-9]{1,2}')::int, 23)
          ELSE 0
        END AS hora,
        COUNT(*)::bigint AS acessos
      FROM tb_portal_neg_acessos a
      LEFT JOIN (${baixaSubquery}) b ON b.processo = a.processo AND b.idempresa = a.idempresa
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${(0, reportFilters_1.buildExcludedDashboardAccessFilter)('a')}
        ${credorFilter}
        ${negociadorFilter}
      GROUP BY hora
      ORDER BY hora
    `, ...params);
}
async function queryCompanyPerformance(prisma, empresaId, filter) {
    const previous = previousPeriod(filter.periodo);
    const [current, previousMetrics, paymentNegotiators, agreementNegotiators, accessNegotiators, monthlyPayments, monthlyAgreements, monthlyAccesses, dailyPayments, dailyAgreements, dailyAccesses, hourlyAgreements, hourlyAccesses,] = await Promise.all([
        querySummaryMetrics(prisma, empresaId, filter),
        querySummaryMetrics(prisma, empresaId, filter, previous),
        queryPaymentsByNegotiator(prisma, empresaId, filter),
        queryAgreementsByNegotiator(prisma, empresaId, filter),
        queryAccessesByNegotiator(prisma, empresaId, filter),
        queryMonthlyPayments(prisma, empresaId, filter),
        queryMonthlyAgreements(prisma, empresaId, filter),
        queryMonthlyAccesses(prisma, empresaId, filter),
        queryDailyPayments(prisma, empresaId, filter),
        queryDailyAgreements(prisma, empresaId, filter),
        queryDailyAccesses(prisma, empresaId, filter),
        queryHourlyAgreements(prisma, empresaId, filter),
        queryHourlyAccesses(prisma, empresaId, filter),
    ]);
    return {
        current,
        previous: previousMetrics,
        paymentNegotiators,
        agreementNegotiators,
        accessNegotiators,
        monthlyPayments,
        monthlyAgreements,
        monthlyAccesses,
        dailyPayments,
        dailyAgreements,
        dailyAccesses,
        hourlyAgreements,
        hourlyAccesses,
    };
}
function mergeMetric(rows) {
    const total = rows.reduce((sum, row) => ({
        recuperado: sum.recuperado + toNumber(row.recuperado),
        acordos: sum.acordos + toNumber(row.acordos),
        pagos: sum.pagos + toNumber(row.pagos),
        acessos: sum.acessos + toNumber(row.acessos),
        acessosComAcordo: sum.acessosComAcordo + toNumber(row.acessosComAcordo),
        negociacoes: sum.negociacoes + toNumber(row.negociacoes),
    }), { recuperado: 0, acordos: 0, pagos: 0, acessos: 0, acessosComAcordo: 0, negociacoes: 0 });
    return {
        ...total,
        conversao: total.acessos > 0 ? (total.acordos / total.acessos) * 100 : 0,
        conversaoAcesso: total.acessos > 0 ? (total.acordos / total.acessos) * 100 : 0,
        conversaoPagamento: total.acordos > 0 ? (total.pagos / total.acordos) * 100 : 0,
    };
}
function mergeNegotiators(results) {
    const rows = new Map();
    const ensure = (negociador) => {
        const current = rows.get(negociador) ?? { negociador, acordos: 0, acordosPagos: 0, recuperado: 0, acessos: 0, ticketMedio: 0, conversao: 0 };
        rows.set(negociador, current);
        return current;
    };
    results.forEach((result) => {
        result.paymentNegotiators.forEach((row) => {
            const current = ensure(row.negociador);
            current.recuperado += toNumber(row.recuperado);
            current.acordosPagos += toNumber(row.pagamentos);
        });
        result.agreementNegotiators.forEach((row) => {
            ensure(row.negociador).acordos += toNumber(row.acordos);
        });
        result.accessNegotiators.forEach((row) => {
            ensure(row.negociador).acessos += toNumber(row.acessos);
        });
    });
    return Array.from(rows.values())
        .map((row) => ({
        ...row,
        ticketMedio: row.acordosPagos > 0 ? row.recuperado / row.acordosPagos : 0,
        conversao: row.acessos > 0 ? (row.acordos / row.acessos) * 100 : 0,
    }))
        .sort((a, b) => b.recuperado - a.recuperado);
}
function mergeMonths(results) {
    const rows = new Map();
    const ensure = (mes) => {
        const key = monthKey(mes);
        const current = rows.get(key) ?? { mes: key, recuperado: 0, acordos: 0, acessos: 0, conversao: 0 };
        rows.set(key, current);
        return current;
    };
    results.forEach((result) => {
        result.monthlyPayments.forEach((row) => {
            ensure(row.mes).recuperado += toNumber(row.recuperado);
        });
        result.monthlyAgreements.forEach((row) => {
            ensure(row.mes).acordos += toNumber(row.acordos);
        });
        result.monthlyAccesses.forEach((row) => {
            ensure(row.mes).acessos += toNumber(row.acessos);
        });
    });
    return Array.from(rows.values())
        .map((row) => ({ ...row, conversao: row.acessos > 0 ? (row.acordos / row.acessos) * 100 : 0 }))
        .sort((a, b) => a.mes.localeCompare(b.mes));
}
function mergeDays(results) {
    const rows = new Map();
    const ensure = (dia) => {
        const key = dateKey(dia);
        const current = rows.get(key) ?? { dia: key, recuperado: 0, acordos: 0, acessos: 0, conversao: 0 };
        rows.set(key, current);
        return current;
    };
    results.forEach((result) => {
        result.dailyPayments.forEach((row) => {
            ensure(row.dia).recuperado += toNumber(row.recuperado);
        });
        result.dailyAgreements.forEach((row) => {
            ensure(row.dia).acordos += toNumber(row.acordos);
        });
        result.dailyAccesses.forEach((row) => {
            ensure(row.dia).acessos += toNumber(row.acessos);
        });
    });
    return Array.from(rows.values())
        .map((row) => ({ ...row, conversao: row.acessos > 0 ? (row.acordos / row.acessos) * 100 : 0 }))
        .sort((a, b) => a.dia.localeCompare(b.dia));
}
function mergeHours(results) {
    const rows = new Map();
    const ensure = (hora) => {
        const hour = toNumber(hora);
        const current = rows.get(hour) ?? { hora: hour, label: `${String(hour).padStart(2, '0')}:00`, acessos: 0, acordos: 0, conversao: 0 };
        rows.set(hour, current);
        return current;
    };
    results.forEach((result) => {
        result.hourlyAccesses.forEach((row) => {
            ensure(row.hora).acessos += toNumber(row.acessos);
        });
        result.hourlyAgreements.forEach((row) => {
            ensure(row.hora).acordos += toNumber(row.acordos);
        });
    });
    return Array.from({ length: 24 }, (_, hour) => {
        const current = rows.get(hour) ?? { hora: hour, label: `${String(hour).padStart(2, '0')}:00`, acessos: 0, acordos: 0, conversao: 0 };
        return { ...current, conversao: current.acessos > 0 ? (current.acordos / current.acessos) * 100 : 0 };
    });
}
function buildPerformancePayload(results, filter) {
    const current = mergeMetric(results.map((result) => result.current));
    const previous = mergeMetric(results.map((result) => result.previous));
    const topDias = mergeDays(results)
        .sort((a, b) => b.acordos - a.acordos || a.dia.localeCompare(b.dia))
        .slice(0, 5);
    return {
        data: {
            periodo: filter.periodo ?? null,
            porNegociador: mergeNegotiators(results),
            evolucaoMensal: mergeMonths(results),
            topDias,
            acordosPorHora: mergeHours(results),
            funil: {
                acessos: current.acessos,
                acessosComAcordo: current.acessosComAcordo,
                negociacoes: current.negociacoes,
                acordos: current.acordos,
                pagos: current.pagos,
                conversaoAcesso: current.conversaoAcesso,
                conversaoPagamento: current.conversaoPagamento,
            },
            anterior: {
                acordos: previous.acordos,
                recuperado: previous.recuperado,
                acessos: previous.acessos,
                conversao: previous.conversao,
            },
            graficos: {
                evolucaoDiaria: mergeDays(results).sort((a, b) => a.dia.localeCompare(b.dia)),
                evolucaoMensal: mergeMonths(results),
                distribuicaoHorario: mergeHours(results),
            },
        },
    };
}
async function buildPerformance(filter) {
    const results = await Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryCompanyPerformance(prisma, empresaId, filter))));
    return buildPerformancePayload(results, filter);
}
async function getDashboardPerformanceSummary(filter) {
    return (0, cache_1.getCached)((0, cache_1.cacheKey)('dashboard-performance-summary', filter), cache_1.CACHE_TTL.PERFORMANCE, () => buildPerformance(filter));
}
async function getDashboardPerformanceGraphs(filter) {
    return getDashboardPerformanceSummary(filter);
}
//# sourceMappingURL=dashboardPerformanceService.js.map