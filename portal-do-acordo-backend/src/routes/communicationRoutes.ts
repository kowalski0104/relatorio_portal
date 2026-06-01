import { Router } from 'express';
import { communicationQuerySchema } from './schemas';
import { getCommunication, handleWhatsAppWebhook } from '../services/communicationService';

const router = Router();

router.get('/', async (req, res) => {
  const parseResult = communicationQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
  }

  const comunicacao = await getCommunication(parseResult.data);
  res.json({ data: comunicacao });
});

router.post('/webhook/wati', async (req, res) => {
  const result = await handleWhatsAppWebhook(req.body);
  res.json(result);
});

export default router;



