import { createApp } from './app';
import { startActiveBaseCacheScheduler } from './services/activeBaseService';
import { hasDatabaseConfig } from './db/prismaClients';
import { getPeriods } from './services/periodService';
import { getCreditors } from './services/creditorService';
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
  const systems: SystemFilter[] = ['consulth', 'sisth'];

  try {
    const periodsBySystem = await Promise.all(
      systems.map(async (sistema) => ({
        sistema,
        periods: (await getPeriods({ sistema })).data,
      }))
    );

    await Promise.all(
      periodsBySystem.map(({ sistema, periods }) => {
        const periodo = periods[0];
        return periodo ? getCreditors({ sistema, periodo }) : Promise.resolve([]);
      })
    );
    console.log('Caches de periodos e credores aquecidos.');
  } catch (error) {
    console.warn('Falha ao aquecer caches de periodos e credores:', error);
  }
}
