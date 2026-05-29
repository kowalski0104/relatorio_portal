import { Router } from 'express';
import { getPeriods } from '../services/periodService';
import { baseQuerySchema } from './schemas';

const router = Router();

router.get('/', async (req, res) => {
  const parseResult = baseQuerySchema.pick({ sistema: true }).safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getPeriods(parseResult.data);
  res.json(result);
});

export default router;
