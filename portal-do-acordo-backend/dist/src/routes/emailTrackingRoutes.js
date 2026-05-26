"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.clickRouter = void 0;
const express_1 = require("express");
exports.clickRouter = (0, express_1.Router)();
const webhookRouter = (0, express_1.Router)();
// ROTA DE CLIQUE
exports.clickRouter.get('/:token', (req, res) => {
    const token = req.params.token;
    console.log('CLIQUE RECEBIDO - Token:', token);
    res.json({ success: true, token });
});
// ROTA DO WEBHOOK
webhookRouter.post('/webhook', (req, res) => {
    console.log('Webhook recebido');
    res.json({ success: true });
});
exports.default = webhookRouter;
//# sourceMappingURL=emailTrackingRoutes.js.map