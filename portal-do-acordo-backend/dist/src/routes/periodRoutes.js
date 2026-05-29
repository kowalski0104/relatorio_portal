"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const periodService_1 = require("../services/periodService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const parseResult = schemas_1.baseQuerySchema.pick({ sistema: true }).safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query invalida', issues: parseResult.error.format() });
    }
    const result = await (0, periodService_1.getPeriods)(parseResult.data);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=periodRoutes.js.map