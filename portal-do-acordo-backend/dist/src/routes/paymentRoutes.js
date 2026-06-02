"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const paymentService_1 = require("../services/paymentService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/financeiro-mensal', async (req, res) => {
    const parseResult = schemas_1.baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const result = await (0, paymentService_1.getMonthlyFinancialPayments)(parseResult.data);
    res.json(result);
});
router.get('/', async (req, res) => {
    const parseResult = schemas_1.baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const result = await (0, paymentService_1.getPayments)(parseResult.data);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=paymentRoutes.js.map