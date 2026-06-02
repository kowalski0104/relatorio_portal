"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.hasEmailMonthlyAggregateDatabaseConfig = hasEmailMonthlyAggregateDatabaseConfig;
exports.getEmailMonthlyAggregateClient = getEmailMonthlyAggregateClient;
exports.disconnectEmailMonthlyAggregateClient = disconnectEmailMonthlyAggregateClient;
const client_1 = require("@prisma/client");
let client = null;
function hasEmailMonthlyAggregateDatabaseConfig() {
    return Boolean(process.env.EMAIL_MONTHLY_AGGREGATE_DATABASE_URL);
}
function getEmailMonthlyAggregateClient() {
    const url = process.env.EMAIL_MONTHLY_AGGREGATE_DATABASE_URL;
    if (!url) {
        throw new Error('Variavel de ambiente EMAIL_MONTHLY_AGGREGATE_DATABASE_URL nao configurada.');
    }
    if (!client) {
        client = new client_1.PrismaClient({ datasources: { db: { url } } });
    }
    return client;
}
async function disconnectEmailMonthlyAggregateClient() {
    if (!client)
        return;
    await client.$disconnect();
    client = null;
}
//# sourceMappingURL=emailMonthlyAggregateClient.js.map