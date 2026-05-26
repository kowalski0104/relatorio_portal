import { getLiveClients } from './liveClients';
import { getPeriodoRange } from './shared';
async function queryCredores(prisma, empresaId, periodo) {
    const range = getPeriodoRange(periodo);
    const params = [empresaId, range.start, range.end];
    const query = `
    SELECT DISTINCT credor
    FROM (
      SELECT TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor
      FROM tb_baixas b
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND b.databaixa >= $2
        AND b.databaixa < $3
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''

      UNION

      SELECT TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor
      FROM tb_acordo ac
      LEFT JOIN tb_credor c ON c.id = ac.idcredor
      WHERE ac.idempresa = $1
        AND ac.idcredor != 31084
        AND ac.data_acordo >= $2
        AND ac.data_acordo < $3
        AND ac.status = 'ANDAMENTO'
        AND ac.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''

      UNION

      SELECT TRIM(COALESCE(c.grupo, 'OUTROS')) AS credor
      FROM tb_portal_neg_acessos a
      LEFT JOIN tb_baixas b ON b.processo = a.processo AND b.idempresa = a.idempresa
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        AND b.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''
    ) credores
    WHERE credor IS NOT NULL AND credor != ''
    ORDER BY credor
  `;
    return prisma.$queryRawUnsafe(query, ...params);
}
export async function getCredores(filter) {
    const results = await Promise.all(getLiveClients(filter.sistema).map(({ empresaId, prisma }) => queryCredores(prisma, empresaId, filter.periodo)));
    const set = new Set();
    results.flat().forEach((item) => {
        if (item.credor)
            set.add(String(item.credor));
    });
    return Array.from(set).sort();
}
//# sourceMappingURL=credoresService.js.map