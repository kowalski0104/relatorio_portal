import { PrismaClient } from '@prisma/client';
import { CompanyId, getSystemCompanyIds, SystemFilter } from '../utils/reportFilters';

const clientsByCompany: Record<CompanyId, PrismaClient> = {
  401: new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_401 } } }),
  1007: new PrismaClient({ datasources: { db: { url: process.env.DATABASE_URL_1007 } } }),
};

export function getLiveClients(system?: SystemFilter) {
  return getSystemCompanyIds(system).map((companyId) => ({
    empresaId: companyId,
    prisma: clientsByCompany[companyId],
  }));
}
