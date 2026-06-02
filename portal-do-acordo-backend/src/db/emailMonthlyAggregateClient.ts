import { PrismaClient } from '@prisma/client';

let client: PrismaClient | null = null;

export function hasEmailMonthlyAggregateDatabaseConfig() {
  return Boolean(process.env.EMAIL_MONTHLY_AGGREGATE_DATABASE_URL);
}

export function getEmailMonthlyAggregateClient() {
  const url = process.env.EMAIL_MONTHLY_AGGREGATE_DATABASE_URL;
  if (!url) {
    throw new Error('Variavel de ambiente EMAIL_MONTHLY_AGGREGATE_DATABASE_URL nao configurada.');
  }

  if (!client) {
    client = new PrismaClient({ datasources: { db: { url } } });
  }
  return client;
}

export async function disconnectEmailMonthlyAggregateClient() {
  if (!client) return;
  await client.$disconnect();
  client = null;
}
