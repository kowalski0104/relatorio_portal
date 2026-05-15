import { Router } from 'express';
import { getCosts } from '../services/costService';
import { custosQuerySchema } from './schemas';

const router = Router();

router.get('/', async (req, res) => {
  const parseResult = custosQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
  }

  const custos = await getCosts(parseResult.data);
  res.json({ data: custos });
});

export default router;



