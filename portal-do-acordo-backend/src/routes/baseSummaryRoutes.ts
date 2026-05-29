import { Router } from 'express';
import { getBaseSummary } from '../services/baseSummaryService';
import { baseSummaryQuerySchema } from './schemas';

const router = Router();

router.get('/resumo', async (req, res) => {
  const parseResult = baseSummaryQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getBaseSummary(parseResult.data);
  res.json(result);
});

export default router;
