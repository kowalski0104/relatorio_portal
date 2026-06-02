import { promises as fs } from 'fs';
import path from 'path';
import { performance } from 'perf_hooks';
import type { PrismaClient } from '@prisma/client';
import { disconnectEmailMonthlyAggregateClient, getEmailMonthlyAggregateClient } from '../src/db/emailMonthlyAggregateClient';
import { getLiveClients } from '../src/db/prismaClients';
import type { CompanyId } from '../src/utils/reportFilters';

type SourceRow = {
  idempresa: number | string;
  mes: Date | string;
  idcredor: number | string | null;
  grupo: string | null;
  razaosocial: string | null;
  qtde_emails: number | string;
};

type LogRow = {
  empresa: CompanyId;
  mes: string;
  linhas_agregadas: number;
  emails: number;
  tempo_ms: number;
  status: 'ok' | 'failed';
  erro?: string;
};

const companies: CompanyId[] = [401, 1007];

function argument(name: string) {
  return process.argv.find((value) => value.startsWith(`--${name}=`))?.slice(name.length + 3);
}

function parseMonth(value: string | undefined, name: string) {
  if (!value || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
    throw new Error(`Parametro --${name}=YYYY-MM obrigatorio.`);
  }
  return value;
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
  const value = argument('empresa');
  if (value === 'all') return companies;
  const company = Number(value);
  if (company === 401 || company === 1007) return [company] as CompanyId[];
  throw new Error('Parametro --empresa=401|1007|all obrigatorio.');
}

function assertControlledExecution() {
  if (!process.argv.includes('--apply')) {
    throw new Error('Refresh bloqueado. Confirme a execucao com --apply.');
  }
  if (process.env.ALLOW_EMAIL_MONTHLY_AGGREGATE_REFRESH !== 'true') {
    throw new Error('Refresh bloqueado. Configure ALLOW_EMAIL_MONTHLY_AGGREGATE_REFRESH=true.');
  }

  const aggregateUrl = process.env.EMAIL_MONTHLY_AGGREGATE_DATABASE_URL;
  if (!aggregateUrl) {
    throw new Error('Configure EMAIL_MONTHLY_AGGREGATE_DATABASE_URL com o PostgreSQL proprio da aplicacao.');
  }
  if ([process.env.DATABASE_URL_401, process.env.DATABASE_URL_1007].includes(aggregateUrl)) {
    throw new Error('Refresh bloqueado: EMAIL_MONTHLY_AGGREGATE_DATABASE_URL nao pode apontar para um banco CRM.');
  }
}

function monthBounds(month: string) {
  return { start: `${month}-01`, end: `${addMonth(month, 1)}-01` };
}

async function readSource(prisma: PrismaClient, empresa: CompanyId, month: string) {
  const { start, end } = monthBounds(month);
  return prisma.$queryRawUnsafe<SourceRow[]>(`
    SELECT e.idempresa,
           date_trunc('month', e.data)::date AS mes,
           e.idcredor,
           TRIM(c.grupo) AS grupo,
           TRIM(c.razaosocial) AS razaosocial,
           COUNT(*)::bigint AS qtde_emails
    FROM tb_emails_enviados e
    LEFT JOIN tb_credor c ON c.id = e.idcredor
    WHERE e.idempresa = $1
      AND e.data >= $2::date
      AND e.data < $3::date
    GROUP BY e.idempresa, date_trunc('month', e.data)::date, e.idcredor, TRIM(c.grupo), TRIM(c.razaosocial)
    ORDER BY e.idcredor NULLS FIRST
  `, empresa, start, end);
}

