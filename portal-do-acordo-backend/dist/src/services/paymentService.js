"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPayments = getPayments;
exports.getMonthlyFinancialPayments = getMonthlyFinancialPayments;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
// Filtra por data da baixa, mas exibe a data do recebimento
const BAIXA_DATE_SOURCE = {
    selectExpression: 'r.data_cad', // <-- Data que vai aparecer na coluna 'data' (ajuste para 'r.data' se este for o nome exato da coluna)
    filterExpression: 'b.databaixa', // <-- Data usada no WHERE do período
    join: 'LEFT JOIN tb_recebimentos r ON r.id = b.idrecebimento', // <-- Fazemos o join usando o idrecebimento
};
// Filtra e exibe pela data do recebimento
const RECEIPT_DATE_SOURCE = {
    selectExpression: 'r.data_cad',
    filterExpression: 'r.data_cad',
    join: 'INNER JOIN tb_recebimentos r ON r.id = b.idrecebimento',
};
async function queryPaymentsByDate(prisma, empresaId, filter, dateSource) {
    const periodo = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, periodo.start, periodo.end];
    const negociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)("TRIM(COALESCE(c.grupo, 'OUTROS'))", filter.credores, params);
    const query = `
    SELECT
        b.id, b.idempresa, ${dateSource.selectExpression}::date AS data,
        TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor,
        TRIM(COALESCE(b.negociador, 'SEM NEGOCIADOR')) AS negociador,
        b.processo,
        COALESCE(b.capitalpago, 0) AS capital_pago,
        COALESCE(b.protestopago, 0) AS protesto_pago,
        COALESCE(b.jurospago, 0) AS juros_pago,
        COALESCE(b.jurosmorapago, 0) AS juros_mora_pago,
        COALESCE(b.multapago, 0) AS multa_pago,
        COALESCE(b.honorariospago, 0) AS honorarios_pago_portal,
        COALESCE(b.totalpago, 0) AS total_pago_portal,
        COALESCE(b.taxapago, 0) AS taxa_pago,
        COALESCE(b.taxaadmpago, 0) AS taxa_adm_pago,
        COALESCE(b.pdpago, 0) AS taxa_pd_pago,
        COALESCE(b.taxaoutpago, 0) AS outras_taxas_pago,
        COALESCE(b.jurosretpago, 0) AS juros_retido_pago
    FROM tb_baixas b
    ${dateSource.join}
    LEFT JOIN tb_credor c ON c.id = b.idcredor
    WHERE b.idempresa = $1
      AND ${dateSource.filterExpression} >= $2
      AND ${dateSource.filterExpression} < $3
      AND b.negociador IN (${negociadores})
      AND b.totalpago > 0
      AND b.idcredor IS NOT NULL
      ${(0, reportFilters_1.buildExcludedDashboardCreditorFilter)('b.idcredor')}
      AND TRIM(COALESCE(c.grupo, '')) != ''
      ${credorFilter}
    ORDER BY ${dateSource.filterExpression} DESC, b.id DESC
  `;
    return prisma.$queryRawUnsafe(query, ...params);
}
function queryPayments(prisma, empresaId, filter) {
    return queryPaymentsByDate(prisma, empresaId, filter, BAIXA_DATE_SOURCE);
}
function queryMonthlyFinancialPayments(prisma, empresaId, filter) {
    return queryPaymentsByDate(prisma, empresaId, filter, RECEIPT_DATE_SOURCE);
}
function mapPayments(rows) {
    return rows.map(row => ({
        id: String(row.id),
        processo: String(row.processo),
        data: row.data instanceof Date ? row.data.toISOString().slice(0, 10) : String(row.data).slice(0, 10),
        sistema: Number(row.idempresa) === 401 ? 'consulth' : 'sisth',
        idempresa: Number(row.idempresa),
        credor: String(row.credor),
        negociador: String(row.negociador),
        capital_pago: Number(row.capital_pago),
        protesto_pago: Number(row.protesto_pago),
        juros_pago: Number(row.juros_pago),
        juros_mora_pago: Number(row.juros_mora_pago),
        multa_pago: Number(row.multa_pago),
        honorarios_pago_portal: Number(row.honorarios_pago_portal),
        total_pago_portal: Number(row.total_pago_portal),
        taxa_pago: Number(row.taxa_pago),
        taxa_adm_pago: Number(row.taxa_adm_pago),
        taxa_pd_pago: Number(row.taxa_pd_pago),
        outras_taxas_pago: Number(row.outras_taxas_pago),
        juros_retido_pago: Number(row.juros_retido_pago),
    }));
}
async function getPaymentsByQuery(filter, queryPaymentsForCompany) {
    const results = await Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryPaymentsForCompany(prisma, empresaId, filter))));
    return {
        data: mapPayments(results.flat())
    };
}
function getPayments(filter) {
    return getPaymentsByQuery(filter, queryPayments);
}
function getMonthlyFinancialPayments(filter) {
    return getPaymentsByQuery(filter, queryMonthlyFinancialPayments);
}
//# sourceMappingURL=paymentService.js.map