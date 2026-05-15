import { Router } from 'express';
import { getCreditors } from '../services/creditorService';
import { baseQuerySchema } from './schemas';

const router = Router();

router.get('/', async (req, res) => {
  const parseResult = baseQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
  }

  const credores = await getCreditors(parseResult.data);
  res.json({ data: credores });
});

export default router;



