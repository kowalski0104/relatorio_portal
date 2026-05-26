"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const activeBaseService_1 = require("../services/activeBaseService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const parseResult = schemas_1.activeBaseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, activeBaseService_1.getActiveBase)(parseResult.data);
    res.json(result);
});
router.post('/refresh', (_req, res) => {
    void (0, activeBaseService_1.refreshActiveBaseCache)();
    res.status(202).json({ data: { status: 'refreshing' } });
});
exports.default = router;
//# sourceMappingURL=activeBaseRoutes.js.map