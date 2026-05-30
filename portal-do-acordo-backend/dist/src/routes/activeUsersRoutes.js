"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.activeUsersAdminRouter = void 0;
const express_1 = require("express");
const activeUsersService_1 = require("../services/activeUsersService");
const cache_1 = require("../utils/cache");
const presenceRouter = (0, express_1.Router)();
exports.activeUsersAdminRouter = (0, express_1.Router)();
presenceRouter.post('/heartbeat', (req, res) => {
    const result = (0, activeUsersService_1.recordActiveUserHeartbeat)(req);
    res.json({ ok: true, session_id: result.session_id });
});
exports.activeUsersAdminRouter.get('/active-users', (req, res) => {
    if (!isAdminRequest(req)) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.json({ data: (0, activeUsersService_1.getActiveUsersReport)() });
});
exports.activeUsersAdminRouter.post('/cache/clear', (req, res) => {
    const expectedToken = process.env.CACHE_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
    const token = typeof req.query.token === 'string' ? req.query.token : '';
    if (!expectedToken || token !== expectedToken) {
        return res.status(404).json({ error: 'Not found' });
    }
    res.json({ ok: true, cleared: (0, cache_1.clearCache)() });
});
function isAdminRequest(req) {
    const expectedToken = process.env.ACTIVE_USERS_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
    if (!expectedToken)
        return false;
    const headerToken = req.headers['x-admin-token'];
    const authorization = req.headers.authorization ?? '';
    const bearerToken = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
    const queryToken = typeof req.query.token === 'string' ? req.query.token : '';
    return [headerToken, bearerToken, queryToken].some((token) => token === expectedToken);
}
exports.default = presenceRouter;
//# sourceMappingURL=activeUsersRoutes.js.map