import { Router } from 'express';
import { baseQuerySchema } from './querySchemas';
import { getComunicacao, handleWatiWebhook } from '../services/comunicacaoService';
const router = Router();
router.get('/', async (req, res) => {
    const parseResult = baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const comunicacao = await getComunicacao(parseResult.data);
    res.json({ data: comunicacao });
});
router.post('/webhook/wati', async (req, res) => {
    const result = await handleWatiWebhook(req.body);
    res.json(result);
});
export default router;
//# sourceMappingURL=comunicacao.js.map