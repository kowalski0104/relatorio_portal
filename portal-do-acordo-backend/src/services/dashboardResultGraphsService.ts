import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../db/prismaClients';
import type { DashboardResultGraphsQuery } from '../routes/schemas';
import { addSqlParam, buildSqlInFilter, getPeriodRange, NEGOTIATORS } from '../utils/reportFilters';
import { CACHE_TTL, cacheKey, getCached } from '../utils/cache';

type DailyRow = {
  dia: Date | string;
  recuperado?: number | string | null;
  acordos?: number | string | null;
  acessos?: number | string | null;
};

type ComponentRow = {
  capital: number | string | null;
  juros: number | string | null;
  multa: number | string | null;
  honorarios: number | string | null;
};

type PaymentCreditorRow = {
  credor: string;
  recuperado: number | string | null;
  pagos: number | string | null;
};

type AgreementCreditorRow = {
  credor: string;
  acordos: number | string | null;
};

type PaymentNegotiatorRow = {
  negociador: string;
  recuperado: number | string | null;
  pagamentos: number | string | null;
};

type AgreementNegotiatorRow = {
  negociador: string;
  acordos: number | string | null;
};

type HourRow = {
  hora: number | string | null;
  acordos: number | string | null;
};

type FunnelRow = {
  acessos: number | string | null;
  negociacoes: number | string | null;
};

type CountRow = {
  total: number | string | null;
};

type CompanyGraphResult = {
  dailyPayments: DailyRow[];
  dailyAgreements: DailyRow[];
  dailyAccesses: DailyRow[];
  components: ComponentRow;
  paymentsByCreditor: PaymentCreditorRow[];
  agreementsByCreditor: AgreementCreditorRow[];
  paymentsByNegotiator: PaymentNegotiatorRow[];
  agreementsByNegotiator: AgreementNegotiatorRow[];
  agreementsByHour: HourRow[];
  accessFunnel: FunnelRow;
  paidCount: number;
  agreementCount: number;
};

function toNumber(value: number | string | null | undefined) {
  return Number(value ?? 0);
}

