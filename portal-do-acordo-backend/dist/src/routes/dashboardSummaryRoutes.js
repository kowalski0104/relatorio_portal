"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const dashboardCommunicationService_1 = require("../services/dashboardCommunicationService");
const dashboardPerformanceService_1 = require("../services/dashboardPerformanceService");
const dashboardResultGraphsService_1 = require("../services/dashboardResultGraphsService");
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
router.get('/resultados/graficos', async (req, res) => {
    const parseResult = schemas_1.dashboardResultGraphsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, dashboardResultGraphsService_1.getDashboardResultGraphs)(parseResult.data);
    res.json(result);
});
router.get('/performance/resumo', async (req, res) => {
    const parseResult = schemas_1.dashboardResultGraphsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, dashboardPerformanceService_1.getDashboardPerformanceSummary)(parseResult.data);
    res.json(result);
});
router.get('/performance/graficos', async (req, res) => {
    const parseResult = schemas_1.dashboardResultGraphsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, dashboardPerformanceService_1.getDashboardPerformanceGraphs)(parseResult.data);
    res.json(result);
});
router.get('/comunicacao/resumo', async (req, res) => {
    const parseResult = schemas_1.dashboardResultGraphsQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, dashboardCommunicationService_1.getDashboardCommunicationSummary)(parseResult.data);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=dashboardSummaryRoutes.js.map