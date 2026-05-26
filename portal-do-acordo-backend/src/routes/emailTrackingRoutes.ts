import { Router, Request, Response } from 'express';

export const clickRouter = Router();
const webhookRouter = Router();

// ROTA DE CLIQUE
clickRouter.get('/:token', (req: Request, res: Response) => {
  const token = req.params.token;
  console.log('CLIQUE RECEBIDO - Token:', token);
  res.json({ success: true, token });
});

// ROTA DO WEBHOOK
webhookRouter.post('/webhook', (req: Request, res: Response) => {
  console.log('Webhook recebido');
  res.json({ success: true });
});

export default webhookRouter;
