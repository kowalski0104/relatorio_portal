import { Router } from 'express';
import { getAcordos } from '../services/acordosService';
import { baseQuerySchema } from './querySchemas';
const router = Router();
router.get('/', async (req, res) => {
    const parseResult = baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const result = await getAcordos(parseResult.data);
    res.json(result);
});
export default router;
//# sourceMappingURL=acordos.js.map