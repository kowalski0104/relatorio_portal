import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import { getPeriodRange, SystemFilter } from '../utils/reportFilters';
import { CACHE_TTL, cacheKey, getCached } from '../utils/cache';

type PeriodRow = {
  periodo: string | null;
};

async function queryPeriods(prisma: PrismaClient, empresaId: number) {
  const range = getPeriodRange();

  const rows = await prisma.$queryRawUnsafe<PeriodRow[]>(
    `
      SELECT to_char(mes, 'YYYY-MM') AS periodo
      FROM (
        SELECT DISTINCT date_trunc('month', b.databaixa)::date AS mes
        FROM tb_baixas b
        WHERE b.idempresa = $1
          AND b.databaixa >= $2
          AND b.databaixa < $3
          AND b.totalpago > 0
          AND b.idcredor IS NOT NULL

        UNION

        SELECT DISTINCT date_trunc('month', ac.data_acordo)::date AS mes
        FROM tb_acordo ac
        WHERE ac.idempresa = $1
          AND ac.data_acordo >= $2
          AND ac.data_acordo < $3
          AND ac.status = 'ANDAMENTO'
          AND ac.idcredor IS NOT NULL

        UNION

        SELECT DISTINCT date_trunc('month', a.data_cad)::date AS mes
        FROM tb_portal_neg_acessos a
        WHERE a.idempresa = $1
          AND a.data_cad >= $2
          AND a.data_cad < $3

        UNION

        SELECT DISTINCT date_trunc('month', b.data_cad)::date AS mes
        FROM tb_borderos_tit b
        WHERE b.idempresa = $1
          AND b.data_cad >= $2
          AND b.data_cad < $3
      ) periodos
      WHERE mes IS NOT NULL
      ORDER BY periodo DESC
    `,
    empresaId,
    range.start,
    range.end
  );

  return rows.map((row) => row.periodo).filter(Boolean) as string[];
}

export async function getPeriods(filter: { sistema?: SystemFilter }) {
  return getCached(cacheKey('periods', filter), CACHE_TTL.PERIODS, async () => {
    const results = await Promise.all(
      getLiveClients(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryPeriods(prisma, empresaId)))
    );

    return {
      data: Array.from(new Set(results.flat())).sort().reverse(),
    };
  });
}
