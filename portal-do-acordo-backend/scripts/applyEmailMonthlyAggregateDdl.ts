import { promises as fs } from 'fs';
import path from 'path';
import { disconnectEmailMonthlyAggregateClient, getEmailMonthlyAggregateClient } from '../src/db/emailMonthlyAggregateClient';

function assertControlledExecution() {
  if (!process.argv.includes('--apply')) {
    throw new Error('DDL bloqueado. Confirme a execucao com --apply.');
  }
  if (process.env.ALLOW_EMAIL_MONTHLY_AGGREGATE_DDL !== 'true') {
    throw new Error('DDL bloqueado. Configure ALLOW_EMAIL_MONTHLY_AGGREGATE_DDL=true.');
  }

  const aggregateUrl = process.env.EMAIL_MONTHLY_AGGREGATE_DATABASE_URL;
  if (!aggregateUrl) {
    throw new Error('Configure EMAIL_MONTHLY_AGGREGATE_DATABASE_URL com o PostgreSQL proprio da aplicacao.');
  }
  if ([process.env.DATABASE_URL_401, process.env.DATABASE_URL_1007].includes(aggregateUrl)) {
    throw new Error('DDL bloqueado: EMAIL_MONTHLY_AGGREGATE_DATABASE_URL nao pode apontar para um banco CRM.');
  }
}

async function main() {
  assertControlledExecution();
  const prisma = getEmailMonthlyAggregateClient();
  const [environment] = await prisma.$queryRawUnsafe<Array<{
    database: string;
    username: string;
    transaction_read_only: string;
  }>>(`
    SELECT current_database() AS database,
           current_user AS username,
           current_setting('transaction_read_only') AS transaction_read_only
  `);

  if (environment.transaction_read_only === 'on') {
    throw new Error(`DDL bloqueado: ${environment.database} esta configurado como somente leitura.`);
  }

  const ddlPath = path.resolve(process.cwd(), 'database', 'portal_email_envios_mensal.homologacao.sql');
  const ddl = await fs.readFile(ddlPath, 'utf-8');
  const statements = ddl
    .split(/;\s*(?:\r?\n|$)/)
    .map((statement) => statement.trim())
    .filter(Boolean);

  for (const statement of statements) {
    await prisma.$executeRawUnsafe(statement);
  }

  const [objects] = await prisma.$queryRawUnsafe<Array<{
    aggregate_table: string | null;
    dashboard_view: string | null;
  }>>(`
    SELECT to_regclass('public.portal_email_envios_mensal')::text AS aggregate_table,
           to_regclass('public.portal_email_envios_dashboard')::text AS dashboard_view
  `);
  console.log(JSON.stringify({ ...environment, ...objects, status: 'ok' }));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  })
  .finally(disconnectEmailMonthlyAggregateClient);
