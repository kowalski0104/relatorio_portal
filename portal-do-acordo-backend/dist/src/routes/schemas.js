"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.portfolioQuerySchema = exports.activeBaseQuerySchema = exports.custosQuerySchema = exports.baseQuerySchema = void 0;
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
exports.portfolioQuerySchema = exports.baseQuerySchema.extend({
    periodos: zod_1.z.string().optional().transform((value) => value
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter((item) => /^\d{4}-(0[1-9]|1[0-2])$/.test(item))
        : []),
});
//# sourceMappingURL=schemas.js.map