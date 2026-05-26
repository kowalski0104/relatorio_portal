import { Router } from 'express';
import { getCustos } from '../services/custosService';
import { custosQuerySchema } from './querySchemas';
const router = Router();
router.get('/', async (req, res) => {
    const parseResult = custosQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const custos = await getCustos(parseResult.data);
    res.json({ data: custos });
});
export default router;
//# sourceMappingURL=custos.js.map