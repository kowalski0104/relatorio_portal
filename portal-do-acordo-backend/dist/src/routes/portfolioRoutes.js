"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const portfolioService_1 = require("../services/portfolioService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const parseResult = schemas_1.portfolioQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, portfolioService_1.getPortfolio)(parseResult.data);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=portfolioRoutes.js.map