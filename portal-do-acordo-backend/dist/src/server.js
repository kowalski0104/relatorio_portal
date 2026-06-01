"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const activeBaseService_1 = require("./services/activeBaseService");
const prismaClients_1 = require("./db/prismaClients");
const periodService_1 = require("./services/periodService");
const creditorService_1 = require("./services/creditorService");
const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const app = (0, app_1.createApp)();
const databaseConfigured = (0, prismaClients_1.hasDatabaseConfig)();
if (databaseConfigured) {
    (0, activeBaseService_1.startActiveBaseCacheScheduler)();
}
else {
    console.warn('Cache da Base Ativa não iniciado: DATABASE_URL_401 ou DATABASE_URL_1007 não configurada.');
}
app.listen(port, host, () => {
    const displayHost = host === '0.0.0.0' ? 'localhost' : host;
    console.log(`Portal do Acordo API rodando em http://${displayHost}:${port}`);
    if (databaseConfigured)
        void warmupCriticalCaches();
});
async function warmupCriticalCaches() {
    const systems = ['consulth', 'sisth'];
    try {
        const periodsBySystem = await Promise.all(systems.map(async (sistema) => ({
            sistema,
            periods: (await (0, periodService_1.getPeriods)({ sistema })).data,
        })));
        await Promise.all(periodsBySystem.map(({ sistema, periods }) => {
            const periodo = periods[0];
            return periodo ? (0, creditorService_1.getCreditors)({ sistema, periodo }) : Promise.resolve([]);
        }));
        console.log('Caches de periodos e credores aquecidos.');
    }
    catch (error) {
        console.warn('Falha ao aquecer caches de periodos e credores:', error);
    }
}
//# sourceMappingURL=server.js.map