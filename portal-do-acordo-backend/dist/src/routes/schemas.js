"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.baseSummaryQuerySchema = exports.portfolioQuerySchema = exports.dashboardResultGraphsQuerySchema = exports.activeBaseQuerySchema = exports.custosQuerySchema = exports.baseQuerySchema = void 0;
const zod_1 = require("zod");
exports.baseQuerySchema = zod_1.z.object({
    periodo: zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodo deve ser YYYY-MM').optional(),
    credores: zod_1.z.string().optional().transform((value) => value
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : []),
    sistema: zod_1.z.enum(['consulth', 'sisth', 'total']).optional().default('total'),
});
exports.custosQuerySchema = zod_1.z.object({
    periodo: zod_1.z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodo deve ser YYYY-MM').optional(),
    sistema: zod_1.z.enum(['consulth', 'sisth', 'total']).optional().default('total'),
});
exports.activeBaseQuerySchema = exports.baseQuerySchema;
exports.dashboardResultGraphsQuerySchema = exports.baseQuerySchema.extend({
    credor: zod_1.z.string().optional(),
    negociador: zod_1.z.string().optional(),
}).transform((value) => {
    const singleCreditor = value.credor?.trim();
    const credores = singleCreditor ? [...value.credores, singleCreditor] : value.credores;
    return {
        periodo: value.periodo,
        sistema: value.sistema,
        credores: Array.from(new Set(credores.map((item) => item.trim()).filter(Boolean))),
        negociador: value.negociador?.trim() || undefined,
    };
});
exports.portfolioQuerySchema = exports.baseQuerySchema.extend({
    periodos: zod_1.z.string().optional().transform((value) => value
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter((item) => /^\d{4}-(0[1-9]|1[0-2])$/.test(item))
        : []),
});
exports.baseSummaryQuerySchema = exports.portfolioQuerySchema;
//# sourceMappingURL=schemas.js.map