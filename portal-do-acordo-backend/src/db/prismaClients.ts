import { PrismaClient } from '@prisma/client';
import { CompanyId, getSystemCompanyIds, SystemFilter } from '../utils/reportFilters';

const databaseEnvByCompany: Record<CompanyId, string> = {
  401: 'DATABASE_URL_401',
  1007: 'DATABASE_URL_1007',
};

const clientsByCompany: Partial<Record<CompanyId, PrismaClient>> = {};
const clientQueues: Record<CompanyId, Promise<unknown>> = {
  401: Promise.resolve(),
  1007: Promise.resolve(),
};

export function getLiveClients(system?: SystemFilter) {
  return getSystemCompanyIds(system).map((companyId) => ({
    empresaId: companyId,
    prisma: getClient(companyId),
    query: <T>(operation: (prisma: PrismaClient) => Promise<T>) => runQueued(companyId, operation),
  }));
}

export function hasDatabaseConfig() {
  return getSystemCompanyIds('total').every((companyId) => Boolean(process.env[databaseEnvByCompany[companyId]]));
}

function getClient(companyId: CompanyId) {
  const current = clientsByCompany[companyId];
  if (current) return current;

  const envName = databaseEnvByCompany[companyId];
  const url = process.env[envName];
  if (!url) throw new Error(`Variável de ambiente ${envName} não configurada.`);

  const client = new PrismaClient({ datasources: { db: { url } } });
  clientsByCompany[companyId] = client;
  return client;
}

function runQueued<T>(companyId: CompanyId, operation: (prisma: PrismaClient) => Promise<T>) {
  const run = () => operation(getClient(companyId));
  const next = clientQueues[companyId].catch(() => undefined).then(run);
  clientQueues[companyId] = next.catch(() => undefined);
  return next;
}
