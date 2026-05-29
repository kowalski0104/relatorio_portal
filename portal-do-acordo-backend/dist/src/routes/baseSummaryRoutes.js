"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const baseSummaryService_1 = require("../services/baseSummaryService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/resumo', async (req, res) => {
    const parseResult = schemas_1.baseSummaryQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, baseSummaryService_1.getBaseSummary)(parseResult.data);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=baseSummaryRoutes.js.map