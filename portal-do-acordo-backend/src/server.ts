import { createApp } from './app';
import { startActiveBaseCacheScheduler } from './services/activeBaseService';
import { hasDatabaseConfig } from './db/prismaClients';
import { getPeriods } from './services/periodService';
import { getCreditors } from './services/creditorService';
import { getBaseSummary } from './services/baseSummaryService';
import { getDashboardPerformanceSummary } from './services/dashboardPerformanceService';
import { getDashboardResultSummary } from './services/dashboardSummaryService';
import type { SystemFilter } from './utils/reportFilters';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const app = createApp();
const databaseConfigured = hasDatabaseConfig();

if (databaseConfigured) {
  startActiveBaseCacheScheduler();
} else {
  console.warn('Cache da Base Ativa não iniciado: DATABASE_URL_401 ou DATABASE_URL_1007 não configurada.');
}

app.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Portal do Acordo API rodando em http://${displayHost}:${port}`);
  if (databaseConfigured) void warmupCriticalCaches();
});

async function warmupCriticalCaches() {
  const systems: SystemFilter[] = ['consulth', 'sisth', 'total'];
  const periodsBySystem = new Map<SystemFilter, string[]>();

  const periodResults = await Promise.allSettled(
    systems.map(async (sistema) => {
      const periods = (await getPeriods({ sistema })).data;
      periodsBySystem.set(sistema, periods);
      return periods;
    })
  );

  const tasks = systems.flatMap((sistema) => {
    const periodo = periodsBySystem.get(sistema)?.[0];
    if (!periodo) return [];

    return [
      getCreditors({ sistema, periodo }),
      getDashboardResultSummary({ sistema, periodo, credores: [] }),
      getDashboardPerformanceSummary({ sistema, periodo, credores: [], negociador: undefined }),
      getBaseSummary({ sistema, periodo, periodos: [periodo], credores: [] }),
    ];
  });
  const dataResults = await Promise.allSettled(tasks);
  const failures = [...periodResults, ...dataResults].filter((result) => result.status === 'rejected');

  if (failures.length > 0) {
    console.warn(`Warmup concluido com ${failures.length} falha(s).`);
  } else {
    console.log('Caches criticos aquecidos.');
  }
}
