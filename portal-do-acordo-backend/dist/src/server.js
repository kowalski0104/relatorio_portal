"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const app_1 = require("./app");
const activeBaseService_1 = require("./services/activeBaseService");
const prismaClients_1 = require("./db/prismaClients");
const periodService_1 = require("./services/periodService");
const creditorService_1 = require("./services/creditorService");
const baseSummaryService_1 = require("./services/baseSummaryService");
const dashboardPerformanceService_1 = require("./services/dashboardPerformanceService");
const dashboardSummaryService_1 = require("./services/dashboardSummaryService");
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
    const systems = ['consulth', 'sisth', 'total'];
    const periodsBySystem = new Map();
    const periodResults = await Promise.allSettled(systems.map(async (sistema) => {
        const periods = (await (0, periodService_1.getPeriods)({ sistema })).data;
        periodsBySystem.set(sistema, periods);
        return periods;
    }));
    const tasks = systems.flatMap((sistema) => {
        const periodo = periodsBySystem.get(sistema)?.[0];
        if (!periodo)
            return [];
        return [
            (0, creditorService_1.getCreditors)({ sistema, periodo }),
            (0, dashboardSummaryService_1.getDashboardResultSummary)({ sistema, periodo, credores: [] }),
            (0, dashboardPerformanceService_1.getDashboardPerformanceSummary)({ sistema, periodo, credores: [], negociador: undefined }),
            (0, baseSummaryService_1.getBaseSummary)({ sistema, periodo, periodos: [periodo], credores: [] }),
        ];
    });
    const dataResults = await Promise.allSettled(tasks);
    const failures = [...periodResults, ...dataResults].filter((result) => result.status === 'rejected');
    if (failures.length > 0) {
        console.warn(`Warmup concluido com ${failures.length} falha(s).`);
    }
    else {
        console.log('Caches criticos aquecidos.');
    }
}
//# sourceMappingURL=server.js.map