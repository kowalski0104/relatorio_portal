"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const creditorService_1 = require("../services/creditorService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const parseResult = schemas_1.baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const credores = await (0, creditorService_1.getCreditors)(parseResult.data);
    res.json({ data: credores });
});
exports.default = router;
//# sourceMappingURL=creditorRoutes.js.map