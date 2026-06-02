import type { DashboardData, SystemFilter } from '../types';
import { monthKey } from './dates';
import { safeNumber } from './formatters';
import { isNoCreditorSelection } from './creditors';

type RowWithCompany = {
  idempresa: number;
};

type RowWithDate = {
  data: string;
};

export type DashboardMetrics = ReturnType<typeof summarizeDashboardMetrics>;

export function getAvailableCreditors(data: DashboardData) {
  const values = [
    ...data.baixas.map((row) => row.credor),
    ...data.acordos.map((row) => row.credor),
    ...data.acessos.map((row) => row.credor || ''),
  ]
    .map((value) => value.trim())
    .filter(Boolean);

  return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}

export function matchesSystem(row: RowWithCompany, system: SystemFilter) {
  return system === 'total' || (system === 'consulth' ? row.idempresa === 401 : row.idempresa === 1007);
}

export function filterDashboardData(params: {
  data: DashboardData;
  system: SystemFilter;
  period: string;
  periods?: Set<string>;
  selectedCreditors: Set<string>;
  businessDayMap: Map<string, number>;
  selectedBusinessDayLimit: number | null;
}) {
  const { data, system, period, periods, selectedCreditors, businessDayMap, selectedBusinessDayLimit } = params;

  const matchesPeriod = (row: RowWithDate) => {
    const key = monthKey(row.data);
    return periods && periods.size > 0 ? periods.has(key) : !period || key === period;
  };
  const noCreditorSelected = isNoCreditorSelection(selectedCreditors);
  const matchesCreditor = (creditor?: string | null) => !noCreditorSelected && (selectedCreditors.size === 0 || (creditor ? selectedCreditors.has(creditor) : false));
  const matchesBusinessDay = (row: RowWithDate) => {
    if (!selectedBusinessDayLimit) return true;
    const dayIndex = businessDayMap.get(row.data);
    return Boolean(dayIndex && dayIndex <= selectedBusinessDayLimit);
  };

  return {
    baixas: data.baixas.filter((row) => matchesSystem(row, system) && matchesPeriod(row) && matchesBusinessDay(row) && matchesCreditor(row.credor)),
    acordos: data.acordos.filter((row) => matchesSystem(row, system) && matchesPeriod(row) && matchesBusinessDay(row) && matchesCreditor(row.credor)),
    acessos: data.acessos.filter(
      (row) => !noCreditorSelected && matchesSystem(row, system) && matchesPeriod(row) && matchesBusinessDay(row) && (selectedCreditors.size === 0 || !row.credor || selectedCreditors.has(row.credor))
    ),
  };
}

export function filterPreviousPeriodData(data: DashboardData, system: SystemFilter, period: string, selectedCreditors: Set<string>) {
  const noCreditorSelected = isNoCreditorSelection(selectedCreditors);
  const matchesCreditor = (creditor?: string | null) => !noCreditorSelected && (selectedCreditors.size === 0 || (creditor ? selectedCreditors.has(creditor) : false));

  return {
    baixas: data.baixas.filter((row) => matchesSystem(row, system) && monthKey(row.data) === period && matchesCreditor(row.credor)),
    acordos: data.acordos.filter((row) => matchesSystem(row, system) && monthKey(row.data) === period && matchesCreditor(row.credor)),
    acessos: data.acessos.filter(
      (row) => !noCreditorSelected && matchesSystem(row, system) && monthKey(row.data) === period && (selectedCreditors.size === 0 || !row.credor || selectedCreditors.has(row.credor))
    ),
  };
}

export function summarizeDashboardMetrics(rows: DashboardData) {
  const totalPago = rows.baixas.reduce((sum, row) => sum + safeNumber(row.capital_pago) + safeNumber(row.juros_pago) + safeNumber(row.multa_pago) + safeNumber(row.honorarios_pago_portal), 0);
  const capital = rows.baixas.reduce((sum, row) => sum + safeNumber(row.capital_pago), 0);
  const honorarios = rows.baixas.reduce((sum, row) => sum + safeNumber(row.honorarios_pago_portal), 0);
  const faturamento = rows.baixas.reduce(
    (sum, row) => sum
      + safeNumber(row.honorarios_pago_portal)
      + safeNumber(row.taxa_pago)
      + safeNumber(row.taxa_adm_pago)
      + safeNumber(row.outras_taxas_pago)
      + safeNumber(row.taxa_pd_pago)
      + safeNumber(row.protesto_pago)
      + safeNumber(row.multa_pago)
      + safeNumber(row.juros_pago)
      + safeNumber(row.juros_mora_pago),
    0
  );
  const totalAcordos = rows.acordos.reduce((sum, row) => sum + safeNumber(row.tot_sub_total), 0);
  const acordosPagos = new Set(rows.baixas.map((row) => row.processo).filter(Boolean)).size;
  const creditors = new Set([...rows.baixas.map((row) => row.credor), ...rows.acordos.map((row) => row.credor)].filter(Boolean));
  const acessosComAcordo = rows.acessos.filter((row) => row.situacao === 'COM ACORDO').length;

  return {
    totalPago,
    capital,
    honorarios,
    faturamento,
    totalAcordos,
    credores: creditors.size,
    acordos: rows.acordos.length,
    acordosPagos,
    acessos: rows.acessos.length,
    acessosComAcordo,
    acessosSemAcordo: rows.acessos.length - acessosComAcordo,
    conversao: rows.acessos.length > 0 ? (rows.acordos.length / rows.acessos.length) * 100 : 0,
    ticketPorAcordo: rows.acordos.length > 0 ? totalPago / rows.acordos.length : 0,
    ticketPorPagamento: rows.baixas.length > 0 ? rows.baixas.reduce((sum, row) => sum + safeNumber(row.total_pago_portal), 0) / rows.baixas.length : 0,
  };
}

export function countBusinessDaysWithData(rows: DashboardData, businessDayMap: Map<string, number>) {
  return new Set([
    ...rows.baixas.map((row) => row.data),
    ...rows.acordos.map((row) => row.data),
    ...rows.acessos.map((row) => row.data),
  ].filter((date) => businessDayMap.has(date))).size;
}
