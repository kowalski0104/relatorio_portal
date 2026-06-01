import { PrismaClient } from '@prisma/client';
import { getLiveClients } from '../src/db/prismaClients';
import { getCosts } from '../src/services/costService';
import { getPeriods } from '../src/services/periodService';
import { addSqlParam, formatMonthLabel, getLastThreeMonths, NEGOTIATORS, SystemFilter } from '../src/utils/reportFilters';

type Scenario = {
  periodo: string;
  sistema: SystemFilter;
  source?: 'fixed' | 'latest';
};

type OldPaymentRow = {
  mes: Date | string;
  capital_pago: number | string;
  juros_pago: number | string;
  multa_pago: number | string;
  honorarios_pago_portal: number | string;
  total_pago_portal: number | string;
};

type OldAgreementRow = {
  mes: Date | string;
};

const TOLERANCE = 0.000001;

function monthKey(value: Date | string) {
  if (value instanceof Date) {
    return `${value.getUTCFullYear()}-${String(value.getUTCMonth() + 1).padStart(2, '0')}`;
  }

  return String(value).slice(0, 7);
}

async function queryOldCosts(prisma: PrismaClient, empresaId: number, start: Date, end: Date) {
  const paymentParams: unknown[] = [empresaId, start, end];
  const agreementParams: unknown[] = [empresaId, start, end];
  const paymentNegotiators = NEGOTIATORS.map((negotiator) => addSqlParam(paymentParams, negotiator)).join(', ');
  const agreementNegotiators = NEGOTIATORS.map((negotiator) => addSqlParam(agreementParams, negotiator)).join(', ');

  const payments = await prisma.$queryRawUnsafe<OldPaymentRow[]>(
    `
      SELECT b.databaixa AS mes,
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
        AND b.negociador IN (${paymentNegotiators})
        AND b.totalpago > 0
        AND b.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''
    `,
    ...paymentParams
  );

  const agreements = await prisma.$queryRawUnsafe<OldAgreementRow[]>(
    `
      SELECT ac.data_acordo AS mes
      FROM tb_acordo ac
      LEFT JOIN tb_credor c ON c.id = ac.idcredor
      WHERE ac.idempresa = $1
        AND ac.idcredor != 31084
        AND ac.data_acordo >= $2
        AND ac.data_acordo < $3
        AND ac.negociador IN (${agreementNegotiators})
        AND ac.status = 'ANDAMENTO'
        AND ac.idcredor IS NOT NULL
        AND TRIM(COALESCE(c.grupo, '')) != ''
    `,
    ...agreementParams
  );

  return { payments, agreements };
}

async function buildOldCosts(filter: Scenario) {
  const months = getLastThreeMonths(filter.periodo);
  const start = new Date(`${months[0]}-01T00:00:00Z`);
  const end = new Date(`${months[months.length - 1]}-01T00:00:00Z`);
  end.setUTCMonth(end.getUTCMonth() + 1);

  const results = await Promise.all(
    getLiveClients(filter.sistema).map(({ empresaId, query }) =>
      query((prisma) => queryOldCosts(prisma, empresaId, start, end))
    )
  );
  const payments = results.flatMap((result) => result.payments);
  const agreements = results.flatMap((result) => result.agreements);
  const revenueByMonth = new Map(months.map((month) => [month, 0]));
  const agreementsByMonth = new Map(months.map((month) => [month, 0]));

  payments.forEach((row) => {
    const key = monthKey(row.mes);
    revenueByMonth.set(key, (revenueByMonth.get(key) ?? 0) + Number(row.total_pago_portal));
  });
  agreements.forEach((row) => {
    const key = monthKey(row.mes);
    agreementsByMonth.set(key, (agreementsByMonth.get(key) ?? 0) + 1);
  });

  const evolution = months.map((month) => ({
    mes: formatMonthLabel(month),
    receita: revenueByMonth.get(month) ?? 0,
    acordos: agreementsByMonth.get(month) ?? 0,
  }));
  const latest = evolution[evolution.length - 1];
  const previous = evolution[evolution.length - 2] ?? { receita: 0, acordos: 0 };
  const latestPayments = payments.filter((row) => monthKey(row.mes) === months[months.length - 1]);
  const sum = (field: keyof Omit<OldPaymentRow, 'mes'>) =>
    latestPayments.reduce((total, row) => total + Number(row[field]), 0);

  return {
    periodo: months[months.length - 1],
    categories: [
      { name: 'Capital', value: sum('capital_pago') },
      { name: 'Juros', value: sum('juros_pago') },
      { name: 'Multa', value: sum('multa_pago') },
      { name: 'Honorários', value: sum('honorarios_pago_portal') },
    ],
    evolution,
    comparativo: {
      atual: latest.receita,
      anterior: previous.receita,
      variacao: previous.receita === 0 ? 0 : ((latest.receita - previous.receita) / previous.receita) * 100,
      acordos_atual: latest.acordos,
      acordos_anterior: previous.acordos,
      custo_por_acordo: latest.acordos > 0 ? latest.receita / latest.acordos : 0,
    },
  };
}

