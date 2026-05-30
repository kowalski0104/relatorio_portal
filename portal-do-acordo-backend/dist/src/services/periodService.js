"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getPeriods = getPeriods;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
const cache_1 = require("../utils/cache");
async function queryPeriods(prisma, empresaId) {
    const range = (0, reportFilters_1.getPeriodRange)();
    const rows = await prisma.$queryRawUnsafe(`
      SELECT DISTINCT to_char(data_ref, 'YYYY-MM') AS periodo
      FROM (
        SELECT b.databaixa::date AS data_ref
        FROM tb_baixas b
        WHERE b.idempresa = $1
          AND b.databaixa >= $2
          AND b.databaixa < $3
          AND b.totalpago > 0
          AND b.idcredor IS NOT NULL

        UNION

        SELECT ac.data_acordo::date AS data_ref
        FROM tb_acordo ac
        WHERE ac.idempresa = $1
          AND ac.data_acordo >= $2
          AND ac.data_acordo < $3
          AND ac.status = 'ANDAMENTO'
          AND ac.idcredor IS NOT NULL

        UNION

        SELECT a.data_cad::date AS data_ref
        FROM tb_portal_neg_acessos a
        WHERE a.idempresa = $1
          AND a.data_cad >= $2
          AND a.data_cad < $3

        UNION

        SELECT b.data_cad::date AS data_ref
        FROM tb_borderos_tit b
        WHERE b.idempresa = $1
          AND b.data_cad >= $2
          AND b.data_cad < $3
      ) periodos
      WHERE data_ref IS NOT NULL
      ORDER BY periodo DESC
    `, empresaId, range.start, range.end);
    return rows.map((row) => row.periodo).filter(Boolean);
}
async function getPeriods(filter) {
    return (0, cache_1.getCached)((0, cache_1.cacheKey)('periods', filter), cache_1.CACHE_TTL.PERIODS, async () => {
        const results = await Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryPeriods(prisma, empresaId))));
        return {
            data: Array.from(new Set(results.flat())).sort().reverse(),
        };
    });
}
//# sourceMappingURL=periodService.js.map