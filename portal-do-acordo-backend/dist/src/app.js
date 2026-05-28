"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const cors_1 = __importDefault(require("cors"));
const helmet_1 = __importDefault(require("helmet"));
require("express-async-errors");
const paymentRoutes_1 = __importDefault(require("./routes/paymentRoutes"));
const agreementRoutes_1 = __importDefault(require("./routes/agreementRoutes"));
const accessRoutes_1 = __importDefault(require("./routes/accessRoutes"));
const creditorRoutes_1 = __importDefault(require("./routes/creditorRoutes"));
const costRoutes_1 = __importDefault(require("./routes/costRoutes"));
const communicationRoutes_1 = __importDefault(require("./routes/communicationRoutes"));
const activeBaseRoutes_1 = __importDefault(require("./routes/activeBaseRoutes"));
const portfolioRoutes_1 = __importDefault(require("./routes/portfolioRoutes"));
const emailTrackingRoutes_1 = __importStar(require("./routes/emailTrackingRoutes"));
const activeUsersRoutes_1 = __importStar(require("./routes/activeUsersRoutes"));
const auth_1 = require("./middleware/auth");
const errorHandler_1 = require("./middleware/errorHandler");
function createApp() {
    const app = (0, express_1.default)();
    const allowedOrigins = process.env.CORS_ORIGINS?.split(',').map((origin) => origin.trim()).filter(Boolean) ?? [];
    app.set('trust proxy', 1);
    app.use((0, helmet_1.default)());
    app.use((0, cors_1.default)({
        origin(origin, callback) {
            if (!origin || allowedOrigins.length === 0 || allowedOrigins.includes(origin)) {
                callback(null, true);
                return;
            }
            callback(new Error('Origem não permitida pelo CORS.'));
        },
    }));
    app.use(express_1.default.json());
    app.get('/', (_req, res) => {
        res.json({
            name: 'Portal do Acordo API',
            status: 'ok',
            uptime: process.uptime(),
        });
    });
    app.get('/health', (_req, res) => {
        res.json({
            status: 'ok',
            uptime: process.uptime(),
            timestamp: new Date().toISOString(),
        });
    });
    // Rota de clique de e-mail DEVE estar ANTES da autenticação
    // Precisa ser pública para cliques anônimos de e-mails
    app.use('/r', emailTrackingRoutes_1.clickRouter);
    app.use('/api', auth_1.authMiddleware);
    app.use('/api/baixas', paymentRoutes_1.default);
    app.use('/api/acordos', agreementRoutes_1.default);
    app.use('/api/acessos', accessRoutes_1.default);
    app.use('/api/credores', creditorRoutes_1.default);
    app.use('/api/custos', costRoutes_1.default);
    app.use('/api/comunicacao', communicationRoutes_1.default);
    app.use('/api/base-ativa', activeBaseRoutes_1.default);
    app.use('/api/carteiras', portfolioRoutes_1.default);
    app.use('/api/mailgrid', emailTrackingRoutes_1.default);
    app.use('/api/presenca', activeUsersRoutes_1.default);
    app.use('/api/admin', activeUsersRoutes_1.activeUsersAdminRouter);
    app.use(errorHandler_1.errorHandler);
    return app;
}
//# sourceMappingURL=app.js.map