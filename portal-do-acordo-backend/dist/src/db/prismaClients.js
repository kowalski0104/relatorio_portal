"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getLiveClients = getLiveClients;
exports.hasDatabaseConfig = hasDatabaseConfig;
const client_1 = require("@prisma/client");
const reportFilters_1 = require("../utils/reportFilters");
const databaseEnvByCompany = {
    401: 'DATABASE_URL_401',
    1007: 'DATABASE_URL_1007',
};
const clientsByCompany = {};
const clientQueues = {
    401: Promise.resolve(),
    1007: Promise.resolve(),
};
function getLiveClients(system) {
    return (0, reportFilters_1.getSystemCompanyIds)(system).map((companyId) => ({
        empresaId: companyId,
        prisma: getClient(companyId),
        query: (operation) => runQueued(companyId, operation),
    }));
}
function hasDatabaseConfig() {
    return (0, reportFilters_1.getSystemCompanyIds)('total').every((companyId) => Boolean(process.env[databaseEnvByCompany[companyId]]));
}
function getClient(companyId) {
    const current = clientsByCompany[companyId];
    if (current)
        return current;
    const envName = databaseEnvByCompany[companyId];
    const url = process.env[envName];
    if (!url)
        throw new Error(`Variável de ambiente ${envName} não configurada.`);
    const client = new client_1.PrismaClient({ datasources: { db: { url } } });
    clientsByCompany[companyId] = client;
    return client;
}
function runQueued(companyId, operation) {
    const run = () => operation(getClient(companyId));
    const next = clientQueues[companyId].catch(() => undefined).then(run);
    clientQueues[companyId] = next.catch(() => undefined);
    return next;
}
//# sourceMappingURL=prismaClients.js.map