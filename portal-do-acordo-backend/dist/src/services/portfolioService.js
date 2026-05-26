"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPortfolio = getPortfolio;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
const CREDITOR_MAP_401 = {
    29399: 'GEAP',
    30706: 'SOUZA CRUZ',
    30798: 'PEIXOTO',
    31203: 'SOLAR BR',
    31205: 'SOLAR BR',
    31207: 'SOLAR BR',
    31194: 'GRUPO JTI',
    31197: 'GRUPO JTI',
    31198: 'GRUPO JTI',
    32742: 'VOTORANTIM',
    33355: null,
};
function monthRange(months, fallbackPeriod) {
    if (months.length === 0)
        return (0, reportFilters_1.getPeriodRange)(fallbackPeriod);
    const sorted = [...months].sort();
    const start = new Date(`${sorted[0]}-01T00:00:00Z`);
    const end = new Date(`${sorted[sorted.length - 1]}-01T00:00:00Z`);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
}
function normalizeCreditor(row) {
    const companyId = Number(row.idempresa);
    const creditorId = Number(row.idcredor);
    if (companyId === 401 && creditorId in CREDITOR_MAP_401)
        return CREDITOR_MAP_401[creditorId];
    return String(row.credor || row.nomearquivo || 'OUTROS').trim().toUpperCase();
}
function isValidPortfolioRow(row) {
    const companyId = Number(row.idempresa);
    if (companyId === 1007)
        return true;
    const creditorId = Number(row.idcredor);
    const user = String(row.usuario_cad || '').trim().toUpperCase();
    if (creditorId === 33355)
        return false;
    if (user === 'JOAO.RIBEIRO')
        return Boolean(normalizeCreditor(row));
    if (user === 'AUTO')
        return creditorId === 29399;
    return false;
}
async function queryPortfolio(prisma, empresaId, filter) {
    const selectedMonths = filter.periodos.length > 0 ? new Set(filter.periodos) : filter.periodo ? new Set([filter.periodo]) : new Set();
    const range = monthRange([...selectedMonths], filter.periodo);
    const rows = await prisma.$queryRawUnsafe(`
      SELECT
        b.id,
        b.idempresa,
        b.codimp,
        b.data_cad::date AS data,
        b.usuario_cad,
        b.nomearquivo,
        b.idcredor,
        TRIM(c.grupo) AS credor,
        b.qtdetit,
        b.tottit,
        b.qtdeimp,
        b.qtdeproc,
        b.qtdedup,
        b.valor_imp
      FROM tb_borderos_tit b
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND b.data_cad >= $2
        AND b.data_cad < $3
      ORDER BY b.data_cad DESC, b.id DESC
    `, empresaId, range.start, range.end);
    return rows
        .filter((row) => selectedMonths.size === 0 || selectedMonths.has((0, reportFilters_1.monthKey)(row.data)))
        .filter(isValidPortfolioRow)
        .map((row) => ({
        id: String(row.id),
        sistema: Number(row.idempresa) === 401 ? 'consulth' : 'sisth',
        idempresa: Number(row.idempresa),
        codimp: String(row.codimp),
        data: row.data.toISOString().slice(0, 10),
        mes: (0, reportFilters_1.monthKey)(row.data),
        usuario_cad: String(row.usuario_cad || ''),
        nomearquivo: String(row.nomearquivo || ''),
        idcredor: Number(row.idcredor),
        credor: normalizeCreditor(row) || 'OUTROS',
        qtdetit: Number(row.qtdetit ?? 0),
        tottit: Number(row.tottit ?? 0),
        qtdeimp: Number(row.qtdeimp ?? 0),
        qtdeproc: Number(row.qtdeproc ?? 0),
        qtdedup: Number(row.qtdedup ?? 0),
        valor_imp: Number(row.valor_imp ?? 0),
    }));
}
async function getPortfolio(filter) {
    const rows = (await Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryPortfolio(prisma, empresaId, filter))))).flat();
    const selectedCreditors = new Set((filter.credores ?? []).map((creditor) => creditor.trim()).filter(Boolean));
    const filteredRows = rows.filter((row) => selectedCreditors.size === 0 || selectedCreditors.has(row.credor));
    return { data: filteredRows };
}
//# sourceMappingURL=portfolioService.js.map