import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import 'express-async-errors';
import paymentRouter from './routes/paymentRoutes';
import agreementRouter from './routes/agreementRoutes';
import accessRouter from './routes/accessRoutes';
import creditorRouter from './routes/creditorRoutes';
import costRouter from './routes/costRoutes';
import communicationRouter from './routes/communicationRoutes';
import activeBaseRouter from './routes/activeBaseRoutes';
import portfolioRouter from './routes/portfolioRoutes';
import emailWebhookRouter, { clickRouter } from './routes/emailTrackingRoutes';
import presenceRouter, { activeUsersAdminRouter } from './routes/activeUsersRoutes';
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];

  app.set('trust proxy', 1);
  app.use(helmet());
  app.use(cors({
    origin(origin, callback) {
      if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(new Error('Origem não permitida pelo CORS.'));
    },
  }));
  app.use(express.json());

  app.get('/', (_req, res) => {
    res.json({
      name: 'Portal do Acordo API',
      status: 'ok',
      uptime: process.uptime(),
    });
  });

  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    });
  });

  // Rota de clique de e-mail DEVE estar ANTES da autenticação
  // Precisa ser pública para cliques anônimos de e-mails
  app.use('/r', clickRouter);

  app.use('/api', authMiddleware);

  app.use('/api/baixas', paymentRouter);
  app.use('/api/acordos', agreementRouter);
  app.use('/api/acessos', accessRouter);
  app.use('/api/credores', creditorRouter);
  app.use('/api/custos', costRouter);
  app.use('/api/comunicacao', communicationRouter);
  app.use('/api/base-ativa', activeBaseRouter);
  app.use('/api/carteiras', portfolioRouter);
  app.use('/api/mailgrid', emailWebhookRouter);
  app.use('/api/presenca', presenceRouter);
  app.use('/api/admin', activeUsersAdminRouter);

  app.use(errorHandler);

  return app;
}
