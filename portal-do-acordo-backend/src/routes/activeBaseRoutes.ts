import { Router } from 'express';
import { getActiveBase } from '../services/activeBaseService';
import { activeBaseQuerySchema } from './schemas';

const router = Router();

router.get('/', async (req, res) => {
  const parseResult = activeBaseQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
  }

  const result = await getActiveBase(parseResult.data);
  res.json(result);
});

export default router;
