"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getAccesses = getAccesses;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
async function queryAccesses(prisma, empresaId, filter) {
    const periodo = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, periodo.start, periodo.end];
    const negociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(params, negociador)).join(', ');
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)("TRIM(COALESCE(b.credor, 'OUTROS'))", filter.credores, params);
    const query = `
    SELECT
        a.id, a.idempresa, a.data_cad::date AS data,
        CASE
          WHEN TRIM(COALESCE(a.hora_cad, '')) ~ '^[0-9]{1,2}'
          THEN LEAST(SUBSTRING(TRIM(a.hora_cad) FROM '^[0-9]{1,2}')::int, 23)
          ELSE 0
        END AS hora,
        TRIM(COALESCE(b.credor, 'OUTROS')) AS credor,
        a.processo,
        CASE
            WHEN ac.id IS NOT NULL THEN 'COM ACORDO'
            ELSE 'SEM ACORDO'
        END AS situacao
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
    ORDER BY a.data_cad DESC
  `;
    return prisma.$queryRawUnsafe(query, ...params);
}
async function getAccesses(filter) {
    const results = await Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryAccesses(prisma, empresaId, filter))));
    const allData = results.flat();
    return {
        data: allData.map(row => ({
            id: String(row.id),
            processo: String(row.processo),
            data: row.data instanceof Date ? row.data.toISOString().slice(0, 10) : String(row.data).slice(0, 10),
            hora: Number(row.hora ?? 0),
            sistema: Number(row.idempresa) === 401 ? 'consulth' : 'sisth',
            idempresa: Number(row.idempresa),
            credor: row.credor ? String(row.credor) : null,
            situacao: String(row.situacao),
        }))
    };
}
//# sourceMappingURL=accessService.js.map