async function writeMonth(prisma: PrismaClient, empresa: CompanyId, month: string, rows: SourceRow[]) {
  const { start, end } = monthBounds(month);
  await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe(`
      DELETE FROM portal_email_envios_mensal
      WHERE idempresa = $1 AND mes >= $2::date AND mes < $3::date
    `, empresa, start, end);

    const batchSize = 250;
    for (let offset = 0; offset < rows.length; offset += batchSize) {
      const batch = rows.slice(offset, offset + batchSize);
      const params: unknown[] = [];
      const values = batch.map((row) => {
        params.push(Number(row.idempresa), start, row.idcredor === null ? null : Number(row.idcredor), row.grupo, row.razaosocial, Number(row.qtde_emails));
        const index = params.length - 5;
        return `($${index}, $${index + 1}::date, $${index + 2}, $${index + 3}, $${index + 4}, $${index + 5}, now())`;
      });

      await tx.$executeRawUnsafe(`
        INSERT INTO portal_email_envios_mensal (
          idempresa, mes, idcredor, grupo, razaosocial, qtde_emails, atualizado_em
        ) VALUES ${values.join(', ')}
        ON CONFLICT (idempresa, mes, idcredor) DO UPDATE SET
          grupo = EXCLUDED.grupo,
          razaosocial = EXCLUDED.razaosocial,
          qtde_emails = EXCLUDED.qtde_emails,
          atualizado_em = now()
      `, ...params);
    }
  });
}

async function assertApplicationDatabase(prisma: PrismaClient) {
  const [environment] = await prisma.$queryRawUnsafe<Array<{
    database: string;
    username: string;
    transaction_read_only: string;
    aggregate_table: string | null;
  }>>(`
    SELECT current_database() AS database,
           current_user AS username,
           current_setting('transaction_read_only') AS transaction_read_only,
           to_regclass('public.portal_email_envios_mensal')::text AS aggregate_table
  `);
  if (environment.transaction_read_only === 'on') throw new Error(`Banco da aplicacao ${environment.database} esta somente leitura.`);
  if (!environment.aggregate_table) throw new Error('portal_email_envios_mensal nao existe. Execute npm run ddl:email-mensal -- --apply.');
  return environment;
}

async function main() {
  assertControlledExecution();
  const selected = selectedCompanies();
  const months = monthRange(parseMonth(argument('inicio'), 'inicio'), parseMonth(argument('fim'), 'fim'));
  const crm = new Map(getLiveClients('total').map((client) => [client.empresaId, client]));
  const application = getEmailMonthlyAggregateClient();
  const log: LogRow[] = [];
  const generatedAt = new Date().toISOString();

  try {
    const environment = await assertApplicationDatabase(application);
    console.log(JSON.stringify({ banco_aplicacao: environment.database, usuario: environment.username }));

    for (const empresa of selected) {
      const client = crm.get(empresa);
      if (!client) throw new Error(`Conexao CRM ausente para empresa ${empresa}.`);

      for (const month of months) {
        const startedAt = performance.now();
        try {
          const rows = await client.query((prisma) => readSource(prisma, empresa, month));
          await writeMonth(application, empresa, month, rows);
          const result: LogRow = {
            empresa,
            mes: month,
            linhas_agregadas: rows.length,
            emails: rows.reduce((sum, row) => sum + Number(row.qtde_emails), 0),
            tempo_ms: Number((performance.now() - startedAt).toFixed(2)),
            status: 'ok',
          };
          log.push(result);
          console.log(JSON.stringify(result));
        } catch (error) {
          const result: LogRow = {
            empresa,
            mes: month,
            linhas_agregadas: 0,
            emails: 0,
            tempo_ms: Number((performance.now() - startedAt).toFixed(2)),
            status: 'failed',
            erro: error instanceof Error ? error.message : String(error),
          };
          log.push(result);
          console.error(JSON.stringify(result));
          throw error;
        }
      }
    }
  } finally {
    const output = path.resolve(process.cwd(), 'data', `refresh-email-mensal-${generatedAt.replace(/[:.]/g, '-')}.json`);
    await fs.mkdir(path.dirname(output), { recursive: true });
    await fs.writeFile(output, JSON.stringify({ generatedAt, rows: log }, null, 2), 'utf-8');
    console.log(`Log salvo em ${output}`);
    await Promise.all([
      ...Array.from(crm.values()).map(({ prisma }) => prisma.$disconnect()),
      disconnectEmailMonthlyAggregateClient(),
    ]);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
