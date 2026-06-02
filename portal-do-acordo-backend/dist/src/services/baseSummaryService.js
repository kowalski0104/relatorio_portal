"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getBaseSummary = getBaseSummary;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
const cache_1 = require("../utils/cache");
const activeBaseService_1 = require("./activeBaseService");
const VISIBLE_AGING_ORDER = ['0-90', '91-180', '181-360', '361+', 'SEM VENCIMENTO'];
const AGING_LABELS = {
    '0-90': '0 a 90 dias',
    '91-180': '91 a 180 dias',
    '181-360': '181 a 360 dias',
    '361+': '361+ dias',
    'SEM VENCIMENTO': 'Sem vencimento',
};
function selectedMonths(filter) {
    if (filter.periodos.length > 0)
        return [...filter.periodos];
    return filter.periodo ? [filter.periodo] : [];
}
function monthRange(months, fallbackPeriod) {
    if (months.length === 0)
        return (0, reportFilters_1.getPeriodRange)(fallbackPeriod);
    const sorted = [...months].sort();
    const start = new Date(`${sorted[0]}-01T00:00:00Z`);
    const end = new Date(`${sorted[sorted.length - 1]}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
}
function buildMonthFilter(expression, months, params) {
    if (months.length === 0)
        return '';
    const placeholders = months.map((month) => (0, reportFilters_1.addSqlParam)(params, month)).join(', ');
    return `AND to_char(${expression}, 'YYYY-MM') IN (${placeholders})`;
}
function normalizedPortfolioCreditorExpression() {
    return `
    CASE
      WHEN b.idempresa = 401 AND b.idcredor = 29399 THEN 'GEAP'
      WHEN b.idempresa = 401 AND b.idcredor = 30706 THEN 'SOUZA CRUZ'
      WHEN b.idempresa = 401 AND b.idcredor = 30798 THEN 'PEIXOTO'
      WHEN b.idempresa = 401 AND b.idcredor IN (31203, 31205, 31207) THEN 'SOLAR BR'
      WHEN b.idempresa = 401 AND b.idcredor IN (31194, 31197, 31198) THEN 'GRUPO JTI'
      WHEN b.idempresa = 401 AND b.idcredor = 32742 THEN 'VOTORANTIM'
      WHEN b.idempresa = 401 AND b.idcredor = 33355 THEN NULL
      ELSE UPPER(TRIM(COALESCE(c.grupo, b.nomearquivo, 'OUTROS')))
    END
  `;
}
async function queryPortfolioSummary(prisma, empresaId, filter) {
    const months = selectedMonths(filter);
    const range = monthRange(months, filter.periodo);
    const params = [empresaId, range.start, range.end];
    const monthFilter = buildMonthFilter('b.data_cad', months, params);
    return prisma.$queryRawUnsafe(`
      WITH normalized AS (
        SELECT
          b.idempresa,
          b.idcredor,
          b.usuario_cad,
          ${normalizedPortfolioCreditorExpression()} AS credor,
          b.qtdetit,
          b.qtdeimp,
          b.qtdeproc,
          b.qtdedup,
          b.valor_imp
        FROM tb_borderos_tit b
        LEFT JOIN tb_credor c ON c.id = b.idcredor
        WHERE b.idempresa = $1
          AND b.data_cad >= $2
          AND b.data_cad < $3
          ${monthFilter}
      )
      SELECT
        credor,
        COUNT(*)::bigint AS borderos,
        COALESCE(SUM(COALESCE(valor_imp, 0)), 0) AS valor_entrada,
        COALESCE(SUM(COALESCE(qtdeproc, 0)), 0) AS processos,
        COALESCE(SUM(COALESCE(qtdetit, 0)), 0) AS titulos,
        COALESCE(SUM(COALESCE(qtdeimp, 0)), 0) AS importados,
        COALESCE(SUM(COALESCE(qtdedup, 0)), 0) AS duplicados
      FROM normalized
      WHERE credor IS NOT NULL
        AND credor <> ''
        AND (
          idempresa = 1007
          OR (
            idcredor != 33355
            AND (
              UPPER(TRIM(COALESCE(usuario_cad, ''))) = 'JOAO.RIBEIRO'
              OR (UPPER(TRIM(COALESCE(usuario_cad, ''))) = 'AUTO' AND idcredor = 29399)
            )
          )
        )
      GROUP BY credor
      ORDER BY valor_entrada DESC, credor
    `, ...params);
}
async function queryPaymentSummary(prisma, empresaId, filter) {
    const months = selectedMonths(filter);
    const range = monthRange(months, filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
    const monthFilter = buildMonthFilter('b.databaixa', months, params);
    return prisma.$queryRawUnsafe(`
      SELECT
        TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor,
        COALESCE(SUM(COALESCE(b.totalpago, 0)), 0) AS recuperado
      FROM tb_baixas b
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND b.databaixa >= $2
        AND b.databaixa < $3
        AND b.negociador IN (${negociadores})
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${monthFilter}
      GROUP BY TRIM(COALESCE(c.grupo, 'OUTROS'))
    `, ...params);
}
async function queryAgreementSummary(prisma, empresaId, filter) {
    const months = selectedMonths(filter);
    const range = monthRange(months, filter.periodo);
    const params = [empresaId, range.start, range.end];
    const negociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
    const monthFilter = buildMonthFilter('ac.data_acordo', months, params);
    return prisma.$queryRawUnsafe(`
      SELECT
        TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor,
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
        ${monthFilter}
      GROUP BY TRIM(COALESCE(c.grupo, 'OUTROS'))
    `, ...params);
}
function toNumber(value) {
    return Number(value ?? 0);
}
function creditorFilter(filter) {
    const selected = new Set((filter.credores ?? []).map((creditor) => creditor.trim()).filter(Boolean));
    return (credor) => selected.size === 0 || selected.has(credor);
}
function sumByCreditor(rows, value) {
    const totals = new Map();
    rows.forEach((row) => totals.set(row.credor, (totals.get(row.credor) ?? 0) + value(row)));
    return totals;
}
async function getBaseSummary(filter) {
    return (0, cache_1.getCached)((0, cache_1.cacheKey)('base-summary', filter), cache_1.CACHE_TTL.BASES, () => buildBaseSummary(filter));
}
async function buildBaseSummary(filter) {
    const [activeBaseResult, liveResults] = await Promise.all([
        (0, activeBaseService_1.getActiveBase)(filter),
        Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query(async (prisma) => ({
            portfolio: await queryPortfolioSummary(prisma, empresaId, filter),
            payments: await queryPaymentSummary(prisma, empresaId, filter),
            agreements: await queryAgreementSummary(prisma, empresaId, filter),
        })))),
    ]);
    const matchesCreditor = creditorFilter(filter);
    const activeBase = activeBaseResult.data;
    const portfolioRows = liveResults.flatMap((result) => result.portfolio).filter((row) => matchesCreditor(row.credor));
    const paymentRows = liveResults.flatMap((result) => result.payments).filter((row) => matchesCreditor(row.credor));
    const agreementRows = liveResults.flatMap((result) => result.agreements).filter((row) => matchesCreditor(row.credor));
    const recoveredByCreditor = sumByCreditor(paymentRows, (row) => toNumber(row.recuperado));
    const agreementsByCreditor = sumByCreditor(agreementRows, (row) => toNumber(row.acordos));
    const entradaPorCredor = portfolioRows
        .map((row) => {
        const valorEntrada = toNumber(row.valor_entrada);
        const processos = toNumber(row.processos);
        const recuperado = recoveredByCreditor.get(row.credor) ?? 0;
        const acordos = agreementsByCreditor.get(row.credor) ?? 0;
        return {
            credor: row.credor,
            borderos: toNumber(row.borderos),
            valorEntrada,
            recuperado,
            processos,
            titulos: toNumber(row.titulos),
            importados: toNumber(row.importados),
            duplicados: toNumber(row.duplicados),
            acordos,
            percentualRecuperado: valorEntrada > 0 ? (recuperado / valorEntrada) * 100 : 0,
            conversaoCarteira: processos > 0 ? (acordos / processos) * 100 : 0,
        };
    })
        .sort((a, b) => b.valorEntrada - a.valorEntrada || a.credor.localeCompare(b.credor, 'pt-BR'));
    const totalValorEntrada = entradaPorCredor.reduce((sum, row) => sum + row.valorEntrada, 0);
    const totalBorderos = entradaPorCredor.reduce((sum, row) => sum + row.borderos, 0);
    const totalRecuperado = entradaPorCredor.reduce((sum, row) => sum + row.recuperado, 0);
    const totalAcordos = entradaPorCredor.reduce((sum, row) => sum + row.acordos, 0);
    const activeAgingByCreditor = activeBase.aging_by_credor ?? [];
    const agingByCreditor = activeAgingByCreditor.length > 0
        ? activeAgingByCreditor
        : activeBase.aging.flatMap((row) => ({ credor: 'TOTAL', faixa: row.faixa, processos: row.processos, valor_total: row.valor_total }));
    const totalAgingByCreditor = new Map();
    agingByCreditor.forEach((row) => {
        totalAgingByCreditor.set(row.credor, (totalAgingByCreditor.get(row.credor) ?? 0) + toNumber(row.processos));
    });
    const agingMap = new Map();
    VISIBLE_AGING_ORDER.forEach((faixa) => agingMap.set(faixa, { faixa, processos: 0, valorCarteira: 0, recuperado: 0, acordos: 0 }));
    agingByCreditor.forEach((row) => {
        const faixa = row.faixa;
        const current = agingMap.get(faixa);
        if (!current)
            return;
        const processos = toNumber(row.processos);
        const creditorBaseTotal = totalAgingByCreditor.get(row.credor) ?? 0;
        const share = creditorBaseTotal > 0 ? processos / creditorBaseTotal : 0;
        const creditorRecovered = row.credor === 'TOTAL' ? totalRecuperado : (recoveredByCreditor.get(row.credor) ?? 0);
        const creditorAgreements = row.credor === 'TOTAL' ? totalAcordos : (agreementsByCreditor.get(row.credor) ?? 0);
        current.processos += processos;
        current.valorCarteira += toNumber(row.valor_total);
        current.recuperado += creditorRecovered * share;
        current.acordos += creditorAgreements * share;
    });
    return {
        data: {
            generated_at: new Date().toISOString(),
            updated_at: activeBase.updated_at,
            aging_updated_at: activeBase.aging_updated_at ?? null,
            status: activeBase.status,
            error: activeBase.error,
            aging_complete: activeBase.aging_complete,
            total_processos: activeBase.total_processos,
            total_credores: activeBase.total_credores,
            valor_total_carteira: totalValorEntrada,
            total_borderos: totalBorderos,
            ticket_medio: activeBase.total_processos > 0 ? totalValorEntrada / activeBase.total_processos : 0,
            processos_por_credor: activeBase.by_credor,
            entrada_por_credor: entradaPorCredor,
            aging: VISIBLE_AGING_ORDER.map((faixa) => {
                const row = agingMap.get(faixa) ?? { faixa, processos: 0, valorCarteira: 0, recuperado: 0, acordos: 0 };
                return {
                    ...row,
                    name: AGING_LABELS[faixa],
                    valorMedio: row.processos > 0 ? row.valorCarteira / row.processos : 0,
                    recuperacao: row.valorCarteira > 0 ? (row.recuperado / row.valorCarteira) * 100 : 0,
                    conversao: row.processos > 0 ? (row.acordos / row.processos) * 100 : 0,
                };
            }),
        },
    };
}
//# sourceMappingURL=baseSummaryService.js.map