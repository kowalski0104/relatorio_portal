import { Router } from 'express';
import { getPortfolio } from '../services/portfolioService';
import { portfolioQuerySchema } from './schemas';

const router = Router();

router.get('/', async (req, res) => {
  const parseResult = portfolioQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
  }

  const result = await getPortfolio(parseResult.data);
  res.json(result);
});

export default router;
