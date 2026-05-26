export const DEFAULT_YEAR = 2026;
export const NEGOCIADORES = ['PORTALNEG', 'KETLEN.ATANAZIO', 'ZAQUEU.RITTER'];
export const sistemaToIds = {
    consulth: [401],
    sisth: [1007],
    total: [401, 1007],
};
export function getSistemaIds(sistema) {
    return sistema ? [...sistemaToIds[sistema]] : [...sistemaToIds.total];
}
export function parsePeriodo(periodo) {
    if (!periodo)
        return null;
    const match = periodo.match(/^(\d{4})-(0[1-9]|1[0-2])$/);
    if (!match)
        return null;
    const start = new Date(`${periodo}-01T00:00:00Z`);
    const end = new Date(start);
    end.setUTCMonth(end.getUTCMonth() + 1);
    return { start, end };
}
export function buildPeriodoFilter(periodo) {
    const range = parsePeriodo(periodo);
    if (!range)
        return undefined;
    return { data: { gte: range.start, lt: range.end } };
}
export function buildSistemaFilter(sistema) {
    if (!sistema)
        return undefined;
    return { idempresa: { in: getSistemaIds(sistema) } };
}
export function getPeriodoRange(periodo) {
    return parsePeriodo(periodo) ?? {
        start: new Date(Date.UTC(DEFAULT_YEAR, 0, 1)),
        end: new Date(Date.UTC(DEFAULT_YEAR + 1, 0, 1)),
    };
}
export function getLivePeriodYearRange(periodo) {
    const parsed = parsePeriodo(periodo);
    const year = parsed ? parsed.start.getUTCFullYear() : DEFAULT_YEAR;
    return {
        start: new Date(Date.UTC(year, 0, 1)),
        end: new Date(Date.UTC(year + 1, 0, 1)),
    };
}
export function addSqlParam(params, value) {
    params.push(value);
    return `$${params.length}`;
}
export function buildSqlInFilter(expression, values, params) {
    const uniqueValues = Array.from(new Set(values?.map((value) => value.trim()).filter(Boolean) ?? []));
    if (uniqueValues.length === 0)
        return '';
    const placeholders = uniqueValues.map((value) => addSqlParam(params, value)).join(', ');
    return `AND ${expression} IN (${placeholders})`;
}
export function monthKey(date) {
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
export function formatMonthLabel(key) {
    const [year, month] = key.split('-').map(Number);
    const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
    return `${months[month - 1]}/${String(year).slice(-2)}`;
}
export function getLastThreeMonths(periodo) {
    const now = periodo ? new Date(`${periodo}-01T00:00:00Z`) : new Date();
    const months = [];
    const date = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    for (let i = 2; i >= 0; i--) {
        const m = new Date(date);
        m.setUTCMonth(m.getUTCMonth() - i);
        months.push(`${m.getUTCFullYear()}-${String(m.getUTCMonth() + 1).padStart(2, '0')}`);
    }
    return months;
}
//# sourceMappingURL=shared.js.map