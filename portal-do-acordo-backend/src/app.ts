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
import { authMiddleware } from './middleware/auth';
import { errorHandler } from './middleware/errorHandler';

export function createApp() {
  const app = express();
  app.use(helmet());
  app.use(cors());
  app.use(express.json());
  app.use('/api', authMiddleware);

  app.use('/api/baixas', paymentRouter);
  app.use('/api/acordos', agreementRouter);
  app.use('/api/acessos', accessRouter);
  app.use('/api/credores', creditorRouter);
  app.use('/api/custos', costRouter);
  app.use('/api/comunicacao', communicationRouter);

  app.use(errorHandler);

  return app;
}
