export const NO_CREDITOR_SELECTION = '__NO_CREDITOR_SELECTION__';

export function isNoCreditorSelection(selectedCreditors: Set<string>) {
  return selectedCreditors.has(NO_CREDITOR_SELECTION);
}

export function normalizeCreditorGroup(value: string) {
  const upper = value.trim().toUpperCase();
  if (upper.includes('JT INTERNATIONAL') || upper.includes('JT INTERNACIONAL') || upper.includes('GRUPO JTI')) return 'GRUPO JTI';
  if (upper.includes('SOUZA CRUZ')) return 'SOUZA CRUZ';
  if (
    upper.includes('NORSA REFRIGERANTES') ||
    upper.includes('REFRESCOS GURARAPES') ||
    upper.includes('REFRESCOS GUARARAPES') ||
    upper.includes('BRASIL NORTE BEBIDA') ||
    upper.includes('BRASIL NORTE BEBIDAS') ||
    upper.includes('SOLAR BR')
  ) return 'SOLAR BR';
  return upper;
}

export function groupBy<T>(items: T[], getKey: (item: T) => string) {
  return items.reduce<Record<string, T[]>>((acc, item) => {
    const key = getKey(item) || 'OUTROS';
    acc[key] = acc[key] || [];
    acc[key].push(item);
    return acc;
  }, {});
}
