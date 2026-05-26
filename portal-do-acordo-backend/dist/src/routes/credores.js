import { Router } from 'express';
import { getCredores } from '../services/credoresService';
import { baseQuerySchema } from './querySchemas';
const router = Router();
router.get('/', async (req, res) => {
    const parseResult = baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const credores = await getCredores(parseResult.data);
    res.json({ data: credores });
});
export default router;
//# sourceMappingURL=credores.js.map