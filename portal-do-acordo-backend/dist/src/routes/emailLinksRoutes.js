"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const crypto_1 = __importDefault(require("crypto"));
const express_1 = require("express");
const zod_1 = require("zod");
const emailLinksService_1 = require("../services/emailLinksService");
const router = (0, express_1.Router)();
const MAX_ITEMS_PER_REQUEST = 1000;
const optionalTextSchema = zod_1.z.union([zod_1.z.string(), zod_1.z.number(), zod_1.z.boolean()])
    .optional()
    .nullable()
    .transform((value) => {
    if (value === null || value === undefined)
        return undefined;
    const text = String(value).trim();
    return text || undefined;
});
const payloadItemSchema = zod_1.z.object({
    processo: optionalTextSchema,
    email: zod_1.z.string().trim().email('email invalido'),
    grupo: optionalTextSchema,
    devedor_razao: optionalTextSchema,
    devedor_cnpj: optionalTextSchema,
    credor_fantasia: optionalTextSchema,
    titulos_aberto_total: optionalTextSchema,
    campanha: optionalTextSchema,
    template: optionalTextSchema,
    payload: zod_1.z.record(zod_1.z.unknown()).optional(),
}).passthrough();
const bulkGenerateSchema = zod_1.z.object({
    origem: optionalTextSchema.default('listmonk'),
    campanha: optionalTextSchema,
    url_destino: optionalTextSchema.default(emailLinksService_1.DEFAULT_DESTINATION_URL),
    items: zod_1.z.array(payloadItemSchema)
        .min(1, 'items deve conter pelo menos um item')
        .max(MAX_ITEMS_PER_REQUEST, `items deve conter no maximo ${MAX_ITEMS_PER_REQUEST} itens`),
});
router.post('/bulk-generate', async (req, res) => {
    const authResult = validateApiKey(req);
    if (!authResult.ok) {
        return res.status(authResult.status).json({ success: false, error: authResult.error });
    }
    const parseResult = bulkGenerateSchema.safeParse(req.body);
    if (!parseResult.success) {
        return res.status(400).json({
            success: false,
            error: 'Payload invalido.',
            issues: parseResult.error.format(),
        });
    }
    try {
        const result = await (0, emailLinksService_1.bulkGenerateEmailLinks)({
            origem: parseResult.data.origem ?? 'listmonk',
            campanha: parseResult.data.campanha,
            url_destino: parseResult.data.url_destino,
            items: parseResult.data.items,
        });
        res.json(result);
    }
    catch (error) {
        if (error instanceof emailLinksService_1.EmailLinksPublicError) {
            if (error.statusCode >= 500) {
                console.error('Erro no endpoint email-links/bulk-generate', { message: error.message });
            }
            return res.status(error.statusCode).json({ success: false, error: error.message });
        }
        console.error('Erro no endpoint email-links/bulk-generate', {
            message: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ success: false, error: 'Erro ao gerar links de rastreamento.' });
    }
});
function validateApiKey(req) {
    const expectedKey = process.env.EMAIL_LINKS_API_KEY;
    if (!expectedKey) {
        if (isLocalRequest(req))
            return { ok: true };
        return {
            ok: false,
            status: 503,
            error: 'EMAIL_LINKS_API_KEY nao configurada para chamadas remotas.',
        };
    }
    const providedKey = req.get('x-api-key') ?? '';
    if (!constantTimeEquals(providedKey, expectedKey)) {
        return { ok: false, status: 401, error: 'Nao autorizado.' };
    }
    return { ok: true };
}
function constantTimeEquals(left, right) {
    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length)
        return false;
    return crypto_1.default.timingSafeEqual(leftBuffer, rightBuffer);
}
function isLocalRequest(req) {
    const candidates = [
        req.ip,
        req.socket.remoteAddress,
        req.headers.host,
    ].filter(Boolean).map((value) => String(value).toLowerCase());
    return candidates.some((value) => value === '127.0.0.1'
        || value === '::1'
        || value === '::ffff:127.0.0.1'
        || value.startsWith('localhost')
        || value.startsWith('127.0.0.1:'));
}
exports.default = router;
//# sourceMappingURL=emailLinksRoutes.js.map