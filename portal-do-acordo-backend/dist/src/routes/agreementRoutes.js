"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = require("express");
const agreementService_1 = require("../services/agreementService");
const schemas_1 = require("./schemas");
const router = (0, express_1.Router)();
router.get('/', async (req, res) => {
    const parseResult = schemas_1.baseQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const result = await (0, agreementService_1.getAgreements)(parseResult.data);
    res.json(result);
});
exports.default = router;
//# sourceMappingURL=agreementRoutes.js.map