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

export const communicationQuerySchema = baseQuerySchema.extend({
  diario: z.enum(['0', '1']).optional().transform((value) => value !== '0'),
});

export const emailClicksQuerySchema = baseQuerySchema.extend({
  dataFim: z.string()
    .regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/, 'dataFim deve ser YYYY-MM-DD')
    .refine((value) => {
      const date = new Date(`${value}T00:00:00Z`);
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, 'dataFim deve ser uma data válida')
    .optional(),
});

export const activeBaseQuerySchema = baseQuerySchema;
export const dashboardResultGraphsQuerySchema = baseQuerySchema.extend({
  credor: z.string().optional(),
  negociador: z.string().optional(),
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
export const portfolioQuerySchema = baseQuerySchema.extend({
  periodos: z.string().optional().transform((value) =>
    value
      ? value
          .split(',')
          .map((item) => item.trim())
          .filter((item) => /^\d{4}-(0[1-9]|1[0-2])$/.test(item))
      : []
  ),
});
export const baseSummaryQuerySchema = portfolioQuerySchema;

export type BaseQuery = z.infer<typeof baseQuerySchema>;
export type DashboardResultGraphsQuery = z.infer<typeof dashboardResultGraphsQuerySchema>;
export type CustosQuery = z.infer<typeof custosQuerySchema>;
export type ActiveBaseQuery = z.infer<typeof activeBaseQuerySchema>;
export type PortfolioQuery = z.infer<typeof portfolioQuerySchema>;
export type BaseSummaryQuery = z.infer<typeof baseSummaryQuerySchema>;



