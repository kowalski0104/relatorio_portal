export type SystemFilter = 'consulth' | 'sisth' | 'total';
export type CompanyId = 401 | 1007;

export type ReportFilter = {
  periodo?: string;
  sistema?: SystemFilter;
  credores?: string[];
};

export const DEFAULT_YEAR = 2026;

export const NEGOTIATORS = ['PORTALNEG', 'KETLEN.ATANAZIO', 'ZAQUEU.RITTER'];
export const EXCLUDED_DASHBOARD_CREDITOR_IDS = [31084, 29033];

export const systemToCompanyIds: Record<SystemFilter, CompanyId[]> = {
  consulth: [401],
  sisth: [1007],
  total: [401, 1007],
};

export function getSystemCompanyIds(system?: SystemFilter) {
  return system ? [...systemToCompanyIds[system]] : [...systemToCompanyIds.total];
}

export function parsePeriod(period?: string) {
  if (!period) return null;
  const match = period.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  if (!match) return null;
  const start = new Date(`${period}-01T00:00:00Z`);
  const end = new Date(start);
  end.setUTCMonth(end.getUTCMonth() + 1);
  return { start, end };
}

export function getPeriodRange(period?: string) {
  return parsePeriod(period) ?? {
    start: new Date(Date.UTC(DEFAULT_YEAR, 0, 1)),
    end: new Date(Date.UTC(DEFAULT_YEAR + 1, 0, 1)),
  };
}

export function getLivePeriodYearRange(period?: string) {
  const parsed = parsePeriod(period);
  const year = parsed ? parsed.start.getUTCFullYear() : DEFAULT_YEAR;
  return {
    start: new Date(Date.UTC(year, 0, 1)),
    end: new Date(Date.UTC(year + 1, 0, 1)),
  };
}

export function addSqlParam(params: unknown[], value: unknown) {
  params.push(value);
  return `$${params.length}`;
}

export function buildSqlInFilter(expression: string, values: string[] | undefined, params: unknown[]) {
  const uniqueValues = Array.from(new Set(values?.map((value) => value.trim()).filter(Boolean) ?? []));
  if (uniqueValues.length === 0) return '';

  const placeholders = uniqueValues.map((value) => addSqlParam(params, value)).join(', ');
  return `AND ${expression} IN (${placeholders})`;
}

export function buildExcludedDashboardCreditorFilter(expression: string) {
  return `AND ${expression} NOT IN (${EXCLUDED_DASHBOARD_CREDITOR_IDS.join(', ')})`;
}

export function buildNullableExcludedDashboardCreditorFilter(expression: string) {
  return `AND (${expression} IS NULL OR ${expression} NOT IN (${EXCLUDED_DASHBOARD_CREDITOR_IDS.join(', ')}))`;
}

export function buildExcludedDashboardAccessFilter(accessAlias = 'a') {
  const ids = EXCLUDED_DASHBOARD_CREDITOR_IDS.join(', ');
  return `
    AND NOT EXISTS (
      SELECT 1
      FROM tb_acordo ac_excluded_dashboard
      WHERE ac_excluded_dashboard.idempresa = ${accessAlias}.idempresa
        AND ac_excluded_dashboard.idcredor IN (${ids})
        AND (
          ac_excluded_dashboard.id = ${accessAlias}.idacordo
          OR (
            ${accessAlias}.idacordo IS NULL
            AND ac_excluded_dashboard.processo = ${accessAlias}.processo
          )
        )
    )
  `;
}

export function isExcludedDashboardCreditorName(value?: string | null) {
  const upper = String(value ?? '').trim().toUpperCase();
  return upper.includes('LOJAS MM') || upper.includes('LOJAS M M') || upper.includes('LOJAS M.M');
}

export function monthKey(date: Date) {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function formatMonthLabel(key: string) {
  const [year, month] = key.split('-').map(Number);
  const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
  return `${months[month - 1]}/${String(year).slice(-2)}`;
}

export function getLastThreeMonths(period?: string) {
  const now = period ? new Date(`${period}-01T00:00:00Z`) : new Date();
  const months: string[] = [];
  const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  for (let i = 2; i >= 0; i--) {
    const month = new Date(date);
    month.setUTCMonth(month.getUTCMonth() - i);
    months.push(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`);
  }
  return months;
}
