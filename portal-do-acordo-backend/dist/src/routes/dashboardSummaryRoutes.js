"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboardSummaryService_1 = require("../services/dashboardSummaryService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/resultados/resumo', async (req, res) => {
    const parseResult = schemas_1.baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, dashboardSummaryService_1.getDashboardResultSummary)(parseResult.data);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=dashboardSummaryRoutes.js.map