import { Router } from 'express';
import { getActiveBase, refreshActiveBaseCache } from '../services/activeBaseService';
import { activeBaseQuerySchema } from './schemas';

const router = Router();

router.get('/', async (req, res) => {
  const parseResult = activeBaseQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getActiveBase(parseResult.data);
  res.json(result);
});

router.post('/refresh', (_req, res) => {
  void refreshActiveBaseCache();
  res.status(202).json({ data: { status: 'refreshing' } });
});

export default router;