function dateKey(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function negociadorValues(filter: DashboardResultGraphsQuery) {
  return filter.negociador ? [filter.negociador] : NEGOTIATORS;
}

function buildNegotiatorList(params: unknown[], filter: DashboardResultGraphsQuery) {
  return negociadorValues(filter).map((negociador) => addSqlParam(params, negociador)).join(', ');
}

function buildPaymentCreditorFilter(params: unknown[], filter: DashboardResultGraphsQuery, alias = 'c') {
  return buildSqlInFilter(`TRIM(COALESCE(${alias}.grupo, 'OUTROS'))`, filter.credores, params);
}

function buildAccessAgreementCreditorFilter(params: unknown[], filter: DashboardResultGraphsQuery, alias = 'access_credor') {
  return buildSqlInFilter(`TRIM(COALESCE(${alias}.grupo, 'OUTROS'))`, filter.credores, params);
}

async function queryDailyPayments(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  return prisma.$queryRawUnsafe<DailyRow[]>(
    `
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
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
      GROUP BY b.databaixa::date
      ORDER BY dia
    `,
    ...params
  );
}

async function queryDailyAgreements(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  return prisma.$queryRawUnsafe<DailyRow[]>(
    `
      SELECT
        ac.data_acordo::date AS dia,
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
    `,
    ...params
  );
}

async function queryDailyAccesses(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const credorJoin = filter.credores.length > 0
    ? `
      LEFT JOIN tb_acordo access_acordo ON access_acordo.id = a.idacordo
        AND access_acordo.idempresa = a.idempresa
      LEFT JOIN tb_credor access_credor ON access_credor.id = access_acordo.idcredor
    `
    : '';
  const credorFilter = filter.credores.length > 0 ? buildAccessAgreementCreditorFilter(params, filter) : '';

  return prisma.$queryRawUnsafe<DailyRow[]>(
    `
      SELECT
        a.data_cad::date AS dia,
        COUNT(*)::bigint AS acessos
      FROM tb_portal_neg_acessos a
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
      ${credorJoin}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${credorFilter}
      GROUP BY a.data_cad::date
      ORDER BY dia
    `,
    ...params
  );
}

async function queryComponents(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  const rows = await prisma.$queryRawUnsafe<ComponentRow[]>(
    `
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
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
    `,
    ...params
  );

  return rows[0] ?? { capital: 0, juros: 0, multa: 0, honorarios: 0 };
}

async function queryPaymentsByCreditor(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  return prisma.$queryRawUnsafe<PaymentCreditorRow[]>(
    `
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
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
      GROUP BY TRIM(COALESCE(c.grupo, 'OUTROS'))
    `,
    ...params
  );
}

async function queryAgreementsByCreditor(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  return prisma.$queryRawUnsafe<AgreementCreditorRow[]>(
    `
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
        ${credorFilter}
      GROUP BY TRIM(COALESCE(c.grupo, 'OUTROS'))
    `,
    ...params
  );
}

async function queryPaymentsByNegotiator(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  return prisma.$queryRawUnsafe<PaymentNegotiatorRow[]>(
    `
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
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
      GROUP BY TRIM(COALESCE(b.negociador, 'SEM NEGOCIADOR'))
    `,
    ...params
  );
}

async function queryAgreementsByNegotiator(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  return prisma.$queryRawUnsafe<AgreementNegotiatorRow[]>(
    `
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
    `,
    ...params
  );
}

async function queryAgreementsByHour(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  return prisma.$queryRawUnsafe<HourRow[]>(
    `
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
    `,
    ...params
  );
}

async function queryAccessFunnel(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const credorJoin = filter.credores.length > 0
    ? `
      LEFT JOIN tb_acordo access_acordo ON access_acordo.id = a.idacordo
        AND access_acordo.idempresa = a.idempresa
      LEFT JOIN tb_credor access_credor ON access_credor.id = access_acordo.idcredor
    `
    : '';
  const credorFilter = filter.credores.length > 0 ? buildAccessAgreementCreditorFilter(params, filter) : '';

  const rows = await prisma.$queryRawUnsafe<FunnelRow[]>(
    `
      SELECT
        COUNT(*)::bigint AS acessos,
        COUNT(DISTINCT a.id_portal_neg)::bigint AS negociacoes
      FROM tb_portal_neg_acessos a
      LEFT JOIN tb_acordo ac ON ac.processo = a.processo
        AND ac.idempresa = a.idempresa
        AND ac.status = 'ANDAMENTO'
      ${credorJoin}
      WHERE a.idempresa = $1
        AND a.data_cad >= $2
        AND a.data_cad < $3
        ${credorFilter}
    `,
    ...params
  );

  return rows[0] ?? { acessos: 0, negociacoes: 0 };
}

async function queryPaidCount(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  const rows = await prisma.$queryRawUnsafe<CountRow[]>(
    `
      SELECT COUNT(DISTINCT b.processo)::bigint AS total
      FROM tb_baixas b
      LEFT JOIN tb_credor c ON c.id = b.idcredor
      WHERE b.idempresa = $1
        AND b.databaixa >= $2
        AND b.databaixa < $3
        AND b.negociador IN (${negociadores})
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''
        ${credorFilter}
    `,
    ...params
  );

  return toNumber(rows[0]?.total);
}

async function queryAgreementCount(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const negociadores = buildNegotiatorList(params, filter);
  const credorFilter = buildPaymentCreditorFilter(params, filter);

  const rows = await prisma.$queryRawUnsafe<CountRow[]>(
    `
      SELECT COUNT(*)::bigint AS total
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
    `,
    ...params
  );

  return toNumber(rows[0]?.total);
}

async function queryCompanyGraphs(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery): Promise<CompanyGraphResult> {
  const [
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
  ] = await Promise.all([
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

function mergeDaily(results: CompanyGraphResult[]) {
  const rows = new Map<string, { dia: string; recuperado: number; acordos: number; acessos: number }>();
  const ensure = (dia: Date | string) => {
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

function mergeComponents(results: CompanyGraphResult[]) {
  return results.reduce(
    (sum, result) => ({
      capital: sum.capital + toNumber(result.components.capital),
      juros: sum.juros + toNumber(result.components.juros),
      multa: sum.multa + toNumber(result.components.multa),
      honorarios: sum.honorarios + toNumber(result.components.honorarios),
    }),
    { capital: 0, juros: 0, multa: 0, honorarios: 0 }
  );
}

function mergeByCredor(results: CompanyGraphResult[]) {
  const rows = new Map<string, { credor: string; recuperado: number; acordos: number; pagos: number; ticket: number; conversaoPago: number }>();
  const ensure = (credor: string) => {
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

function mergeByNegotiator(results: CompanyGraphResult[]) {
  const rows = new Map<string, { negociador: string; recuperado: number; pagamentos: number; acordos: number; conversao: number }>();
  const ensure = (negociador: string) => {
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

function mergeByHour(results: CompanyGraphResult[]) {
  const hours = new Map<number, { hora: number; acordos: number }>();
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

function mergeFunnel(results: CompanyGraphResult[]) {
  return results.reduce(
    (sum, result) => ({
      acessos: sum.acessos + toNumber(result.accessFunnel.acessos),
      negociacoes: sum.negociacoes + toNumber(result.accessFunnel.negociacoes),
      acordos: sum.acordos + result.agreementCount,
      pagos: sum.pagos + result.paidCount,
    }),
    { acessos: 0, negociacoes: 0, acordos: 0, pagos: 0 }
  );
}

function buildGraphResponse(results: CompanyGraphResult[], filter: DashboardResultGraphsQuery) {
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

async function buildDashboardResultGraphs(filter: DashboardResultGraphsQuery) {
  const results = await Promise.all(
    getLiveClients(filter.sistema).map(({ empresaId, query }) =>
      query((prisma) => queryCompanyGraphs(prisma, empresaId, filter))
    )
  );

  return buildGraphResponse(results, filter);
}

export async function getDashboardResultGraphs(filter: DashboardResultGraphsQuery) {
  return getCached(cacheKey('dashboard-result-graphs', filter), CACHE_TTL.RESULTS, () => buildDashboardResultGraphs(filter));
}
