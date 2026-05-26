"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const costService_1 = require("../services/costService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const parseResult = schemas_1.custosQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const custos = await (0, costService_1.getCosts)(parseResult.data);
    res.json({ data: custos });
});
exports.default = router;
//# sourceMappingURL=costRoutes.js.map