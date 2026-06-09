"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.systemToCompanyIds = exports.EXCLUDED_DASHBOARD_CREDITOR_IDS = exports.NEGOTIATORS = exports.DEFAULT_YEAR = void 0;
exports.getSystemCompanyIds = getSystemCompanyIds;
exports.parsePeriod = parsePeriod;
exports.getPeriodRange = getPeriodRange;
exports.getLivePeriodYearRange = getLivePeriodYearRange;
exports.addSqlParam = addSqlParam;
exports.buildSqlInFilter = buildSqlInFilter;
exports.buildExcludedDashboardCreditorFilter = buildExcludedDashboardCreditorFilter;
exports.buildNullableExcludedDashboardCreditorFilter = buildNullableExcludedDashboardCreditorFilter;
exports.buildExcludedDashboardAccessFilter = buildExcludedDashboardAccessFilter;
exports.isExcludedDashboardCreditorName = isExcludedDashboardCreditorName;
exports.monthKey = monthKey;
exports.formatMonthLabel = formatMonthLabel;
exports.getLastThreeMonths = getLastThreeMonths;
exports.DEFAULT_YEAR = 2026;
exports.NEGOTIATORS = ['PORTALNEG', 'KETLEN.ATANAZIO', 'ZAQUEU.RITTER'];
exports.EXCLUDED_DASHBOARD_CREDITOR_IDS = [31084];
exports.systemToCompanyIds = {
    consulth: [401],
    sisth: [1007],
    total: [401, 1007],
};
function getSystemCompanyIds(system) {
    return system ? [...exports.systemToCompanyIds[system]] : [...exports.systemToCompanyIds.total];
}
function parsePeriod(period) {
    if (!period)
        return null;
    const match = period.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match)
        return null;
    const start = new Date(`${period}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
}
function getPeriodRange(period) {
    return parsePeriod(period) ?? {
        start: new Date(Date.UTC(exports.DEFAULT_YEAR, 0, 1)),
        end: new Date(Date.UTC(exports.DEFAULT_YEAR + 1, 0, 1)),
    };
}
function getLivePeriodYearRange(period) {
    const parsed = parsePeriod(period);
    const year = parsed ? parsed.start.getUTCFullYear() : exports.DEFAULT_YEAR;
    return {
        start: new Date(Date.UTC(year, 0, 1)),
        end: new Date(Date.UTC(year + 1, 0, 1)),
    };
}
function addSqlParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}
function buildSqlInFilter(expression, values, params) {
    const uniqueValues = Array.from(new Set(values?.map((value) => value.trim()).filter(Boolean) ?? []));
    if (uniqueValues.length === 0)
        return '';
    const placeholders = uniqueValues.map((value) => addSqlParam(params, value)).join(', ');
    return `AND ${expression} IN (${placeholders})`;
}
function buildExcludedDashboardCreditorFilter(expression) {
    return `AND ${expression} NOT IN (${exports.EXCLUDED_DASHBOARD_CREDITOR_IDS.join(', ')})`;
}
function buildNullableExcludedDashboardCreditorFilter(expression) {
    return `AND (${expression} IS NULL OR ${expression} NOT IN (${exports.EXCLUDED_DASHBOARD_CREDITOR_IDS.join(', ')}))`;
}
function buildExcludedDashboardAccessFilter(accessAlias = 'a') {
    const ids = exports.EXCLUDED_DASHBOARD_CREDITOR_IDS.join(', ');
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
function isExcludedDashboardCreditorName(value) {
    const upper = String(value ?? '').trim().toUpperCase();
    return upper.includes('LOJAS MM') || upper.includes('LOJAS M M') || upper.includes('LOJAS M.M');
}
function monthKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function formatMonthLabel(key) {
    const [year, month] = key.split('-').map(Number);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${months[month - 1]}/${String(year).slice(-2)}`;
}
function getLastThreeMonths(period) {
    const now = period ? new Date(`${period}-01T00:00:00Z`) : new Date();
    const months = [];
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    for (let i = 2; i >= 0; i--) {
        const month = new Date(date);
        month.setUTCMonth(month.getUTCMonth() - i);
        months.push(`${month.getUTCFullYear()}-${String(month.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return months;
}
//# sourceMappingURL=reportFilters.js.map