function compare(left: unknown, right: unknown, path = 'root') {
  let maxDifference = 0;
  const differences: string[] = [];

  function visit(oldValue: unknown, newValue: unknown, currentPath: string) {
    if (typeof oldValue === 'number' && typeof newValue === 'number') {
      const difference = Math.abs(oldValue - newValue);
      maxDifference = Math.max(maxDifference, difference);
      if (difference > TOLERANCE) differences.push(`${currentPath}: ${oldValue} != ${newValue}`);
      return;
    }

    if (Array.isArray(oldValue) && Array.isArray(newValue)) {
      if (oldValue.length !== newValue.length) differences.push(`${currentPath}.length: ${oldValue.length} != ${newValue.length}`);
      for (let index = 0; index < Math.max(oldValue.length, newValue.length); index += 1) {
        visit(oldValue[index], newValue[index], `${currentPath}[${index}]`);
      }
      return;
    }

    if (oldValue && newValue && typeof oldValue === 'object' && typeof newValue === 'object') {
      const keys = new Set([...Object.keys(oldValue), ...Object.keys(newValue)]);
      keys.forEach((key) => visit(
        (oldValue as Record<string, unknown>)[key],
        (newValue as Record<string, unknown>)[key],
        `${currentPath}.${key}`
      ));
      return;
    }

    if (oldValue !== newValue) differences.push(`${currentPath}: ${String(oldValue)} != ${String(newValue)}`);
  }

  visit(left, right, path);
  return { maxDifference, differences };
}

async function getScenarios() {
  const scenarios: Scenario[] = [
    { periodo: '2026-05', sistema: 'total' },
    { periodo: '2026-05', sistema: 'consulth' },
    { periodo: '2026-05', sistema: 'sisth' },
    { periodo: '2026-04', sistema: 'total' },
    { periodo: '2000-01', sistema: 'total' },
  ];
  const latestPeriod = (await getPeriods({ sistema: 'total' })).data[0];

  if (latestPeriod && !scenarios.some((scenario) => scenario.periodo === latestPeriod && scenario.sistema === 'total')) {
    scenarios.push({ periodo: latestPeriod, sistema: 'total', source: 'latest' });
  }

  return scenarios;
}

async function main() {
  const scenarios = await getScenarios();
  const results = [];

  for (const scenario of scenarios) {
    const oldCosts = await buildOldCosts(scenario);
    const newCosts = await getCosts(scenario);
    const comparison = compare(oldCosts, newCosts);
    results.push({
      cenario: `${scenario.periodo}, ${scenario.sistema}${scenario.source === 'latest' ? ' (recente)' : ''}`,
      antigo: oldCosts.comparativo.atual,
      novo: newCosts.comparativo.atual,
      diferenca_absoluta: Math.abs(oldCosts.comparativo.atual - newCosts.comparativo.atual),
      maior_diferenca_contrato: comparison.maxDifference,
      status: comparison.differences.length === 0 ? 'OK' : 'FALHA',
    });

    if (comparison.differences.length > 0) {
      console.error(`Divergencias em ${scenario.periodo}, ${scenario.sistema}:`);
      comparison.differences.forEach((difference) => console.error(`  ${difference}`));
    }
  }

  console.table(results);
  if (results.some((result) => result.status === 'FALHA')) process.exitCode = 1;
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.all(getLiveClients('total').map(({ prisma }) => prisma.$disconnect()));
  });
