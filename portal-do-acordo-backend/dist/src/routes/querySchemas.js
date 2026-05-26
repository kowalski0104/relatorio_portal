import { z } from 'zod';
export const baseQuerySchema = z.object({
    periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodo deve ser YYYY-MM').optional(),
    credores: z.string().optional().transform((value) => value
        ? value
            .split(',')
            .map((item) => item.trim())
            .filter(Boolean)
        : []),
    sistema: z.enum(['consulth', 'sisth', 'total']).optional().default('total'),
});
export const custosQuerySchema = z.object({
    periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodo deve ser YYYY-MM').optional(),
    sistema: z.enum(['consulth', 'sisth', 'total']).optional().default('total'),
});
//# sourceMappingURL=querySchemas.js.map