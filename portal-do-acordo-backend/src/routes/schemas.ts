import { z } from 'zod';

export const baseQuerySchema = z.object({
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodo deve ser YYYY-MM').optional(),
  credores: z.string().optional().transform((value) =>
    value
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter(Boolean)
      : []
  ),
  sistema: z.enum(['consulth', 'sisth', 'total']).optional().default('total'),
});

export const custosQuerySchema = z.object({
  periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'periodo deve ser YYYY-MM').optional(),
  sistema: z.enum(['consulth', 'sisth', 'total']).optional().default('total'),
});

export const activeBaseQuerySchema = baseQuerySchema.extend({
  limit: z.coerce.number().int().min(50).max(5000).optional().default(1000),
});

export type BaseQuery = z.infer<typeof baseQuerySchema>;
export type CustosQuery = z.infer<typeof custosQuerySchema>;
export type ActiveBaseQuery = z.infer<typeof activeBaseQuerySchema>;



