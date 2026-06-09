"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardResultGraphs = getDashboardResultGraphs;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
const cache_1 = require("../utils/cache");
function toNumber(value) {
    return Number(value ?? 0);
}
function dateKey(value) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function negociadorValues(filter) {
    return filter.negociador ? [filter.negociador] : reportFilters_1.NEGOTIATORS;
}
function buildNegotiatorList(params, filter) {
    return negociadorValues(filter).map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
}
function buildPaymentCreditorFilter(params, filter, alias = 'c') {
    return (0, reportFilters_1.buildSqlInFilter)(`TRIM(COALESCE(${alias}.grupo, 'OUTROS'))`, filter.credores, params);
}
function buildAccessAgreementCreditorFilter(params, filter, alias = 'access_credor') {
    return (0, reportFilters_1.buildSqlInFilter)(`TRIM(COALESCE(${alias}.grupo, 'OUTROS'))`, filter.credores, params);
}
async function queryDailyPayments(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildPaymentCreditorFilter(params, filter);
    return prisma.$queryRawUnsafe(`
      SELECT
        b.databaixa::date AS dia,
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
    const credorFilter = buildPaymentCreditorFilter(params, filter);
    return prisma.$queryRawUnsafe(`
      SELECT
        ac.data_acordo::date AS dia,
        COUNT(*)::bigint AS acordos
      FROM tb_acordo ac
      LEFT JOIN tb_credor c ON c.id = ac.idcredor
      WHERE ac.idempresa = $1
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
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
    const credorJoin = filter.credores.length > 0
        ? `
      LEFT JOIN tb_acordo access_acordo ON access_acordo.id = a.idacordo
        AND access_acordo.idempresa = a.idempresa
      LEFT JOIN tb_credor access_credor ON access_credor.id = access_acordo.idcredor
    `
        : '';
    const credorFilter = filter.credores.length > 0 ? buildAccessAgreementCreditorFilter(params, filter) : '';
    return prisma.$queryRawUnsafe(`
      SELECT
        a.data_cad::date AS dia,
        COUNT(*)::bigint AS acessos
      FROM tb_portal_neg_acessos a
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
      ${credorJoin}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${(0, reportFilters_1.buildExcludedDashboardAccessFilter)('a')}
        ${credorFilter}
      GROUP BY a.data_cad::date
      ORDER BY dia
    `, ...params);
}
async function queryComponents(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildPaymentCreditorFilter(params, filter);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COALESCE(SUM(COALESCE(b.capitalpago, 0)), 0) AS capital,
        COALESCE(SUM(COALESCE(b.jurospago, 0)), 0) AS juros,
        COALESCE(SUM(COALESCE(b.multapago, 0)), 0) AS multa,
        COALESCE(SUM(COALESCE(b.honorariospago, 0)), 0) AS honorarios
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
    return rows[0] ?? { capital: 0, juros: 0, multa: 0, honorarios: 0 };
}
async function queryPaymentsByCreditor(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildPaymentCreditorFilter(params, filter);
    return prisma.$queryRawUnsafe(`
      SELECT
        TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor,
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
      GROUP BY TRIM(COALESCE(c.grupo, 'OUTROS'))
    `, ...params);
}
async function queryAgreementsByCreditor(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildPaymentCreditorFilter(params, filter);
    return prisma.$queryRawUnsafe(`
      SELECT
        TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor,
        COUNT(*)::bigint AS acordos
      FROM tb_acordo ac
      LEFT JOIN tb_credor c ON c.id = ac.idcredor
      WHERE ac.idempresa = $1
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
        AND ac.data_acordo >= $2
        AND ac.data_acordo < $3
        AND ac.negociador IN (${negociadores})
        AND ac.status = 'ANDAMENTO'
        AND ac.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
      GROUP BY TRIM(COALESCE(c.grupo, 'OUTROS'))
    `, ...params);
}
async function queryPaymentsByNegotiator(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildPaymentCreditorFilter(params, filter);
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
    const credorFilter = buildPaymentCreditorFilter(params, filter);
    return prisma.$queryRawUnsafe(`
      SELECT
        TRIM(COALESCE(ac.negociador, 'SEM NEGOCIADOR')) AS negociador,
        COUNT(*)::bigint AS acordos
      FROM tb_acordo ac
      LEFT JOIN tb_credor c ON c.id = ac.idcredor
      WHERE ac.idempresa = $1
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
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
async function queryAgreementsByHour(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildPaymentCreditorFilter(params, filter);
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
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
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
async function queryAccessFunnel(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const credorJoin = filter.credores.length > 0
        ? `
      LEFT JOIN tb_acordo access_acordo ON access_acordo.id = a.idacordo
        AND access_acordo.idempresa = a.idempresa
      LEFT JOIN tb_credor access_credor ON access_credor.id = access_acordo.idcredor
    `
        : '';
    const credorFilter = filter.credores.length > 0 ? buildAccessAgreementCreditorFilter(params, filter) : '';
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        COUNT(*)::bigint AS acessos,
        COUNT(DISTINCT a.id_portal_neg)::bigint AS negociacoes
      FROM tb_portal_neg_acessos a
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
      ${credorJoin}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${(0, reportFilters_1.buildExcludedDashboardAccessFilter)('a')}
        ${credorFilter}
    `, ...params);
    return rows[0] ?? { acessos: 0, negociacoes: 0 };
}
async function queryPaidCount(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildPaymentCreditorFilter(params, filter);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(DISTINCT b.processo)::bigint AS total
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
    return toNumber(rows[0]?.total);
}
async function queryAgreementCount(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = buildNegotiatorList(params, filter);
    const credorFilter = buildPaymentCreditorFilter(params, filter);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT COUNT(*)::bigint AS total
      FROM tb_acordo ac
      LEFT JOIN tb_credor c ON c.id = ac.idcredor
      WHERE ac.idempresa = $1
        ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('ac.idcredor')}
        AND ac.data_acordo >= $2
        AND ac.data_acordo < $3
        AND ac.negociador IN (${negociadores})
        AND ac.status = 'ANDAMENTO'
        AND ac.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
    `, ...params);
    return toNumber(rows[0]?.total);
}
async function queryCompanyGraphs(prisma, empresaId, filter) {
    const [dailyPayments, dailyAgreements, dailyAccesses, components, paymentsByCreditor, agreementsByCreditor, paymentsByNegotiator, agreementsByNegotiator, agreementsByHour, accessFunnel, paidCount, agreementCount,] = await Promise.all([
        queryDailyPayments(prisma, empresaId, filter),
        queryDailyAgreements(prisma, empresaId, filter),
        queryDailyAccesses(prisma, empresaId, filter),
        queryComponents(prisma, empresaId, filter),
        queryPaymentsByCreditor(prisma, empresaId, filter),
        queryAgreementsByCreditor(prisma, empresaId, filter),
        queryPaymentsByNegotiator(prisma, empresaId, filter),
        queryAgreementsByNegotiator(prisma, empresaId, filter),
        queryAgreementsByHour(prisma, empresaId, filter),
        queryAccessFunnel(prisma, empresaId, filter),
        queryPaidCount(prisma, empresaId, filter),
        queryAgreementCount(prisma, empresaId, filter),
    ]);
    return {
        dailyPayments,
        dailyAgreements,
        dailyAccesses,
        components,
        paymentsByCreditor,
        agreementsByCreditor,
        paymentsByNegotiator,
        agreementsByNegotiator,
        agreementsByHour,
        accessFunnel,
        paidCount,
        agreementCount,
    };
}
function mergeDaily(results) {
    const rows = new Map();
    const ensure = (dia) => {
        const key = dateKey(dia);
        const current = rows.get(key) ?? { dia: key, recuperado: 0, acordos: 0, acessos: 0 };
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
    return Array.from(rows.values()).sort((a, b) => a.dia.localeCompare(b.dia));
}
function mergeComponents(results) {
    return results.reduce((sum, result) => ({
        capital: sum.capital + toNumber(result.components.capital),
        juros: sum.juros + toNumber(result.components.juros),
        multa: sum.multa + toNumber(result.components.multa),
        honorarios: sum.honorarios + toNumber(result.components.honorarios),
    }), { capital: 0, juros: 0, multa: 0, honorarios: 0 });
}
function mergeByCredor(results) {
    const rows = new Map();
    const ensure = (credor) => {
        const current = rows.get(credor) ?? { credor, recuperado: 0, acordos: 0, pagos: 0, ticket: 0, conversaoPago: 0 };
        rows.set(credor, current);
        return current;
    };
    results.forEach((result) => {
        result.paymentsByCreditor.forEach((row) => {
            const current = ensure(row.credor);
            current.recuperado += toNumber(row.recuperado);
            current.pagos += toNumber(row.pagos);
        });
        result.agreementsByCreditor.forEach((row) => {
            ensure(row.credor).acordos += toNumber(row.acordos);
        });
    });
    return Array.from(rows.values())
        .map((row) => ({
        ...row,
        ticket: row.pagos > 0 ? row.recuperado / row.pagos : 0,
        conversaoPago: row.acordos > 0 ? (row.pagos / row.acordos) * 100 : 0,
    }))
        .sort((a, b) => b.acordos - a.acordos || b.pagos - a.pagos || a.credor.localeCompare(b.credor));
}
function mergeByNegotiator(results) {
    const rows = new Map();
    const ensure = (negociador) => {
        const current = rows.get(negociador) ?? { negociador, recuperado: 0, pagamentos: 0, acordos: 0, conversao: 0 };
        rows.set(negociador, current);
        return current;
    };
    results.forEach((result) => {
        result.paymentsByNegotiator.forEach((row) => {
            const current = ensure(row.negociador);
            current.recuperado += toNumber(row.recuperado);
            current.pagamentos += toNumber(row.pagamentos);
        });
        result.agreementsByNegotiator.forEach((row) => {
            ensure(row.negociador).acordos += toNumber(row.acordos);
        });
    });
    return Array.from(rows.values())
        .map((row) => ({ ...row, conversao: row.acordos > 0 ? (row.pagamentos / row.acordos) * 100 : 0 }))
        .sort((a, b) => b.recuperado - a.recuperado);
}
function mergeByHour(results) {
    const hours = new Map();
    results.forEach((result) => {
        result.agreementsByHour.forEach((row) => {
            const hour = toNumber(row.hora);
            const current = hours.get(hour) ?? { hora: hour, acordos: 0 };
            current.acordos += toNumber(row.acordos);
            hours.set(hour, current);
        });
    });
    return Array.from(hours.values()).sort((a, b) => a.hora - b.hora);
}
function mergeFunnel(results) {
    return results.reduce((sum, result) => ({
        acessos: sum.acessos + toNumber(result.accessFunnel.acessos),
        negociacoes: sum.negociacoes + toNumber(result.accessFunnel.negociacoes),
        acordos: sum.acordos + result.agreementCount,
        pagos: sum.pagos + result.paidCount,
    }), { acessos: 0, negociacoes: 0, acordos: 0, pagos: 0 });
}
function buildGraphResponse(results, filter) {
    const porCredor = mergeByCredor(results);
    const totalRecuperado = porCredor.reduce((sum, row) => sum + row.recuperado, 0);
    const totalPagos = porCredor.reduce((sum, row) => sum + row.pagos, 0);
    return {
        data: {
            periodo: filter.periodo ?? null,
            access_credor_source: filter.credores.length > 0
                ? 'tb_portal_neg_acessos.idacordo -> tb_acordo.idcredor'
                : 'sem filtro de credor; tb_portal_neg_acessos por idempresa/data_cad',
            evolucaoDiaria: mergeDaily(results),
            porNegociador: mergeByNegotiator(results),
            porCredor,
            componentes: mergeComponents(results),
            ticketMedio: totalPagos > 0 ? totalRecuperado / totalPagos : 0,
            acordosPorHora: mergeByHour(results),
            funil: mergeFunnel(results),
        },
    };
}
async function buildDashboardResultGraphs(filter) {
    const results = await Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryCompanyGraphs(prisma, empresaId, filter))));
    return buildGraphResponse(results, filter);
}
async function getDashboardResultGraphs(filter) {
    return (0, cache_1.getCached)((0, cache_1.cacheKey)('dashboard-result-graphs', filter), cache_1.CACHE_TTL.RESULTS, () => buildDashboardResultGraphs(filter));
}
//# sourceMappingURL=dashboardResultGraphsService.js.map