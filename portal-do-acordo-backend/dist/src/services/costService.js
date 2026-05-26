"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCosts = getCosts;
const prismaClients_1 = require("../db/prismaClients");
const reportFilters_1 = require("../utils/reportFilters");
function toMonthKey(value) {
    if (value instanceof Date) {
        return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
    }
    return String(value).slice(0, 7);
}
async function queryCosts(prisma, empresaId, start, end) {
    const baixaParams = [empresaId, start, end];
    const acordoParams = [empresaId, start, end];
    const baixaNegociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(baixaParams, negociador)).join(', ');
    const acordoNegociadores = reportFilters_1.NEGOTIATORS.map((negociador) => (0, reportFilters_1.addSqlParam)(acordoParams, negociador)).join(', ');
    const baixasQuery = `
    SELECT
      b.databaixa::date AS data,
      COALESCE(b.capitalpago, 0) AS capital_pago,
      COALESCE(b.jurospago, 0) AS juros_pago,
      COALESCE(b.multapago, 0) AS multa_pago,
      COALESCE(b.honorariospago, 0) AS honorarios_pago_portal,
      COALESCE(b.totalpago, 0) AS total_pago_portal
    FROM tb_baixas b
    LEFT JOIN tb_credor c ON c.id = b.idcredor
    WHERE b.idempresa = $1
      AND b.databaixa >= $2
      AND b.databaixa < $3
      AND b.negociador IN (${baixaNegociadores})
      AND b.totalpago > 0
      AND b.idcredor IS NOT NULL
      AND TRIM(COALESCE(c.grupo, '')) != ''
  `;
    const acordosQuery = `
    SELECT ac.data_acordo::date AS data
    FROM tb_acordo ac
    LEFT JOIN tb_credor c ON c.id = ac.idcredor
    WHERE ac.idempresa = $1
      AND ac.idcredor != 31084
      AND ac.data_acordo >= $2
      AND ac.data_acordo < $3
      AND ac.negociador IN (${acordoNegociadores})
      AND ac.status = 'ANDAMENTO'
      AND ac.idcredor IS NOT NULL
      AND TRIM(COALESCE(c.grupo, '')) != ''
  `;
    const baixas = await prisma.$queryRawUnsafe(baixasQuery, ...baixaParams);
    const acordos = await prisma.$queryRawUnsafe(acordosQuery, ...acordoParams);
    return { baixas, acordos };
}
async function getCosts(filter) {
    const months = (0, reportFilters_1.getLastThreeMonths)(filter.periodo);
    const firstRange = months[0];
    const lastRange = months[months.length - 1];
    const firstDate = new Date(`${firstRange}-01T00:00:00Z`);
    const lastDate = new Date(`${lastRange}-01T00:00:00Z`);
    lastDate.setUTCMonth(lastDate.getUTCMonth() + 1);
    const results = await Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryCosts(prisma, empresaId, firstDate, lastDate))));
    const baixas = results.flatMap((result) => result.baixas);
    const acordos = results.flatMap((result) => result.acordos);
    const receitaByMonth = new Map();
    const acordosByMonth = new Map();
    months.forEach((month) => {
        receitaByMonth.set(month, 0);
        acordosByMonth.set(month, 0);
    });
    baixas.forEach((row) => {
        const key = toMonthKey(row.data);
        if (receitaByMonth.has(key))
            receitaByMonth.set(key, receitaByMonth.get(key) + Number(row.total_pago_portal));
    });
    acordos.forEach((row) => {
        const key = toMonthKey(row.data);
        if (acordosByMonth.has(key))
            acordosByMonth.set(key, acordosByMonth.get(key) + 1);
    });
    const values = months.map((month) => ({
        mes: (0, reportFilters_1.formatMonthLabel)(month),
        receita: receitaByMonth.get(month) ?? 0,
        acordos: acordosByMonth.get(month) ?? 0,
    }));
    const latest = values[values.length - 1];
    const previous = values[values.length - 2] ?? { receita: 0, acordos: 0 };
    const totalAtual = latest.receita;
    const totalAnterior = previous.receita;
    const variacao = totalAnterior === 0 ? 0 : ((totalAtual - totalAnterior) / totalAnterior) * 100;
    const custoPorAcordo = latest.acordos > 0 ? totalAtual / latest.acordos : 0;
    const latestPeriod = months[months.length - 1];
    const latestBaixas = baixas.filter((row) => toMonthKey(row.data) === latestPeriod);
    const categories = [
        {
            name: 'Capital',
            value: latestBaixas.reduce((sum, row) => sum + Number(row.capital_pago), 0),
        },
        {
            name: 'Juros',
            value: latestBaixas.reduce((sum, row) => sum + Number(row.juros_pago), 0),
        },
        {
            name: 'Multa',
            value: latestBaixas.reduce((sum, row) => sum + Number(row.multa_pago), 0),
        },
        {
            name: 'Honorários',
            value: latestBaixas.reduce((sum, row) => sum + Number(row.honorarios_pago_portal), 0),
        },
    ];
    return {
        periodo: latestPeriod,
        categories,
        evolution: values,
        comparativo: {
            atual: totalAtual,
            anterior: previous.receita,
            variacao,
            acordos_atual: latest.acordos,
            acordos_anterior: previous.acordos,
            custo_por_acordo: custoPorAcordo,
        },
    };
}
//# sourceMappingURL=costService.js.map