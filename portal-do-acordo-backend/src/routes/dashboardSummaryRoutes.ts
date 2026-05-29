import { Router } from 'express';
import { getDashboardResultSummary } from '../services/dashboardSummaryService';
import { baseQuerySchema } from './schemas';

const router = Router();

router.get('/resultados/resumo', async (req, res) => {
  const parseResult = baseQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getDashboardResultSummary(parseResult.data);
  res.json(result);
});

export default router;
