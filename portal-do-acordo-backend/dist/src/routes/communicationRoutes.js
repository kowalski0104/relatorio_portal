"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const schemas_1 = require("./schemas");
const communicationService_1 = require("../services/communicationService");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const parseResult = schemas_1.baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const comunicacao = await (0, communicationService_1.getCommunication)(parseResult.data);
    res.json({ data: comunicacao });
});
router.post('/webhook/wati', async (req, res) => {
    const result = await (0, communicationService_1.handleWhatsAppWebhook)(req.body);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=communicationRoutes.js.map