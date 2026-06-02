import assert from 'node:assert/strict';
import { performance } from 'perf_hooks';
import type { PrismaClient } from '@prisma/client';
import { disconnectEmailMonthlyAggregateClient, getEmailMonthlyAggregateClient } from '../src/db/emailMonthlyAggregateClient';
import { getLiveClients } from '../src/db/prismaClients';
import { getCommunication } from '../src/services/communicationService';
import type { CompanyId, SystemFilter } from '../src/utils/reportFilters';

type QuantityRow = {
  mes: Date | string;
  idcredor: number | string | null;
  qtde_emails: number | string;
};

const companies: CompanyId[] = [401, 1007];

function argument(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function parseMonth(value: string | undefined, fallback: string, name: string) {
  const month = value ?? fallback;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error(`Parametro --${name}=YYYY-MM invalido.`);
  return month;
}

function addMonth(value: string, increment: number) {
  const date = new Date(`${value}-01T00:00:00Z`);
  date.setUTCMonth(date.getUTCMonth() + increment);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function monthRange(start: string, end: string) {
  const months: string[] = [];
  for (let month = start; month <= end; month = addMonth(month, 1)) months.push(month);
  if (months.length === 0) throw new Error(`Intervalo invalido: ${start}..${end}.`);
  return months;
}

function selectedCompanies() {
  const value = argument('empresa') ?? 'all';
  if (value === 'all') return companies;
  const company = Number(value);
  if (company === 401 || company === 1007) return [company] as CompanyId[];
  throw new Error('Parametro --empresa deve ser 401, 1007 ou all.');
}

function monthKey(value: Date | string) {
  return value instanceof Date ? value.toISOString().slice(0, 7) : String(value).slice(0, 7);
}

function creditorKey(row: QuantityRow) {
  return `${monthKey(row.mes)}::${row.idcredor === null ? 'NULL' : String(row.idcredor)}`;
}

function toMap(rows: QuantityRow[]) {
  return new Map(rows.map((row) => [creditorKey(row), Number(row.qtde_emails)]));
}

function differenceCount(source: QuantityRow[], aggregate: QuantityRow[]) {
  const sourceMap = toMap(source);
  const aggregateMap = toMap(aggregate);
  return Array.from(new Set([...sourceMap.keys(), ...aggregateMap.keys()]))
    .filter((key) => (sourceMap.get(key) ?? 0) !== (aggregateMap.get(key) ?? 0))
    .length;
}

function total(rows: QuantityRow[], month: string) {
  return rows.filter((row) => monthKey(row.mes) === month).reduce((sum, row) => sum + Number(row.qtde_emails), 0);
}

async function querySource(prisma: PrismaClient, empresa: CompanyId, start: string, end: string, dashboard: boolean) {
  const dashboardFilter = dashboard
    ? `
      AND COALESCE(NULLIF(TRIM(c.grupo), ''), NULLIF(TRIM(c.razaosocial), '')) IS NOT NULL
      AND COALESCE(c.razaosocial, '') NOT ILIKE '%MODELO%'
      AND COALESCE(c.razaosocial, '') NOT ILIKE '%SISTH%'
      AND COALESCE(c.razaosocial, '') NOT ILIKE '%CONNECTH%'
    `
    : '';
  return prisma.$queryRawUnsafe<QuantityRow[]>(`
    SELECT date_trunc('month', e.data)::date AS mes,
           e.idcredor,
           COUNT(*)::bigint AS qtde_emails
    FROM tb_emails_enviados e
    LEFT JOIN tb_credor c ON c.id = e.idcredor
    WHERE e.idempresa = $1
      AND e.data >= $2::date
      AND e.data < $3::date
      ${dashboardFilter}
    GROUP BY date_trunc('month', e.data)::date, e.idcredor
    ORDER BY 1, 2
  `, empresa, start, end);
}

async function queryAggregate(prisma: PrismaClient, empresa: CompanyId, start: string, end: string, dashboard: boolean) {
  return prisma.$queryRawUnsafe<QuantityRow[]>(`
    SELECT mes, idcredor, SUM(qtde_emails)::bigint AS qtde_emails
    FROM ${dashboard ? 'portal_email_envios_dashboard' : 'portal_email_envios_mensal'}
    WHERE idempresa = $1
      AND mes >= $2::date
      AND mes < $3::date
    GROUP BY mes, idcredor
    ORDER BY 1, 2
  `, empresa, start, end);
}

function normalizeApiRelevant(value: Awaited<ReturnType<typeof getCommunication>>) {
  return {
    envios: value.envios,
    por_credor: value.por_credor,
    mensal: value.mensal,
    diario: value.diario,
  };
}

async function assertApplicationDatabase(prisma: PrismaClient) {
  const [environment] = await prisma.$queryRawUnsafe<Array<{
    aggregate_table: string | null;
    dashboard_view: string | null;
  }>>(`
    SELECT to_regclass('public.portal_email_envios_mensal')::text AS aggregate_table,
           to_regclass('public.portal_email_envios_dashboard')::text AS dashboard_view
  `);
  if (!environment.aggregate_table || !environment.dashboard_view) {
    throw new Error('Tabela ou view mensal ausente no banco da aplicacao. Execute npm run ddl:email-mensal -- --apply.');
  }
}

async function validateDatabase(months: string[], selected: CompanyId[]) {
  const crm = new Map(getLiveClients('total').map((client) => [client.empresaId, client]));
  const application = getEmailMonthlyAggregateClient();
  const start = `${months[0]}-01`;
  const end = `${addMonth(months[months.length - 1], 1)}-01`;

  try {
    await assertApplicationDatabase(application);
    for (const empresa of selected) {
      const client = crm.get(empresa);
      if (!client) throw new Error(`Conexao CRM ausente para empresa ${empresa}.`);
      const [sourceRaw, sourceDashboard, aggregateRaw, aggregateDashboard] = await Promise.all([
        client.query((prisma) => querySource(prisma, empresa, start, end, false)),
        client.query((prisma) => querySource(prisma, empresa, start, end, true)),
        queryAggregate(application, empresa, start, end, false),
        queryAggregate(application, empresa, start, end, true),
      ]);

      const rawDifferences = differenceCount(sourceRaw, aggregateRaw);
      const dashboardDifferences = differenceCount(sourceDashboard, aggregateDashboard);
      for (const mes of months) {
        const row = {
          empresa,
          mes,
          origem_bruta: total(sourceRaw, mes),
          auxiliar_bruta: total(aggregateRaw, mes),
          origem_dashboard: total(sourceDashboard, mes),
          auxiliar_dashboard: total(aggregateDashboard, mes),
          divergencias_idcredor_bruto: rawDifferences,
          divergencias_idcredor_dashboard: dashboardDifferences,
        };
        console.log(JSON.stringify({ ...row, status: Object.entries(row).some(([key, value]) => key.startsWith('divergencias_') && value !== 0) || row.origem_bruta !== row.auxiliar_bruta || row.origem_dashboard !== row.auxiliar_dashboard ? 'FALHA' : 'OK' }));
        assert.equal(row.auxiliar_bruta, row.origem_bruta);
        assert.equal(row.auxiliar_dashboard, row.origem_dashboard);
      }
      assert.equal(rawDifferences, 0);
      assert.equal(dashboardDifferences, 0);
    }
  } finally {
    await Promise.all([
      ...Array.from(crm.values()).map(({ prisma }) => prisma.$disconnect()),
      disconnectEmailMonthlyAggregateClient(),
    ]);
  }
}

async function validateApi(months: string[], selected: CompanyId[]) {
  const systems: SystemFilter[] = selected.length === 2 ? ['consulth', 'sisth', 'total'] : selected[0] === 401 ? ['consulth'] : ['sisth'];
  for (const sistema of systems) {
    for (const periodo of months) {
      const filter = { periodo, sistema, credores: [], diario: false };
      process.env.USE_EMAIL_MONTHLY_AGGREGATE = 'false';
      const sourceStartedAt = performance.now();
      const source = normalizeApiRelevant(await getCommunication(filter));
      const sourceMs = performance.now() - sourceStartedAt;

      process.env.USE_EMAIL_MONTHLY_AGGREGATE = 'true';
      const aggregateStartedAt = performance.now();
      const aggregate = normalizeApiRelevant(await getCommunication(filter));
      const aggregateMs = performance.now() - aggregateStartedAt;

      assert.deepEqual(aggregate, source);
      console.log(JSON.stringify({
        sistema,
        periodo,
        api_json_relevante: 'OK',
        origem_ms: Number(sourceMs.toFixed(2)),
        auxiliar_ms: Number(aggregateMs.toFixed(2)),
      }));
    }
  }
}

async function main() {
  const months = monthRange(parseMonth(argument('inicio'), '2026-01', 'inicio'), parseMonth(argument('fim'), '2026-06', 'fim'));
  const selected = selectedCompanies();
  await validateDatabase(months, selected);
  await validateApi(months, selected);
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(disconnectEmailMonthlyAggregateClient);
