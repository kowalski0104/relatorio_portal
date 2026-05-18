import { createApp } from './app';
import { startActiveBaseCacheScheduler } from './services/activeBaseService';

const port = Number(process.env.PORT ?? 3001);
const host = process.env.HOST ?? '0.0.0.0';
const app = createApp();

startActiveBaseCacheScheduler();

app.listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`Portal do Acordo API rodando em http://${displayHost}:${port}`);
});
