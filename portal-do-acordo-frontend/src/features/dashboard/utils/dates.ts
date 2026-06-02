const MONTHS_SHORT = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
const MONTHS_LONG = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];

export function monthKey(date: string) {
  return date?.slice(0, 7) || '';
}

export function dayLabel(date: string) {
  const [, month, day] = date.split('-');
  return day && month ? `${day}/${month}` : date;
}

export function periodLabel(period: string, long = false) {
  const [year, month] = period.split('-').map(Number);
  const label = long ? MONTHS_LONG[month - 1] : MONTHS_SHORT[month - 1];
  return `${label} / ${year}`;
}

export function periodRangeLabel(period: string) {
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return `Período: 01 a ${String(lastDay).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
}

export function previousPeriod(period: string) {
  if (!period) return '';
  const [year, month] = period.split('-').map(Number);
  const date = new Date(year, month - 2, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function easterDate(year: number) {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(year, month - 1, day);
}

function addDays(date: Date, days: number) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function holidaySet(year: number) {
  const easter = easterDate(year);
  return new Set([
    `${year}-01-01`,
    dateKey(addDays(easter, -48)),
    dateKey(addDays(easter, -47)),
    dateKey(addDays(easter, -2)),
    `${year}-04-21`,
    `${year}-05-01`,
    dateKey(addDays(easter, 60)),
    `${year}-09-07`,
    `${year}-10-12`,
    `${year}-11-02`,
    `${year}-11-15`,
    `${year}-12-25`,
  ]);
}

export function isBusinessDay(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const parsed = new Date(year, month - 1, day);
  const weekday = parsed.getDay();
  return weekday !== 0 && weekday !== 6 && !holidaySet(year).has(date);
}

export function businessDaysInPeriod(period: string) {
  if (!period) return 0;
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  let total = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isBusinessDay(key)) total += 1;
  }
  return total;
}

export function businessDayIndexMap(period: string) {
  const map = new Map<string, number>();
  if (!period) return map;
  const [year, month] = period.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  let index = 0;
  for (let day = 1; day <= lastDay; day += 1) {
    const key = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    if (isBusinessDay(key)) {
      index += 1;
      map.set(key, index);
    }
  }
  return map;
}

export function businessDayLimitDate(period: string, limit: number) {
  if (!period || !Number.isInteger(limit) || limit < 1) return null;

  let lastDate: string | null = null;
  businessDayIndexMap(period).forEach((index, date) => {
    if (index <= limit) lastDate = date;
  });
  return lastDate;
}
