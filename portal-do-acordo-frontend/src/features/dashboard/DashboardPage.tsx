import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  LabelList,
  Line,
  LineChart,
  Legend,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Building2, Check, ChevronDown, FileSpreadsheet, Pause, Play, Presentation, Printer, X } from 'lucide-react';
import logoUrl from '../../assets/portal-agreement-logo.png';
import { BarRows } from './components/BarRows';
import { MetricCard } from './components/MetricCard';
import { Panel } from './components/Panel';
import { Section } from './components/Section';
import { CHART_PALETTE, COLORS, FIXED_EMAIL_COST } from './config/constants';
import { DEMO_WHATSAPP_CAMPAIGN_DATA, isDemoMode } from './data/demoDashboardData';
import { WHATSAPP_CAMPAIGN_DATA, type WhatsappCampaignCredor } from './data/whatsappCampaigns';
import { useBaseSummaryData, useCreditorsData, useDashboardData, useDashboardPerformanceSummary, useDashboardResultGraphs, useDashboardResultSummary, useDashboardSupplementalData, usePortfolioData } from './hooks/useDashboardData';
import { fetchActiveUsers, fetchMonthlyFinancialPayments, sendPresenceHeartbeat } from './services/dashboardApi';
import type { Access, ActiveUsersReport, Agreement, CostsData, DashboardTab, PortfolioEntry, SystemFilter } from './types';
import { groupBy, isNoCreditorSelection, NO_CREDITOR_SELECTION, normalizeCreditorGroup } from './utils/creditors';
import { businessDayIndexMap, businessDayLimitDate, businessDaysInPeriod, dayLabel, monthKey, periodLabel, periodRangeLabel, previousPeriod } from './utils/dates';
import { countBusinessDaysWithData, filterDashboardData, matchesSystem, summarizeDashboardMetrics } from './utils/dashboardMetrics';
import { downloadMonthlyFinancialExcel } from './utils/exportMonthlyFinancialExcel';
import { compactMoney, dateTime, money, number, percent, safeNumber, systemLabel } from './utils/formatters';
import './styles/dashboard.css';

const safe = safeNumber;
const CHART_ANIMATION_ACTIVE = false;
const PRESENCE_SESSION_KEY = 'portal-presence-session-id';
const PRESENTATION_TABS: DashboardTab[] = ['relatorio', 'performance', 'base-ativa', 'custos'];
const TAB_LABELS: Record<DashboardTab, string> = {
  relatorio: 'Resultados',
  custos: 'Custos',
  performance: 'Performance',
  carteiras: 'Carteiras',
  'base-ativa': 'Bases',
};
const AGING_LABELS: Record<string, string> = {
  '0-90': '0 a 90 dias',
  '91-180': '91 a 180 dias',
  '181-360': '181 a 360 dias',
  '361+': '361+ dias',
};
const MONTHLY_TARGETS: Record<string, { recuperado: number; faturamento: number }> = {
  '2026-02': { recuperado: 250000, faturamento: 35000 },
  '2026-03': { recuperado: 275000, faturamento: 40000 },
  '2026-04': { recuperado: 300000, faturamento: 45000 },
  '2026-05': { recuperado: 350000, faturamento: 50000 },
  '2026-06': { recuperado: 365354, faturamento: 54721 },
  '2026-07': { recuperado: 401889, faturamento: 60193 },
  '2026-08': { recuperado: 442078, faturamento: 66212 },
  '2026-09': { recuperado: 486286, faturamento: 72833 },
  '2026-10': { recuperado: 534914, faturamento: 80116 },
  '2026-11': { recuperado: 588405, faturamento: 88128 },
  '2026-12': { recuperado: 647246, faturamento: 96941 },
};

function variation(current: number, previous: number | null | undefined) {
  return previous && previous !== 0 ? ((current - previous) / previous) * 100 : null;
}

function variationLabel(value: number | null) {
  return value !== null && Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : 'Sem base';
}

function getInitialTab(): DashboardTab {
  if (typeof window === 'undefined') return 'relatorio';
  const requested = new URLSearchParams(window.location.search).get('tab');
  if (requested === 'carteiras') return 'base-ativa';
  const requestedTab = requested as DashboardTab | null;
  return requestedTab && TAB_LABELS[requestedTab] ? requestedTab : 'relatorio';
}

function getPresenceSessionId() {
  if (typeof window === 'undefined') return '';
  const existing = window.localStorage.getItem(PRESENCE_SESSION_KEY);
  if (existing) return existing;

  const next = typeof window.crypto?.randomUUID === 'function'
    ? window.crypto.randomUUID()
    : `session-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  window.localStorage.setItem(PRESENCE_SESSION_KEY, next);
  return next;
}

function getAdminToken() {
  if (typeof window === 'undefined') return '';
  return new URLSearchParams(window.location.search).get('admin')?.trim() ?? '';
}

function formatDuration(seconds: number) {
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}min ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  return `${hours}h ${minutes % 60}min`;
}

function calendarWeekOfMonth(date: string) {
  const [year, month, day] = date.split('-').map(Number);
  const firstDay = new Date(year, month - 1, 1).getDay();
  const mondayBasedOffset = (firstDay + 6) % 7;
  return Math.floor((day + mondayBasedOffset - 1) / 7) + 1;
}

function viewportLabel(value: { width: number | null; height: number | null }) {
  return value.width && value.height ? `${value.width} x ${value.height}` : '-';
}

function shortMoney(value: number) {
  const absoluteValue = Math.abs(value);
  if (absoluteValue >= 1000000) return `R$ ${(value / 1000000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} mi`;
  if (absoluteValue >= 1000) return `R$ ${(value / 1000).toLocaleString('pt-BR', { maximumFractionDigits: 0 })} mil`;
  return compactMoney(value);
}

function DashboardPage() {
  const adminToken = getAdminToken();
  const [activeUsers, setActiveUsers] = useState<ActiveUsersReport | null>(null);
  const [activeUsersError, setActiveUsersError] = useState('');
  const demoMode = isDemoMode();
  const [system, setSystem] = useState<SystemFilter>(() => demoMode ? 'total' : 'consulth');
  const [tab, setTab] = useState<DashboardTab>(getInitialTab);
  const [selectedCredores, setSelectedCredores] = useState<Set<string>>(new Set());
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [businessDayLimit, setBusinessDayLimit] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [periodFilterOpen, setPeriodFilterOpen] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [presentationPaused, setPresentationPaused] = useState(false);
  const [tvMode, setTvMode] = useState(false);
  const [tvTime, setTvTime] = useState(new Date());
  const [forceRawPreviousForResults, setForceRawPreviousForResults] = useState(false);
  const [excelExporting, setExcelExporting] = useState(false);
  const creditorFilterRef = useRef<HTMLDivElement>(null);
  const periodFilterRef = useRef<HTMLDivElement>(null);
  const includePreviousRawPeriod = (tab !== 'relatorio' && tab !== 'custos' && !(tab === 'performance' && businessDayLimit === 'all')) || businessDayLimit !== 'all' || forceRawPreviousForResults;
  const rawDashboardEnabled = tab !== 'base-ativa' && tab !== 'custos';
  const { data, loading, error, period, setPeriod, periods } = useDashboardData(selectedPeriods, system, rawDashboardEnabled, includePreviousRawPeriod);
  const effectivePeriods = useMemo(() => (selectedPeriods.size > 0 ? selectedPeriods : period ? new Set([period]) : new Set<string>()), [period, selectedPeriods]);
  const portfolioPeriods = effectivePeriods;
  const dateFilterIgnored = false;
  const visiblePeriods = dateFilterIgnored ? new Set(periods) : effectivePeriods;
  const selectedPeriodList = useMemo(() => Array.from(effectivePeriods).sort().reverse(), [effectivePeriods]);
  const portfolioPeriodList = useMemo(() => Array.from(portfolioPeriods).sort().reverse(), [portfolioPeriods]);
  const primaryPeriod = selectedPeriodList[0] ?? period;
  const primaryPortfolioPeriod = portfolioPeriodList[0] ?? primaryPeriod;
  const isMultiPeriod = selectedPeriodList.length > 1;
  const maxBusinessDaysInSelectedPeriods = useMemo(() => selectedPeriodList.reduce((max, item) => Math.max(max, businessDaysInPeriod(item)), 0), [selectedPeriodList]);
  const selectedBusinessDayLimit = !dateFilterIgnored && businessDayLimit !== 'all' ? Math.min(Number(businessDayLimit), maxBusinessDaysInSelectedPeriods) : null;
  const emailClicksEndDate = selectedBusinessDayLimit ? businessDayLimitDate(primaryPeriod, selectedBusinessDayLimit) : null;
  const periodSeries = useMemo(
    () => [...selectedPeriodList].sort().map((item, index) => ({
      period: item,
      key: `period_${item.replace('-', '_')}`,
      label: periodLabel(item),
      color: CHART_PALETTE[index % CHART_PALETTE.length],
    })),
    [selectedPeriodList]
  );
  const comparisonTooltipName = (name: string, item: { payload?: Record<string, string | number> }) => {
    const series = periodSeries.find((current) => current.label === name);
    const date = series ? item.payload?.[`${series.key}_date`] : null;
    return date ? `${name} (${date})` : name;
  };
  const { costs: custos, communication: comunicacao, emailClicks, loading: supplementalLoading, refreshing: supplementalRefreshing, costsError, retryCosts } = useDashboardSupplementalData(primaryPeriod, system, selectedCredores, {
    costs: tab === 'performance' || tab === 'custos',
    communication: tab === 'performance' || tab === 'custos',
    communicationDaily: businessDayLimit !== 'all',
    emailClicks: tab === 'performance',
    emailClicksEndDate,
  });
  const { baseSummary, baseSummaryLoading, baseSummaryError } = useBaseSummaryData(system, portfolioPeriods, selectedCredores, tab === 'base-ativa');
  const { portfolioData, portfolioLoading, portfolioError } = usePortfolioData(system, portfolioPeriods, selectedCredores, tab === 'carteiras');
  const creditorOptions = useCreditorsData(primaryPeriod, system);

  useEffect(() => {
    if (!adminToken) return undefined;

    let active = true;
    const loadActiveUsers = () => {
      fetchActiveUsers(adminToken)
        .then((report) => {
          if (!active) return;
          setActiveUsers(report);
          setActiveUsersError('');
        })
        .catch((err) => {
          if (!active) return;
          setActiveUsers(null);
          setActiveUsersError(err instanceof Error ? err.message : 'Erro ao carregar pessoas ativas.');
        });
    };

    loadActiveUsers();
    const interval = window.setInterval(loadActiveUsers, 15000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [adminToken]);

  useEffect(() => {
    if (demoMode) return undefined;

    const sendHeartbeat = () => {
      sendPresenceHeartbeat({
        sessionId: getPresenceSessionId(),
        path: `${window.location.pathname}${window.location.search}`,
        tab,
        period: primaryPeriod,
        system,
        referrer: document.referrer,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        language: navigator.language,
        visibility: document.visibilityState,
        viewport: { width: window.innerWidth, height: window.innerHeight },
        screen: { width: window.screen.width, height: window.screen.height },
      });
    };

    sendHeartbeat();
    const interval = window.setInterval(sendHeartbeat, 30000);
    window.addEventListener('focus', sendHeartbeat);
    document.addEventListener('visibilitychange', sendHeartbeat);

    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', sendHeartbeat);
      document.removeEventListener('visibilitychange', sendHeartbeat);
    };
  }, [demoMode, primaryPeriod, system, tab]);

  useEffect(() => {
    function closeFiltersOnOutsideClick(event: MouseEvent) {
      const target = event.target as Node;
      const clickedInsideCreditorFilter = creditorFilterRef.current?.contains(target);
      const clickedInsidePeriodFilter = periodFilterRef.current?.contains(target);
      if (!clickedInsideCreditorFilter && !clickedInsidePeriodFilter) {
        setFilterOpen(false);
        setPeriodFilterOpen(false);
      }
    }

    document.addEventListener('mousedown', closeFiltersOnOutsideClick);
    return () => document.removeEventListener('mousedown', closeFiltersOnOutsideClick);
  }, []);

  useEffect(() => {
    if (!presentationMode && !tvMode) return;
    setFilterOpen(false);
    setPeriodFilterOpen(false);
  }, [presentationMode, tvMode]);

  // Auto-refresh a cada 30 minutos em modo TV
  useEffect(() => {
    if (!tvMode) return undefined;

    const interval = window.setInterval(() => {
      window.location.reload();
    }, 30 * 60 * 1000); // 30 minutos

    return () => window.clearInterval(interval);
  }, [tvMode]);

  // Atualizar relógio a cada segundo em modo TV
  useEffect(() => {
    if (!tvMode) return undefined;

    const timer = window.setInterval(() => {
      setTvTime(new Date());
    }, 1000);

    return () => window.clearInterval(timer);
  }, [tvMode]);

  useEffect(() => {
    if (!presentationMode || presentationPaused) return undefined;

    const interval = window.setInterval(() => {
      setTab((current) => {
        const currentIndex = PRESENTATION_TABS.indexOf(current);
        return PRESENTATION_TABS[(currentIndex + 1) % PRESENTATION_TABS.length];
      });
    }, 18000);

    return () => window.clearInterval(interval);
  }, [presentationMode, presentationPaused]);

  useEffect(() => {
    function handlePresentationKeys(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setPresentationMode(false);
        setTvMode(false);
      }
      if (!presentationMode && !tvMode) return;
      if (tvMode) return;
      if (event.key === ' ') {
        event.preventDefault();
        if (presentationMode) setPresentationPaused((current) => !current);
      }
      if (event.key === 'ArrowRight') {
        setTab((current) => {
          const currentIndex = PRESENTATION_TABS.indexOf(current);
          return PRESENTATION_TABS[(currentIndex + 1) % PRESENTATION_TABS.length];
        });
      }
      if (event.key === 'ArrowLeft') {
        setTab((current) => {
          const currentIndex = PRESENTATION_TABS.indexOf(current);
          return PRESENTATION_TABS[(currentIndex - 1 + PRESENTATION_TABS.length) % PRESENTATION_TABS.length];
        });
      }
    }

    document.addEventListener('keydown', handlePresentationKeys);
    return () => document.removeEventListener('keydown', handlePresentationKeys);
  }, [presentationMode, tvMode]);

  const allCredores = useMemo(() => {
    const values = [...creditorOptions, ...baseSummary.processos_por_credor.map((row) => row.credor)];
    return Array.from(new Set(values)).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  }, [baseSummary.processos_por_credor, creditorOptions]);
  const noCreditorSelected = isNoCreditorSelection(selectedCredores);

  const color = COLORS[system];
  const chartAccent = color === COLORS.consulth ? COLORS.sky : color;
  const businessDays = useMemo(() => selectedPeriodList.reduce((sum, item) => sum + businessDaysInPeriod(item), 0), [selectedPeriodList]);
  const businessDayMap = useMemo(() => {
    const map = new Map<string, number>();
    selectedPeriodList.forEach((item) => {
      businessDayIndexMap(item).forEach((index, date) => map.set(date, index));
    });
    return map;
  }, [selectedPeriodList]);
  const businessDaySelectValue = dateFilterIgnored || businessDayLimit === 'all' || maxBusinessDaysInSelectedPeriods === 0
    ? 'all'
    : String(Math.min(Number(businessDayLimit), maxBusinessDaysInSelectedPeriods));
  const resultSummaryEnabled = tab === 'relatorio' && selectedPeriodList.length === 1 && !selectedBusinessDayLimit;
  const { resultSummary, resultSummaryError } = useDashboardResultSummary(primaryPeriod, system, selectedCredores, resultSummaryEnabled);
  const { resultGraphs } = useDashboardResultGraphs(primaryPeriod, system, selectedCredores, resultSummaryEnabled);
  const performanceSummaryEnabled = tab === 'performance' && selectedPeriodList.length === 1 && !selectedBusinessDayLimit;
  const { performanceSummary } = useDashboardPerformanceSummary(primaryPeriod, system, selectedCredores, performanceSummaryEnabled);

  useEffect(() => {
    setForceRawPreviousForResults(false);
  }, [businessDayLimit, primaryPeriod, selectedCredores, system, tab]);

  useEffect(() => {
    if (resultSummaryEnabled && resultSummaryError) setForceRawPreviousForResults(true);
  }, [resultSummaryEnabled, resultSummaryError]);
  const matchesSelectedBusinessDays = useCallback((date: string, periodSet = effectivePeriods) => {
    const datePeriod = monthKey(date);
    if (periodSet.size > 0 && !periodSet.has(datePeriod)) return false;
    if (!selectedBusinessDayLimit) return true;
    const businessDay = businessDayMap.get(date);
    return Boolean(businessDay && businessDay <= selectedBusinessDayLimit);
  }, [businessDayMap, effectivePeriods, selectedBusinessDayLimit]);

  const filtered = useMemo(
    () => filterDashboardData({ data, system, period: primaryPeriod, periods: effectivePeriods, selectedCreditors: selectedCredores, businessDayMap, selectedBusinessDayLimit }),
    [businessDayMap, data, effectivePeriods, primaryPeriod, selectedBusinessDayLimit, selectedCredores, system]
  );
  const exportMonthlyFinancialExcel = useCallback(async () => {
    if (excelExporting) return;
    if (isNoCreditorSelection(selectedCredores)) {
      window.alert('Selecione ao menos um credor para gerar o Excel.');
      return;
    }

    setExcelExporting(true);
    try {
      const payments = demoMode
        ? filtered.baixas
        : (await Promise.all(selectedPeriodList.map((item) => fetchMonthlyFinancialPayments(item, system, selectedCredores)))).flat();
      if (!downloadMonthlyFinancialExcel(payments)) {
        window.alert('Não há recebimentos disponíveis para gerar o Excel mensal com os filtros atuais.');
      }
    } catch (error) {
      const detail = error instanceof Error ? ` Detalhe: ${error.message}` : '';
      window.alert(`Não foi possível gerar o Excel mensal.${detail}`);
    } finally {
      setExcelExporting(false);
    }
  }, [demoMode, excelExporting, filtered.baixas, selectedCredores, selectedPeriodList, system]);
  const portfolioBusinessDayLimit = tab === 'base-ativa' ? null : selectedBusinessDayLimit;
  const portfolioFiltered = useMemo(
    () => filterDashboardData({ data, system, period: primaryPortfolioPeriod, periods: portfolioPeriods, selectedCreditors: selectedCredores, businessDayMap, selectedBusinessDayLimit: portfolioBusinessDayLimit }),
    [businessDayMap, data, portfolioBusinessDayLimit, portfolioPeriods, primaryPortfolioPeriod, selectedCredores, system]
  );
  const consideredBusinessDays = selectedBusinessDayLimit
    ? selectedPeriodList.reduce((sum, item) => sum + Math.min(selectedBusinessDayLimit, businessDaysInPeriod(item)), 0)
    : Math.max(countBusinessDaysWithData(filtered, businessDayMap), 1);

  const metrics = useMemo(() => {
    return summarizeDashboardMetrics(filtered);
  }, [filtered]);

  const projectionTarget = useMemo(() => {
    const targets = selectedPeriodList.map((item) => MONTHLY_TARGETS[item]).filter(Boolean);
    if (targets.length === 0) return null;

    return targets.reduce(
      (total, target) => ({
        recuperado: total.recuperado + target.recuperado,
        faturamento: total.faturamento + target.faturamento,
      }),
      { recuperado: 0, faturamento: 0 }
    );
  }, [selectedPeriodList]);

  const projectionRows = useMemo(() => {
    const factor = businessDays > 0 && consideredBusinessDays > 0 ? businessDays / consideredBusinessDays : 0;

    return [
      { name: 'Total Recuperado', atual: metrics.totalPago, projetado: metrics.totalPago * factor, meta: projectionTarget?.recuperado ?? null },
      { name: 'Total Faturamento', atual: metrics.faturamento, projetado: metrics.faturamento * factor, meta: projectionTarget?.faturamento ?? null },
    ];
  }, [businessDays, consideredBusinessDays, metrics, projectionTarget]);

  const projectionBaseDays = consideredBusinessDays;

  const previousPeriodKey = selectedPeriodList.length === 1 ? previousPeriod(primaryPeriod) : '';
  const previousBusinessDayMap = useMemo(() => previousPeriodKey ? businessDayIndexMap(previousPeriodKey) : new Map<string, number>(), [previousPeriodKey]);
  const previousFiltered = useMemo(() => {
    if (!previousPeriodKey) return null;
    return filterDashboardData({
      data,
      system,
      period: previousPeriodKey,
      periods: new Set([previousPeriodKey]),
      selectedCreditors: selectedCredores,
      businessDayMap: previousBusinessDayMap,
      selectedBusinessDayLimit,
    });
  }, [data, previousBusinessDayMap, previousPeriodKey, selectedBusinessDayLimit, selectedCredores, system]);
  const previousMetrics = useMemo(() => previousFiltered ? summarizeDashboardMetrics(previousFiltered) : null, [previousFiltered]);
  const resultMetrics = useMemo(() => {
    if (!resultSummaryEnabled || !resultSummary) return metrics;
    return {
      ...metrics,
      totalPago: resultSummary.atual.total_recuperado,
      capital: resultSummary.atual.capital_recuperado,
      faturamento: resultSummary.atual.faturamento,
      totalAcordos: resultSummary.atual.valor_acordos,
      acordos: resultSummary.atual.acordos,
      acordosPagos: resultSummary.atual.acordos_pagos,
      acessos: resultSummary.atual.acessos,
      acessosComAcordo: resultSummary.atual.acessos_com_acordo,
      acessosSemAcordo: Math.max(resultSummary.atual.acessos - resultSummary.atual.acessos_com_acordo, 0),
      conversao: resultSummary.atual.conversao,
      ticketPorAcordo: resultSummary.atual.acordos > 0 ? resultSummary.atual.total_recuperado / resultSummary.atual.acordos : 0,
    };
  }, [metrics, resultSummary, resultSummaryEnabled]);
  const resultPreviousMetrics = useMemo(() => {
    if (!resultSummaryEnabled || !resultSummary) return previousMetrics;
    const base = previousMetrics ?? metrics;
    return {
      ...base,
      totalPago: resultSummary.anterior.total_recuperado,
      capital: resultSummary.anterior.capital_recuperado,
      faturamento: resultSummary.anterior.faturamento,
      totalAcordos: resultSummary.anterior.valor_acordos,
      acordos: resultSummary.anterior.acordos,
      acordosPagos: resultSummary.anterior.acordos_pagos,
      acessos: resultSummary.anterior.acessos,
      acessosComAcordo: resultSummary.anterior.acessos_com_acordo,
      acessosSemAcordo: Math.max(resultSummary.anterior.acessos - resultSummary.anterior.acessos_com_acordo, 0),
      conversao: resultSummary.anterior.conversao,
      ticketPorAcordo: resultSummary.anterior.acordos > 0 ? resultSummary.anterior.total_recuperado / resultSummary.anterior.acordos : 0,
    };
  }, [metrics, previousMetrics, resultSummary, resultSummaryEnabled]);
  const resultComparisonRows = useMemo(() => [
    { name: 'TOTAL RECUPERADO', atual: resultMetrics.totalPago, anterior: resultPreviousMetrics?.totalPago, variation: variation(resultMetrics.totalPago, resultPreviousMetrics?.totalPago), formatter: money },
    { name: 'CAPITAL RECUPERADO', atual: resultMetrics.capital, anterior: resultPreviousMetrics?.capital, variation: variation(resultMetrics.capital, resultPreviousMetrics?.capital), formatter: money },
    { name: 'FATURAMENTO', atual: resultMetrics.faturamento, anterior: resultPreviousMetrics?.faturamento, variation: variation(resultMetrics.faturamento, resultPreviousMetrics?.faturamento), formatter: money },
    { name: 'ACORDOS', atual: resultMetrics.acordos, anterior: resultPreviousMetrics?.acordos, variation: variation(resultMetrics.acordos, resultPreviousMetrics?.acordos), formatter: number },
    { name: 'ACESSO', atual: resultMetrics.acessos, anterior: resultPreviousMetrics?.acessos, variation: variation(resultMetrics.acessos, resultPreviousMetrics?.acessos), formatter: number },
    { name: 'CONVERSÃO', atual: resultMetrics.conversao, anterior: resultPreviousMetrics?.conversao, variation: variation(resultMetrics.conversao, resultPreviousMetrics?.conversao), formatter: (value: number) => `${value.toFixed(1)}%` },
  ], [resultMetrics, resultPreviousMetrics]);

  const componentRows = useMemo(() => {
    const rows = [
      { name: 'Capital Pago', value: filtered.baixas.reduce((sum, row) => sum + safe(row.capital_pago), 0), color },
      { name: 'Juros', value: filtered.baixas.reduce((sum, row) => sum + safe(row.juros_pago), 0), color: COLORS.gold },
      { name: 'Multa', value: filtered.baixas.reduce((sum, row) => sum + safe(row.multa_pago), 0), color: COLORS.rust },
      { name: 'Honorários', value: filtered.baixas.reduce((sum, row) => sum + safe(row.honorarios_pago_portal), 0), color: COLORS.sky },
    ];
    return rows.filter((row) => row.value > 0);
  }, [color, filtered.baixas]);
  const resultComponentRows = useMemo(() => {
    if (!resultSummaryEnabled || !resultGraphs) return componentRows;
    const rows = [
      { name: 'Capital Pago', value: resultGraphs.componentes.capital, color },
      { name: 'Juros', value: resultGraphs.componentes.juros, color: COLORS.gold },
      { name: 'Multa', value: resultGraphs.componentes.multa, color: COLORS.rust },
      { name: 'Honorários', value: resultGraphs.componentes.honorarios, color: COLORS.sky },
    ];
    return rows.filter((row) => row.value > 0);
  }, [color, componentRows, resultGraphs, resultSummaryEnabled]);

  const acessosCredorRows = useMemo(() => {
    const groups = groupBy(filtered.acessos.filter((row) => row.situacao === 'COM ACORDO' && row.credor && row.credor !== 'OUTROS'), (row) => row.credor || 'OUTROS');
    return Object.entries(groups).map(([name, rows]) => ({ name, value: rows.length })).sort((a, b) => b.value - a.value);
  }, [filtered.acessos]);

  const acordosRows = useMemo(() => {
    if (resultSummaryEnabled && resultGraphs) {
      return resultGraphs.porCredor
        .map((row) => ({
          name: row.credor,
          value: row.acordos,
          acordos: row.acordos,
          pagos: row.pagos,
          conversaoPago: row.conversaoPago,
        }))
        .sort((a, b) => b.acordos - a.acordos || b.pagos - a.pagos || a.name.localeCompare(b.name));
    }

    const formalizadosByCredor = groupBy(filtered.acordos, (row) => row.credor || 'OUTROS');
    const pagosByCredor = groupBy(filtered.baixas, (row) => row.credor || 'OUTROS');
    const names = new Set([...Object.keys(formalizadosByCredor), ...Object.keys(pagosByCredor)]);

    return Array.from(names)
      .map((name) => {
        const acordos = formalizadosByCredor[name]?.length ?? 0;
        const pagosRows = pagosByCredor[name] ?? [];
        const processosPagos = new Set(pagosRows.map((row) => row.processo).filter(Boolean));
        const pagos = processosPagos.size || pagosRows.length;

        return {
          name,
          value: acordos,
          acordos,
          pagos,
          conversaoPago: acordos > 0 ? (pagos / acordos) * 100 : 0,
        };
      })
      .sort((a, b) => b.acordos - a.acordos || b.pagos - a.pagos || a.name.localeCompare(b.name));
  }, [filtered.acordos, filtered.baixas, resultGraphs, resultSummaryEnabled]);

  const ticketRows = useMemo(() => {
    if (resultSummaryEnabled && resultGraphs) {
      return resultGraphs.porCredor
        .map((row) => ({ name: row.credor, total: row.recuperado, qtd: row.pagos, ticket: row.ticket }))
        .sort((a, b) => b.total - a.total);
    }

    const groups = groupBy(filtered.baixas, (row) => row.credor || 'OUTROS');
    return Object.entries(groups)
      .map(([name, rows]) => {
        const total = rows.reduce((sum, row) => sum + safe(row.total_pago_portal), 0);
        const processosPagos = new Set(rows.map((row) => row.processo).filter(Boolean));
        const qtd = processosPagos.size || rows.length;
        return { name, total, qtd, ticket: qtd > 0 ? total / qtd : 0 };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered.baixas, resultGraphs, resultSummaryEnabled]);

  const receitaDiaria = useMemo(() => {
    if (resultSummaryEnabled && resultGraphs) {
      return resultGraphs.evolucaoDiaria
        .map((row) => ({ date: row.dia, label: dayLabel(row.dia), businessDay: businessDayMap.get(row.dia) ?? 0, receita: row.recuperado }))
        .filter((row) => row.businessDay > 0)
        .sort((a, b) => a.businessDay - b.businessDay || a.date.localeCompare(b.date));
    }

    const groups = groupBy(filtered.baixas, (row) => row.data);
    return Object.entries(groups)
      .map(([date, rows]) => ({ date, label: dayLabel(date), businessDay: businessDayMap.get(date) ?? 0, receita: rows.reduce((sum, row) => sum + safe(row.total_pago_portal), 0) }))
      .filter((row) => row.businessDay > 0)
      .sort((a, b) => a.businessDay - b.businessDay || a.date.localeCompare(b.date));
  }, [businessDayMap, filtered.baixas, resultGraphs, resultSummaryEnabled]);

  const weeklyRevenueBlocks = useMemo(() => {
    if (isMultiPeriod) return [];

    const weeks = new Map<number, { week: number; label: string; x1: string; x2: string; total: number }>();
    receitaDiaria.forEach((row) => {
      const week = calendarWeekOfMonth(row.date);
      const current = weeks.get(week) ?? { week, label: `S${week}`, x1: row.label, x2: row.label, total: 0 };
      current.x2 = row.label;
      current.total += row.receita;
      weeks.set(week, current);
    });

    let previousTotal: number | null = null;
    return Array.from(weeks.values())
      .sort((a, b) => a.week - b.week)
      .map((row, index) => {
        const currentVariation = variation(row.total, previousTotal);
        previousTotal = row.total;

        return {
          ...row,
          fill: CHART_PALETTE[index % CHART_PALETTE.length],
          variation: currentVariation,
          note: index === 0 ? 'base' : `${variationLabel(currentVariation)} vs S${row.week - 1}`,
        };
      });
  }, [isMultiPeriod, receitaDiaria]);

  const acordosDiarios = useMemo(() => {
    if (resultSummaryEnabled && resultGraphs) {
      return resultGraphs.evolucaoDiaria
        .map((row) => ({ date: row.dia, label: dayLabel(row.dia), acordos: row.acordos, acessos: row.acessos }))
        .sort((a, b) => a.date.localeCompare(b.date));
    }

    const groups = groupBy(filtered.acordos, (row) => row.data);
    return Object.entries(groups)
      .map(([date, rows]) => ({ date, label: dayLabel(date), acordos: rows.length, acessos: 0 }))
      .sort((a, b) => a.date.localeCompare(b.date));
  }, [filtered.acordos, resultGraphs, resultSummaryEnabled]);

  const dailyRevenueComparisonRows = useMemo(() => {
    const rowsByBusinessDay = new Map<number, Record<string, string | number>>();

    filtered.baixas.forEach((row) => {
      const businessDay = businessDayMap.get(row.data);
      if (!businessDay) return;
      const periodKey = monthKey(row.data);
      const series = periodSeries.find((item) => item.period === periodKey);
      if (!series) return;

      const current = rowsByBusinessDay.get(businessDay) ?? { businessDay, label: `${businessDay}º dia útil` };
      current[series.key] = safe(current[series.key] as number) + safe(row.total_pago_portal);
      current[`${series.key}_date`] = dayLabel(row.data);
      rowsByBusinessDay.set(businessDay, current);
    });

    return Array.from(rowsByBusinessDay.values()).sort((a, b) => Number(a.businessDay) - Number(b.businessDay));
  }, [businessDayMap, filtered.baixas, periodSeries]);

  const dailyAgreementComparisonRows = useMemo(() => {
    const rowsByDay = new Map<number, Record<string, string | number>>();

    filtered.acordos.forEach((row) => {
      const periodKey = monthKey(row.data);
      const series = periodSeries.find((item) => item.period === periodKey);
      if (!series) return;

      const day = Number(row.data.slice(8, 10));
      const current = rowsByDay.get(day) ?? { day, label: String(day).padStart(2, '0') };
      current[series.key] = safe(current[series.key] as number) + 1;
      current[`${series.key}_date`] = dayLabel(row.data);
      rowsByDay.set(day, current);
    });

    return Array.from(rowsByDay.values()).sort((a, b) => Number(a.day) - Number(b.day));
  }, [filtered.acordos, periodSeries]);

  const topDays = useMemo(() => {
    if (performanceSummaryEnabled && performanceSummary) {
      return performanceSummary.topDias.map((row) => ({
        date: row.dia,
        label: dayLabel(row.dia),
        acordos: row.acordos,
        recuperado: row.recuperado,
        acessos: row.acessos,
        conversao: row.conversao,
      }));
    }

    const acessosByDay = groupBy(filtered.acessos, (row) => row.data);
    return acordosDiarios
      .map((row) => ({
        ...row,
        conversao: acessosByDay[row.date]?.length ? (row.acordos / acessosByDay[row.date].length) * 100 : 0,
      }))
      .sort((a, b) => b.acordos - a.acordos)
      .slice(0, 5);
  }, [acordosDiarios, filtered.acessos, performanceSummary, performanceSummaryEnabled]);

  const hourlyConversionRows = useMemo(() => {
    if (performanceSummaryEnabled && performanceSummary) {
      return performanceSummary.acordosPorHora.map((row) => ({
        hour: row.hora,
        label: row.label,
        acessos: row.acessos,
        acordos: row.acordos,
        conversao: row.conversao,
      }));
    }

    const hasRealHour = [...filtered.acessos, ...filtered.acordos].some((row) => Number(row.hora) > 0);
    if (!hasRealHour) return [];

    const hours = Array.from({ length: 24 }, (_, hour) => ({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      acessos: 0,
      acordos: 0,
      conversao: 0,
    }));

    filtered.acessos.forEach((row) => {
      const hour = Number(row.hora);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) hours[hour].acessos += 1;
    });

    filtered.acordos.forEach((row) => {
      const hour = Number(row.hora);
      if (Number.isInteger(hour) && hour >= 0 && hour <= 23) hours[hour].acordos += 1;
    });

    return hours
      .map((row) => ({ ...row, conversao: row.acessos > 0 ? (row.acordos / row.acessos) * 100 : 0 }));
  }, [filtered.acessos, filtered.acordos, performanceSummary, performanceSummaryEnabled]);

  const bestHourlyRow = useMemo(
    () => hourlyConversionRows
      .filter((row) => row.acessos > 0 || row.acordos > 0)
      .sort((a, b) => b.conversao - a.conversao || b.acordos - a.acordos || b.acessos - a.acessos)[0] ?? null,
    [hourlyConversionRows]
  );

  const negociadores = useMemo(() => {
    if (performanceSummaryEnabled && performanceSummary) {
      return performanceSummary.porNegociador.map((row) => ({
        name: row.negociador,
        total: row.recuperado,
        qtd: row.acordosPagos,
      }));
    }

    const groups = groupBy(filtered.baixas, (row) => row.negociador || 'Sem negociador');
    return Object.entries(groups)
      .map(([name, rows]) => ({
        name,
        total: rows.reduce((sum, row) => sum + safe(row.total_pago_portal), 0),
        qtd: rows.length,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filtered.baixas, performanceSummary, performanceSummaryEnabled]);

  const fallbackCustos = useMemo<CostsData>(() => {
    const categories = componentRows.map((row) => ({ name: row.name, value: row.value }));
    return {
      periodo: primaryPeriod,
      categories,
      evolution: receitaDiaria.map((row) => ({ mes: row.label, receita: row.receita, acordos: acordosDiarios.find((item) => item.date === row.date)?.acordos ?? 0 })),
      comparativo: {
        atual: metrics.totalPago,
        anterior: 0,
        variacao: 0,
        acordos_atual: metrics.acordos,
        acordos_anterior: 0,
        custo_por_acordo: metrics.acordos > 0 ? metrics.totalPago / metrics.acordos : 0,
      },
    };
  }, [acordosDiarios, componentRows, metrics, primaryPeriod, receitaDiaria]);

  const custosView = custos ?? fallbackCustos;
  const comunicacaoView = comunicacao ?? {
    envios: { emails: 0, whatsapp: 0, custo_whatsapp: 0 },
    por_credor: [],
    mensal: [],
    diario: [],
  };
  const emailClickView = emailClicks ?? {
    total: { cliques: 0, links_unicos: 0, processos: 0, destinatarios: 0 },
    por_credor: [],
    recentes: [],
  };
  const whatsappCampaignData = demoMode ? DEMO_WHATSAPP_CAMPAIGN_DATA : WHATSAPP_CAMPAIGN_DATA;
  const whatsappCampaignPeriods = useMemo(
    () => selectedPeriodList.map((item) => ({ period: item, data: whatsappCampaignData[item] })).filter((item) => Boolean(item.data)),
    [selectedPeriodList, whatsappCampaignData]
  );
  const whatsappCampaignEnabled = whatsappCampaignPeriods.length > 0;
  const whatsappCampaignMatched = whatsappCampaignPeriods.reduce((sum, item) => sum + (item.data?.summary.matched ?? 0), 0);
  const whatsappCampaignRows = useMemo(
    () => {
      if (!whatsappCampaignEnabled || noCreditorSelected) return [];
      const byCredor = new Map<string, WhatsappCampaignCredor>();

      whatsappCampaignPeriods.forEach(({ data: campaign }) => {
        campaign?.rows
          .filter((row: WhatsappCampaignCredor) => selectedCredores.size === 0 || selectedCredores.has(row.credor))
          .forEach((row: WhatsappCampaignCredor) => {
            const current = byCredor.get(row.credor) ?? { credor: row.credor, envios: 0, delivered: 0, read: 0, failed: 0, clicked: 0, custo: 0 };
            current.envios += row.envios;
            current.delivered += row.delivered;
            current.read += row.read;
            current.failed += row.failed;
            current.clicked += row.clicked;
            current.custo += row.custo;
            byCredor.set(row.credor, current);
          });
      });

      return Array.from(byCredor.values());
    },
    [noCreditorSelected, selectedCredores, whatsappCampaignEnabled, whatsappCampaignPeriods]
  );
  const whatsappCampaignDailyRows = useMemo(
    () => whatsappCampaignPeriods.flatMap(({ data: campaign }) => campaign?.daily ?? []).filter((row) => matchesSelectedBusinessDays(row.data)),
    [matchesSelectedBusinessDays, whatsappCampaignPeriods]
  );
  const whatsappCampaignTotals = useMemo(
    () => {
      if (selectedBusinessDayLimit) {
        const envios = whatsappCampaignDailyRows.reduce((sum, row) => sum + row.envios, 0);
        return {
          envios,
          delivered: 0,
          read: 0,
          failed: 0,
          clicked: whatsappCampaignDailyRows.reduce((sum, row) => sum + row.clicked, 0),
          custo: envios * 0.05,
        };
      }

      return whatsappCampaignRows.reduce(
        (acc: { envios: number; delivered: number; read: number; failed: number; clicked: number; custo: number }, row: WhatsappCampaignCredor) => ({
          envios: acc.envios + row.envios,
          delivered: acc.delivered + row.delivered,
          read: acc.read + row.read,
          failed: acc.failed + row.failed,
          clicked: acc.clicked + row.clicked,
          custo: acc.custo + row.custo,
        }),
        { envios: 0, delivered: 0, read: 0, failed: 0, clicked: 0, custo: 0 }
      );
    },
    [selectedBusinessDayLimit, whatsappCampaignDailyRows, whatsappCampaignRows]
  );
  const whatsappPerformanceRows = useMemo(() => {
    const acessosByCredor = groupBy(filtered.acessos.filter((row: Access) => row.credor), (row: Access) => row.credor || 'OUTROS');
    const acordosByCredor = groupBy(filtered.acordos.filter((row: Agreement) => row.credor), (row: Agreement) => row.credor || 'OUTROS');

    return whatsappCampaignRows
      .filter((row: WhatsappCampaignCredor) => row.credor !== 'SEM CREDOR' && row.credor !== 'OUTROS')
      .map((row: WhatsappCampaignCredor) => {
        const acessos = acessosByCredor[row.credor]?.length ?? 0;
        const acordos = acordosByCredor[row.credor]?.length ?? 0;
        return {
          ...row,
          acessos,
          acordos,
          taxaAcesso: row.envios > 0 ? (acessos / row.envios) * 100 : 0,
          taxaAcordo: row.envios > 0 ? (acordos / row.envios) * 100 : 0,
          conversaoAcesso: acessos > 0 ? (acordos / acessos) * 100 : 0,
        };
      })
      .sort((a, b) => b.envios - a.envios)
  }, [filtered.acessos, filtered.acordos, whatsappCampaignRows]);
  const communicationCosts = useMemo(() => {
    const categoryWati = custosView.categories
      .filter((row) => /wati|whats/i.test(row.name))
      .reduce((sum, row) => sum + row.value, 0);
    const watiFallback = comunicacaoView.envios.custo_whatsapp || comunicacaoView.por_credor.reduce((sum, row) => sum + row.custo_wati, 0);
    const watiCost = whatsappCampaignEnabled ? whatsappCampaignTotals.custo : categoryWati || watiFallback;
    const emailCost = FIXED_EMAIL_COST;
    const rows = [
      { name: 'WhatsApp', value: watiCost },
      { name: 'E-mail', value: emailCost },
    ];

    return {
      rows,
      total: rows.reduce((sum, row) => sum + row.value, 0),
      watiCost,
      emailCost,
      byCredor: (() => {
        const byCredor = new Map<string, { credor: string; emails: number; whatsapp: number; custoWati: number; totalEnvios: number }>();
        const upsert = (credor: string, values: { emails?: number; whatsapp?: number; custoWati?: number }) => {
          const name = normalizeCreditorGroup(credor);
          const current = byCredor.get(name) ?? { credor: name, emails: 0, whatsapp: 0, custoWati: 0, totalEnvios: 0 };
          current.emails += values.emails ?? 0;
          current.whatsapp += values.whatsapp ?? 0;
          current.custoWati += values.custoWati ?? 0;
          current.totalEnvios = current.emails + current.whatsapp;
          byCredor.set(name, current);
        };

        comunicacaoView.por_credor.forEach((row) => {
          upsert(row.credor, {
            emails: row.qtde_emails,
            whatsapp: whatsappCampaignEnabled ? 0 : row.mensagens_wati,
            custoWati: whatsappCampaignEnabled ? 0 : row.custo_wati,
          });
        });

        if (whatsappCampaignEnabled) {
          whatsappCampaignRows.forEach((row) => {
            if (row.credor === 'SEM CREDOR' || row.credor === 'OUTROS') return;
            upsert(row.credor, { whatsapp: row.envios, custoWati: row.custo });
          });
        }

        return Array.from(byCredor.values())
          .filter((row) => row.emails > 0 || row.whatsapp > 0)
          .sort((a, b) => b.totalEnvios - a.totalEnvios || b.whatsapp - a.whatsapp || b.emails - a.emails);
      })(),
    };
  }, [comunicacaoView, custosView.categories, whatsappCampaignEnabled, whatsappCampaignRows, whatsappCampaignTotals.custo]);
  const communicationDailyRows = useMemo(
    () => (comunicacaoView.diario ?? []).filter((row) => matchesSelectedBusinessDays(row.data)),
    [comunicacaoView.diario, matchesSelectedBusinessDays]
  );
  const whatsappDailyComparisonRows = useMemo(() => {
    const rowsByBusinessDay = new Map<number, Record<string, string | number>>();

    whatsappCampaignDailyRows.forEach((row) => {
      const businessDay = businessDayMap.get(row.data);
      if (!businessDay) return;
      const series = periodSeries.find((item) => item.period === monthKey(row.data));
      if (!series) return;

      const current = rowsByBusinessDay.get(businessDay) ?? { businessDay, label: `${businessDay}º dia útil` };
      current[series.key] = safe(current[series.key] as number) + row.envios;
      current[`${series.key}_clicked`] = safe(current[`${series.key}_clicked`] as number) + row.clicked;
      current[`${series.key}_date`] = dayLabel(row.data);
      rowsByBusinessDay.set(businessDay, current);
    });

    return Array.from(rowsByBusinessDay.values()).sort((a, b) => Number(a.businessDay) - Number(b.businessDay));
  }, [businessDayMap, periodSeries, whatsappCampaignDailyRows]);
  const hasCommunicationDailyData = (comunicacaoView.diario ?? []).length > 0;
  const emailEnvios = hasCommunicationDailyData
    ? communicationDailyRows.reduce((sum, row) => sum + row.qtde_emails, 0)
    : comunicacaoView.envios.emails;
  const storedWhatsappEnvios = hasCommunicationDailyData
    ? communicationDailyRows.reduce((sum, row) => sum + row.mensagens_wati, 0)
    : comunicacaoView.envios.whatsapp;
  const performanceFunil = performanceSummaryEnabled && performanceSummary ? performanceSummary.funil : null;
  const acessosPortal = performanceFunil?.acessos ?? metrics.acessos;
  const acordosPortal = performanceFunil?.acordos ?? metrics.acordos;
  const conversaoPortal = performanceFunil?.conversaoAcesso ?? metrics.conversao;
  const previousPerformanceMetrics = performanceSummaryEnabled && performanceSummary ? performanceSummary.anterior : previousMetrics;
  const cliquesPortal = whatsappCampaignEnabled ? whatsappCampaignTotals.clicked : acessosPortal;
  const whatsappEnvios = whatsappCampaignEnabled ? whatsappCampaignTotals.envios : storedWhatsappEnvios;
  const whatsappCusto = whatsappCampaignEnabled ? whatsappCampaignTotals.custo : storedWhatsappEnvios * 0.05;
  const totalEnviosCanal = emailEnvios + whatsappEnvios;
  const emailClickTotal = emailClickView.total.cliques;
  const totalCliquesLink = cliquesPortal + emailClickTotal;
  const emailClickRows = emailClickView.por_credor
    .filter((row) => row.credor !== 'SEM CREDOR' && row.credor !== 'OUTROS')
    .sort((a, b) => b.cliques - a.cliques || b.links_unicos - a.links_unicos || a.credor.localeCompare(b.credor));
  const clickCredorRows = useMemo(() => {
    const byCredor = new Map<string, {
      credor: string;
      whatsapp: number;
      email: number;
      acessos: number;
      acordos: number;
      campanhas: number;
      templates: number;
      ultimoClique: string | null;
    }>();
    const acessosByCredor = groupBy(filtered.acessos.filter((row) => row.credor), (row) => row.credor || 'OUTROS');
    const acordosByCredor = groupBy(filtered.acordos.filter((row) => row.credor), (row) => row.credor || 'OUTROS');
    const touch = (credor: string) => {
      const current = byCredor.get(credor) ?? {
        credor,
        whatsapp: 0,
        email: 0,
        acessos: acessosByCredor[credor]?.length ?? 0,
        acordos: acordosByCredor[credor]?.length ?? 0,
        campanhas: 0,
        templates: 0,
        ultimoClique: null,
      };
      byCredor.set(credor, current);
      return current;
    };
    const newerDate = (current: string | null, next: string | null) => {
      if (!next) return current;
      if (!current) return next;
      return next > current ? next : current;
    };

    emailClickRows.forEach((row) => {
      const current = touch(row.credor);
      current.email += row.cliques;
      current.campanhas += row.campanhas;
      current.templates += row.templates;
      current.ultimoClique = newerDate(current.ultimoClique, row.ultimo_clique);
    });

    whatsappPerformanceRows.forEach((row) => {
      const current = touch(row.credor);
      current.whatsapp += row.clicked;
      current.acessos = Math.max(current.acessos, row.acessos);
      current.acordos = Math.max(current.acordos, row.acordos);
    });

    return Array.from(byCredor.values())
      .map((row) => ({
        ...row,
        total: row.whatsapp + row.email,
        conversao: row.acessos > 0 ? (row.acordos / row.acessos) * 100 : 0,
      }))
      .filter((row) => row.total > 0 || row.acessos > 0 || row.acordos > 0)
      .sort((a, b) => b.total - a.total || b.acordos - a.acordos || a.credor.localeCompare(b.credor));
  }, [emailClickRows, filtered.acessos, filtered.acordos, whatsappPerformanceRows]);
  const recentClickRows = useMemo(
    () => emailClickView.recentes
      .map((row, index) => ({
        id: `${row.token ?? 'token'}-${row.data_clique ?? index}`,
        canal: row.canal || 'E-mail',
        data: row.data_clique,
        credor: row.credor,
        processo: row.processo,
        destinatario: row.destinatario || row.email_destinatario || row.telefone || '-',
        campanha: row.campanha || row.template || '-',
      }))
      .sort((a, b) => (b.data ?? '').localeCompare(a.data ?? '')),
    [emailClickView.recentes]
  );
  const funnelRows = [
    { name: 'Envio -> clique no link', value: totalEnviosCanal > 0 ? (totalCliquesLink / totalEnviosCanal) * 100 : 0 },
    { name: 'Clique -> acesso', value: totalCliquesLink > 0 ? (acessosPortal / totalCliquesLink) * 100 : 0 },
    { name: 'Acesso -> acordo', value: acessosPortal > 0 ? (acordosPortal / acessosPortal) * 100 : 0 },
    { name: 'Envio -> acordo', value: totalEnviosCanal > 0 ? (acordosPortal / totalEnviosCanal) * 100 : 0 },
  ];
  const accessFunnelAccesses = performanceFunil?.acessos ?? metrics.acessos;
  const accessFunnelRows = [
    { name: 'Acessos', value: number(accessFunnelAccesses), fill: 100 },
    { name: 'Acessos com acordo', value: number(performanceFunil?.acessosComAcordo ?? metrics.acessosComAcordo), fill: accessFunnelAccesses > 0 ? ((performanceFunil?.acessosComAcordo ?? metrics.acessosComAcordo) / accessFunnelAccesses) * 100 : 0 },
    { name: 'Acordos', value: number(performanceFunil?.acordos ?? metrics.acordos), fill: accessFunnelAccesses > 0 ? ((performanceFunil?.acordos ?? metrics.acordos) / accessFunnelAccesses) * 100 : 0 },
    { name: 'Conversão', value: `${(performanceFunil?.conversaoAcesso ?? metrics.conversao).toFixed(1)}%`, fill: performanceFunil?.conversaoAcesso ?? metrics.conversao },
  ];
  const channelCostRows = useMemo(() => {
    const emailCost = communicationCosts.emailCost;
    const whatsappCost = whatsappCusto;
    return [
      { canal: 'E-mail', envios: emailEnvios, custo: emailCost },
      { canal: 'WhatsApp', envios: whatsappEnvios, custo: whatsappCost },
    ].map((row) => ({
      ...row,
      custoPorAcesso: acessosPortal > 0 ? row.custo / acessosPortal : 0,
      custoPorAcordo: acordosPortal > 0 ? row.custo / acordosPortal : 0,
      custoPorEnvio: row.envios > 0 ? row.custo / row.envios : 0,
    }));
  }, [acessosPortal, acordosPortal, communicationCosts.emailCost, emailEnvios, whatsappCusto, whatsappEnvios]);
  const monthlyEvolution = useMemo(() => {
    const byMonth = new Map<string, {
      mes: string;
      envios: number;
      emails: number;
      whatsapp: number;
      cliques: number;
      acessos: number;
      acordos: number;
      conversao: number;
    }>();

    comunicacaoView.mensal.forEach((row) => {
      byMonth.set(row.mes, {
        mes: row.mes,
        envios: row.qtde_emails + row.mensagens_wati,
        emails: row.qtde_emails,
        whatsapp: row.mensagens_wati,
        cliques: 0,
        acessos: 0,
        acordos: 0,
        conversao: 0,
      });
    });

    if (performanceSummaryEnabled && performanceSummary) {
      performanceSummary.evolucaoMensal.forEach((row) => {
        const key = row.mes;
        const current = byMonth.get(key) ?? { mes: key, envios: 0, emails: 0, whatsapp: 0, cliques: 0, acessos: 0, acordos: 0, conversao: 0 };
        current.cliques += row.acessos;
        current.acessos += row.acessos;
        current.acordos += row.acordos;
        byMonth.set(key, current);
      });
    } else {
      data.acessos
        .filter((row) => matchesSystem(row, system))
        .forEach((row) => {
          const key = monthKey(row.data);
          const current = byMonth.get(key) ?? { mes: key, envios: 0, emails: 0, whatsapp: 0, cliques: 0, acessos: 0, acordos: 0, conversao: 0 };
          current.cliques += 1;
          current.acessos += 1;
          byMonth.set(key, current);
        });

      data.acordos
        .filter((row) => matchesSystem(row, system))
        .forEach((row) => {
          const key = monthKey(row.data);
          const current = byMonth.get(key) ?? { mes: key, envios: 0, emails: 0, whatsapp: 0, cliques: 0, acessos: 0, acordos: 0, conversao: 0 };
          current.acordos += 1;
          byMonth.set(key, current);
        });
    }

    if (whatsappCampaignEnabled) {
      const current = byMonth.get(primaryPeriod) ?? {
        mes: primaryPeriod,
        envios: 0,
        emails: 0,
        whatsapp: 0,
        cliques: 0,
        acessos: 0,
        acordos: 0,
        conversao: 0,
      };
      current.emails = comunicacaoView.envios.emails;
      current.envios = comunicacaoView.envios.emails + whatsappCampaignTotals.envios;
      current.whatsapp = whatsappCampaignTotals.envios;
      current.cliques = whatsappCampaignTotals.clicked;
      byMonth.set(primaryPeriod, current);
    }

    return Array.from(byMonth.values())
      .map((row) => ({ ...row, label: periodLabel(row.mes), conversao: row.acessos > 0 ? (row.acordos / row.acessos) * 100 : 0 }))
      .sort((a, b) => a.mes.localeCompare(b.mes));
  }, [comunicacaoView.envios.emails, comunicacaoView.mensal, data.acessos, data.acordos, performanceSummary, performanceSummaryEnabled, primaryPeriod, system, whatsappCampaignEnabled, whatsappCampaignTotals.clicked, whatsappCampaignTotals.envios]);
  const selectedLabel = noCreditorSelected ? 'Nenhum' : selectedCredores.size === 0 || selectedCredores.size === allCredores.length ? 'Todos' : `${selectedCredores.size}/${allCredores.length}`;
  const selectedPeriodLabel = selectedPeriodList.length === 1 ? periodLabel(primaryPeriod) : `${selectedPeriodList.length} meses`;
  const selectedPeriodTitle = selectedPeriodList.length === 1 ? periodLabel(primaryPeriod, true) : `${selectedPeriodList.length} meses selecionados`;
  const selectedPeriodRange = selectedPeriodList.length === 1 ? periodRangeLabel(primaryPeriod) : `${periodLabel([...selectedPeriodList].sort()[0] ?? primaryPeriod)} a ${periodLabel(selectedPeriodList[0] ?? primaryPeriod)}`;
  const visiblePeriodList = useMemo(() => Array.from(visiblePeriods).sort().reverse(), [visiblePeriods]);
  const visiblePrimaryPeriod = visiblePeriodList[0] ?? primaryPeriod;
  const visiblePeriodLabel = dateFilterIgnored ? 'Não aplicado' : visiblePeriodList.length === 1 ? periodLabel(visiblePrimaryPeriod) : `${visiblePeriodList.length} meses`;
  const portfolioPeriodTitle = portfolioPeriodList.length === 1 ? periodLabel(primaryPortfolioPeriod, true) : `${portfolioPeriodList.length} meses selecionados`;
  const portfolioPeriodRange = portfolioPeriodList.length === 1 ? periodRangeLabel(primaryPortfolioPeriod) : `${periodLabel([...portfolioPeriodList].sort()[0] ?? primaryPortfolioPeriod)} a ${periodLabel(primaryPortfolioPeriod)}`;
  const baseProcessCredorRows = useMemo(
    () => baseSummary.processos_por_credor.map((row) => ({ name: row.credor, value: row.processos })),
    [baseSummary.processos_por_credor]
  );
  const baseVisibleAgingRows = useMemo(
    () => baseSummary.aging.filter((row) => row.faixa !== 'SEM VENCIMENTO'),
    [baseSummary.aging]
  );
  const baseAgingProcessRows = useMemo(
    () => baseVisibleAgingRows.map((row) => ({ name: row.name || AGING_LABELS[row.faixa] || row.faixa, value: row.processos })),
    [baseVisibleAgingRows]
  );
  const baseStatusLabel =
    baseSummary.aging_complete || baseSummary.status === 'ready'
      ? 'Cache atualizado'
      : baseSummary.status === 'refreshing'
        ? 'Cache atualizando'
        : baseSummary.status === 'partial'
          ? 'Vencimentos pendentes'
          : baseSummary.status === 'error'
            ? 'Falha ao atualizar'
          : 'Cache ainda não gerado';
  const filteredPortfolioData = useMemo(
    () => portfolioData.filter((row) => matchesSelectedBusinessDays(row.data, portfolioPeriods)),
    [matchesSelectedBusinessDays, portfolioData, portfolioPeriods]
  );
  const portfolioDailyComparisonRows = useMemo(() => {
    const rowsByBusinessDay = new Map<number, Record<string, string | number>>();

    filteredPortfolioData.forEach((row) => {
      const businessDay = businessDayMap.get(row.data);
      if (!businessDay) return;
      const series = periodSeries.find((item) => item.period === row.mes);
      if (!series) return;

      const current = rowsByBusinessDay.get(businessDay) ?? { businessDay, label: `${businessDay}º dia útil` };
      current[series.key] = safe(current[series.key] as number) + safe(row.valor_imp);
      current[`${series.key}_processos`] = safe(current[`${series.key}_processos`] as number) + safe(row.qtdeproc);
      current[`${series.key}_date`] = dayLabel(row.data);
      rowsByBusinessDay.set(businessDay, current);
    });

    return Array.from(rowsByBusinessDay.values()).sort((a, b) => Number(a.businessDay) - Number(b.businessDay));
  }, [businessDayMap, filteredPortfolioData, periodSeries]);
  const portfolioView = useMemo(() => {
    const recoveredByCreditor = groupBy(portfolioFiltered.baixas, (row) => row.credor || 'OUTROS');
    const agreementsByCreditor = groupBy(portfolioFiltered.acordos, (row) => row.credor || 'OUTROS');
    const byCreditor = Object.entries(groupBy(filteredPortfolioData, (row: PortfolioEntry) => row.credor))
      .map(([credor, rows]) => {
        const valorEntrada = rows.reduce((sum, row) => sum + safe(row.valor_imp), 0);
        const recuperado = (recoveredByCreditor[credor] ?? []).reduce((sum, row) => sum + safe(row.total_pago_portal), 0);
        const processos = rows.reduce((sum, row) => sum + safe(row.qtdeproc), 0);
        const titulos = rows.reduce((sum, row) => sum + safe(row.qtdetit), 0);
        const importados = rows.reduce((sum, row) => sum + safe(row.qtdeimp), 0);
        const duplicados = rows.reduce((sum, row) => sum + safe(row.qtdedup), 0);
        const acordos = (agreementsByCreditor[credor] ?? []).length;
        return {
          credor,
          borderos: rows.length,
          valorEntrada,
          recuperado,
          processos,
          titulos,
          importados,
          duplicados,
          acordos,
          percentualRecuperado: valorEntrada > 0 ? (recuperado / valorEntrada) * 100 : 0,
          conversaoCarteira: processos > 0 ? (acordos / processos) * 100 : 0,
        };
      })
      .sort((a, b) => b.valorEntrada - a.valorEntrada);

    const monthly = Object.entries(groupBy(filteredPortfolioData, (row: PortfolioEntry) => row.mes))
      .map(([mes, rows]) => ({
        mes,
        label: periodLabel(mes),
        valorEntrada: rows.reduce((sum, row) => sum + safe(row.valor_imp), 0),
        processos: rows.reduce((sum, row) => sum + safe(row.qtdeproc), 0),
        borderos: rows.length,
      }))
      .sort((a, b) => a.mes.localeCompare(b.mes));

    return {
      byCreditor,
      monthly,
      totalValorEntrada: byCreditor.reduce((sum, row) => sum + row.valorEntrada, 0),
      totalRecuperado: byCreditor.reduce((sum, row) => sum + row.recuperado, 0),
      totalProcessos: byCreditor.reduce((sum, row) => sum + row.processos, 0),
      totalTitulos: byCreditor.reduce((sum, row) => sum + row.titulos, 0),
      totalBorderos: byCreditor.reduce((sum, row) => sum + row.borderos, 0),
      totalAcordos: byCreditor.reduce((sum, row) => sum + row.acordos, 0),
    };
  }, [filteredPortfolioData, portfolioFiltered.acordos, portfolioFiltered.baixas]);
  const baseTotalProcessos = baseSummary.total_processos;
  const baseValorTotal = baseSummary.valor_total_carteira;
  const baseCredoresAtivos = baseSummary.total_credores;
  const baseTicketMedio = baseSummary.ticket_medio;
  const baseTotalBorderos = baseSummary.total_borderos;
  const baseEntryCreditorRows = baseSummary.entrada_por_credor;
  const baseRangeRows = baseVisibleAgingRows;
  const baseRangeTotal = useMemo(
    () => baseRangeRows.reduce((sum, row) => sum + row.valorCarteira, 0),
    [baseRangeRows]
  );
  const baseRangeChartRows = useMemo(
    () => baseRangeRows.map((row) => ({
      ...row,
      participacao: baseRangeTotal > 0 ? (row.valorCarteira / baseRangeTotal) * 100 : 0,
    })),
    [baseRangeRows, baseRangeTotal]
  );

  function toggleCredor(credor: string) {
    setSelectedCredores((current) => {
      const next = new Set(current.has(NO_CREDITOR_SELECTION) ? [] : current.size === 0 ? allCredores : current);
      if (next.has(credor)) next.delete(credor);
      else next.add(credor);
      if (next.size === allCredores.length) return new Set();
      if (next.size === 0) return new Set([NO_CREDITOR_SELECTION]);
      return next;
    });
  }

  function togglePeriodFilter(item: string) {
    setSelectedPeriods((current) => {
      const next = new Set(current.size > 0 ? current : period ? [period] : []);
      if (next.has(item)) next.delete(item);
      else next.add(item);
      if (next.size === 0 && period) next.add(period);
      setPeriod(item);
      return next;
    });
  }

  if (adminToken) {
    return (
      <div className="dashboard-shell theme-night">
        <header className="hero admin-hero">
          <div className="hero-top">
            <div>
              <div className="logos">
                <img src={logoUrl} alt="Portal do Acordo" />
              </div>
              <p>Admin</p>
              <h1><span>Pessoas ativas</span></h1>
            </div>
            <div className="hero-meta">
              <strong>{number(activeUsers?.total_active ?? 0)} online</strong>
              <span>Janela de {activeUsers ? formatDuration(activeUsers.active_window_seconds) : '2min'}</span>
              <span>Atualiza a cada 15s</span>
              <em>{dateTime(activeUsers?.generated_at)}</em>
            </div>
          </div>
          <div className="kpi-row">
            <MetricCard tone="teal" label="Online agora" value={number(activeUsers?.total_active ?? 0)} current={activeUsers?.total_active ?? 0} small="Sessões ativas" summary="Sessões com sinal nos últimos minutos." />
            <MetricCard tone="gold" label="Abas" value={number(activeUsers?.by_tab.length ?? 0)} current={activeUsers?.by_tab.length ?? 0} small="Seções abertas" summary="Quantidade de abas/seções em uso agora." />
            <MetricCard tone="sky" label="Dispositivo" value={activeUsers?.by_device[0]?.name ?? '-'} current={activeUsers?.by_device[0]?.value ?? 0} small={activeUsers?.by_device[0] ? `${number(activeUsers.by_device[0].value)} sessão(ões)` : 'Sem dados'} summary="Dispositivo mais frequente neste momento." />
            <MetricCard tone="rust" label="Navegador" value={activeUsers?.by_browser[0]?.name ?? '-'} current={activeUsers?.by_browser[0]?.value ?? 0} small={activeUsers?.by_browser[0] ? `${number(activeUsers.by_browser[0].value)} sessão(ões)` : 'Sem dados'} summary="Navegador mais frequente neste momento." />
          </div>
        </header>

        <main className="main-content admin-content">
          {activeUsersError ? <div className="error-state" role="alert">{activeUsersError}</div> : null}
          {!activeUsers && !activeUsersError ? <div className="loading-state">Carregando pessoas ativas...</div> : null}
          {activeUsers ? (
            <>
              <Section num="01" title="Resumo Agora">
                <div className="grid-3">
                  <Panel title="Por Aba">
                    <BarRows rows={activeUsers.by_tab} color={color} valueLabel="Sessões" />
                  </Panel>
                  <Panel title="Por Dispositivo">
                    <BarRows rows={activeUsers.by_device} color={COLORS.gold} valueLabel="Sessões" />
                  </Panel>
                  <Panel title="Por Navegador">
                    <BarRows rows={activeUsers.by_browser} color={COLORS.sky} valueLabel="Sessões" />
                  </Panel>
                </div>
              </Section>

              <Section num="02" title="Sessões Ativas">
                <Panel title="Detalhes anônimos" meta={`${number(activeUsers.sessions.length)} sessão(ões)`}>
                  <table>
                    <thead>
                      <tr><th>Último sinal</th><th>Aba</th><th>Sistema</th><th>Período</th><th>Tempo online</th><th>Dispositivo</th><th>Navegador</th><th>Janela</th><th>Timezone</th><th>IP hash</th></tr>
                    </thead>
                    <tbody>
                      {activeUsers.sessions.length === 0 ? <tr><td colSpan={10} className="muted">Ninguém ativo agora.</td></tr> : null}
                      {activeUsers.sessions.map((session) => (
                        <tr key={session.session_id}>
                          <td className="bold">{dateTime(session.last_seen)}</td>
                          <td>{TAB_LABELS[session.tab as DashboardTab] ?? session.tab}</td>
                          <td>{session.system || '-'}</td>
                          <td>{session.period || '-'}</td>
                          <td>{formatDuration(session.seconds_online)}</td>
                          <td>{session.device} / {session.os}</td>
                          <td>{session.browser}</td>
                          <td>{viewportLabel(session.viewport)}</td>
                          <td>{session.timezone || '-'}</td>
                          <td className="muted">{session.ip_hash}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              </Section>
            </>
          ) : null}
        </main>
      </div>
    );
  }

  return (
    <div className={`dashboard-shell theme-night ${presentationMode ? 'presentation-mode' : ''}`}>
      {tvMode ? (
        <div className="tv-mode">
          <div className="tv-frame">
            <header className="tv-toolbar">
              <div className="tv-brand">
                <img src={logoUrl} alt="Portal do Acordo" />
                <div>
                  <strong>Resultados</strong>
                  <small>{selectedPeriodLabel} · {systemLabel(system)}</small>
                </div>
              </div>
              <div className="tv-clock">
                <strong>{tvTime.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</strong>
                <span>{tvTime.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'long' })}</span>
              </div>
            </header>

            <main className="tv-report">
              {loading && rawDashboardEnabled ? <div className="loading-state" role="status">Carregando dados do portal...</div> : null}
              {error && rawDashboardEnabled ? <div className="error-state" role="alert">{error}</div> : null}

              {!loading && !error && tab === 'relatorio' ? (
                <>
                  <header className="hero tv-hero">
                    <div className="hero-top">
                      <div>
                        <p>Resultados</p>
                        <h1><span>{portfolioPeriodTitle}</span></h1>
                      </div>
                      <div className="hero-meta">
                        <strong>{portfolioPeriodList.length === 1 ? periodLabel(primaryPortfolioPeriod) : `${portfolioPeriodList.length} meses`}</strong>
                        <span>{portfolioPeriodRange}</span>
                        <span>{number(businessDays)} dias úteis</span>
                        <em>{systemLabel(system)}</em>
                      </div>
                    </div>
                    <div className="kpi-row">
                      <MetricCard tone="teal" label="Total Recuperado" value={compactMoney(resultMetrics.totalPago)} current={resultMetrics.totalPago} previous={resultPreviousMetrics?.totalPago} small="Pagamentos no período" />
                      <MetricCard tone="gold" label="Faturamento" value={compactMoney(resultMetrics.faturamento)} current={resultMetrics.faturamento} previous={resultPreviousMetrics?.faturamento} small="Receitas sem capital" />
                      <MetricCard tone="rust" label="Acordos Pagos" value={number(resultMetrics.acordosPagos)} current={resultMetrics.acordosPagos} previous={resultPreviousMetrics?.acordosPagos} small="Processos com pagamento" />
                      <MetricCard tone="sky" label="Conversão" value={`${resultMetrics.conversao.toFixed(1)}%`} current={resultMetrics.conversao} previous={resultPreviousMetrics?.conversao} small={systemLabel(system)} />
                      <MetricCard tone="teal" label="Acessos" value={number(resultMetrics.acessos)} current={resultMetrics.acessos} previous={resultPreviousMetrics?.acessos} small="Visitantes únicos" />
                    </div>
                  </header>

                  <Section num="01" title="Evolução e Volume">
                    <div className="grid-2">
                      <Panel title="Receita diária" expandable={false}>
                        <div className="chart-wrap small">
                          <ResponsiveContainer>
                            <LineChart data={isMultiPeriod ? dailyRevenueComparisonRows : receitaDiaria}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              {!isMultiPeriod ? weeklyRevenueBlocks.map((row) => (
                                <ReferenceArea
                                  key={row.label}
                                  x1={row.x1}
                                  x2={row.x2}
                                  fill={row.fill}
                                  fillOpacity={0.08}
                                  stroke={row.fill}
                                  strokeOpacity={0.18}
                                  label={{ value: `${row.label} ${row.note}`, position: 'insideTop', fill: row.fill, fontSize: 10, fontWeight: 700 }}
                                />
                              )) : null}
                              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                              <YAxis tickFormatter={(value) => `R$${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(value: number, name: string, item) => [money(value), isMultiPeriod ? comparisonTooltipName(name, item) : name]} />
                              <Legend verticalAlign="top" height={28} />
                              {isMultiPeriod ? periodSeries.map((item) => (
                                <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              )) : (
                                <Line type="monotone" dataKey="receita" name="Receita diária" stroke={chartAccent} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              )}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      </Panel>
                      <Panel title="Acordos e acessos" expandable={false}>
                        <div className="chart-wrap small">
                          <ResponsiveContainer>
                            <ComposedChart data={acordosDiarios}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                              <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 10 }} />
                              <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(value: number, name: string) => name === 'Acessos' ? [`${value} acessos`, name] : [`${value} acordos`, name]} />
                              <Legend verticalAlign="top" height={28} />
                              <Bar yAxisId="left" dataKey="acordos" name="Acordos por dia" fill={chartAccent} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              <Line yAxisId="right" type="monotone" dataKey="acessos" name="Acessos" stroke="#8884d8" strokeWidth={2} dot={false} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </Panel>
                    </div>
                  </Section>

                  <Section num="02" title="Top Negociadores">
                    <Panel title="Pagamentos por negociador" expandable={false}>
                      <BarRows rows={negociadores.slice(0, 6).map((row) => ({ name: row.name, value: row.total }))} color={color} valueFormatter={money} valueLabel="Recuperado" />
                    </Panel>
                  </Section>
                </>
              ) : null}

              {!loading && !error && tab === 'performance' ? (
                <>
                  <header className="hero tv-hero">
                    <div className="hero-top">
                      <div>
                        <p>Performance</p>
                        <h1><span>{selectedPeriodTitle}</span></h1>
                      </div>
                      <div className="hero-meta">
                        <strong>{selectedPeriodLabel}</strong>
                        <span>{selectedPeriodRange}</span>
                        <span>{number(businessDays)} dias úteis</span>
                        <em>{systemLabel(system)}</em>
                      </div>
                    </div>
                    <div className="kpi-row">
                      <MetricCard tone="teal" label="Envios" value={number(totalEnviosCanal)} current={totalEnviosCanal} small={`${number(emailEnvios)} e-mails - ${number(whatsappEnvios)} WhatsApp`} />
                      <MetricCard tone="gold" label="Cliques no Link" value={number(totalCliquesLink)} current={totalCliquesLink} small={`${number(cliquesPortal)} WhatsApp - ${number(emailClickTotal)} e-mail`} />
                      <MetricCard tone="sky" label="Acessos" value={number(acessosPortal)} current={acessosPortal} previous={previousPerformanceMetrics?.acessos} small="Acessos no site" />
                      <MetricCard tone="teal" label="Acordos" value={number(acordosPortal)} current={acordosPortal} previous={previousPerformanceMetrics?.acordos} small="Formalizados" />
                      <MetricCard tone="rust" label="Conversão" value={`${conversaoPortal.toFixed(1)}%`} current={conversaoPortal} previous={previousPerformanceMetrics?.conversao} small={`${number(acordosPortal)} acordos`} />
                    </div>
                  </header>

                  <Section num="01" title="Acessos e Conversão">
                    <div className="grid-2">
                      <Panel title="Funil do Canal" expandable={false}>
                        <div className="funnel-grid">
                          {funnelRows.map((row, index) => (
                            <div className="funnel-card" key={row.name}>
                              <span>{row.name}</span>
                              <strong>{row.value}</strong>
                              <em style={{ width: `${Math.max(Math.min(row.fill, 100), 8)}%`, background: CHART_PALETTE[index % CHART_PALETTE.length] }} />
                            </div>
                          ))}
                        </div>
                      </Panel>
                      <Panel title="WhatsApp e E-mail por Credor" meta={`${number(totalCliquesLink)} cliques`} expandable={false}>
                        <table>
                          <thead>
                            <tr><th>Credor / Grupo</th><th className="right">WhatsApp</th><th className="right">E-mail</th><th className="right">Total</th><th className="right">Conversão</th></tr>
                          </thead>
                          <tbody>
                            {clickCredorRows.length === 0 ? <tr><td colSpan={5} className="muted">Sem cliques no período.</td></tr> : null}
                            {clickCredorRows.slice(0, 6).map((row) => (
                              <tr key={row.credor}>
                                <td className="bold">{row.credor}</td>
                                <td className="right">{number(row.whatsapp)}</td>
                                <td className="right">{number(row.email)}</td>
                                <td className="right bold">{number(row.total)}</td>
                                <td className="right">{row.conversao.toFixed(1)}%</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Panel>
                    </div>
                  </Section>

                  <Section num="02" title="Evolução Mensal">
                    <div className="grid-2">
                      <Panel title="Envios por canal" expandable={false}>
                        <div className="chart-wrap small">
                          <ResponsiveContainer>
                            <ComposedChart data={monthlyEvolution}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(value: number, name: string) => [number(value), name]} />
                              <Legend verticalAlign="top" height={28} />
                              <Bar dataKey="emails" name="E-mails" fill={COLORS.sky} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              <Bar dataKey="whatsapp" name="WhatsApp" fill={COLORS.green} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              <Line type="monotone" dataKey="envios" name="Total de envios" stroke={COLORS.gold} strokeWidth={2.5} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </Panel>
                      <Panel title="Acessos, acordos e conversão" expandable={false}>
                        <div className="chart-wrap small">
                          <ResponsiveContainer>
                            <ComposedChart data={monthlyEvolution}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                              <YAxis yAxisId="volume" allowDecimals={false} tick={{ fontSize: 10 }} />
                              <YAxis yAxisId="rate" orientation="right" tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(value: number, name: string) => [name === 'Conversão acesso -> acordo' ? `${value.toFixed(1)}%` : number(value), name]} />
                              <Legend verticalAlign="top" height={28} />
                              <Bar yAxisId="volume" dataKey="acessos" name="Acessos" fill={COLORS.sky} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              <Bar yAxisId="volume" dataKey="acordos" name="Acordos" fill={COLORS.rust} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              <Line yAxisId="rate" type="monotone" dataKey="conversao" name="Conversão acesso -> acordo" stroke={COLORS.green} strokeWidth={2.5} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                            </ComposedChart>
                          </ResponsiveContainer>
                        </div>
                      </Panel>
                    </div>
                  </Section>
                </>
              ) : null}

              {tab === 'base-ativa' ? (
                <>
                  <header className="hero tv-hero">
                    <div className="hero-top">
                      <div>
                        <p>Bases</p>
                        <h1><span>{selectedPeriodTitle}</span></h1>
                      </div>
                      <div className="hero-meta">
                        <strong>{selectedPeriodLabel}</strong>
                        <span>{noCreditorSelected ? 'Nenhum credor selecionado' : selectedCredores.size === 0 ? 'Todos os credores' : `${number(selectedCredores.size)} credores selecionados`}</span>
                        <em>{systemLabel(system)}</em>
                      </div>
                    </div>
                    <div className="kpi-row">
                      <MetricCard tone="teal" label="Total de Processos" value={number(baseTotalProcessos)} current={baseTotalProcessos} small="Processos na base" />
                      <MetricCard tone="gold" label="Valor Total da Carteira" value={compactMoney(baseValorTotal)} current={baseValorTotal} small={`${number(baseTotalBorderos)} borderôs`} />
                      <MetricCard tone="sky" label="Credores Ativos" value={number(baseCredoresAtivos)} current={baseCredoresAtivos} small={baseStatusLabel} />
                      <MetricCard tone="rust" label="Ticket Médio" value={money(baseTicketMedio)} current={baseTicketMedio} small="Valor por processo" />
                    </div>
                  </header>

                  <Section num="01" title="Base por Credor e Faixa">
                    <div className="grid-2">
                      <Panel title="Processos por Credor" meta={`Top ${Math.min(baseProcessCredorRows.length, 6)}`} expandable={false}>
                        <BarRows rows={baseProcessCredorRows.slice(0, 6)} color={color} valueLabel="Processos" />
                      </Panel>
                      <Panel title="Valor Total por Faixa" meta="Títulos abertos da base ativa" expandable={false}>
                        <div className="range-value-summary">
                          <span>Carteira ativa</span>
                          <strong>{compactMoney(baseRangeTotal)}</strong>
                          <small>Distribuição por menor vencimento dos processos ativos</small>
                        </div>
                        <div className="chart-wrap range-value-chart">
                          <ResponsiveContainer>
                            <BarChart data={baseRangeChartRows} layout="vertical" margin={{ top: 8, right: 88, bottom: 4, left: 10 }}>
                              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                              <XAxis type="number" tickFormatter={(value) => shortMoney(Number(value))} tick={{ fontSize: 10 }} />
                              <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fontWeight: 700 }} />
                              <Tooltip formatter={(value: number, name: string) => name === 'Valor total' ? [money(value), name] : [value, name]} labelFormatter={(label) => `Faixa: ${label}`} />
                              <Bar dataKey="valorCarteira" name="Valor total" radius={[0, 6, 6, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE}>
                                {baseRangeChartRows.map((row, index) => <Cell key={row.faixa} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />)}
                                <LabelList dataKey="valorCarteira" position="right" formatter={(value: number) => shortMoney(value)} className="range-value-label" />
                              </Bar>
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      </Panel>
                    </div>
                  </Section>
                </>
              ) : null}

              {tab === 'custos' ? (
                <>
                  <header className="hero tv-hero">
                    <div className="hero-top">
                      <div>
                        <p>Custos</p>
                        <h1><span>{selectedPeriodTitle}</span></h1>
                      </div>
                      <div className="hero-meta">
                        <strong>{selectedPeriodLabel}</strong>
                        <span>{selectedPeriodRange}</span>
                        <span>{number(businessDays)} dias úteis</span>
                        <em>{systemLabel(system)}</em>
                      </div>
                    </div>
                    <div className="kpi-row">
                      <MetricCard tone="teal" label="Total comunicação" value={money(communicationCosts.emailCost + whatsappCusto)} current={communicationCosts.emailCost + whatsappCusto} small="WhatsApp + e-mail" />
                      <MetricCard tone="gold" label="Custo WhatsApp" value={money(whatsappCusto)} current={whatsappCusto} small={`${number(whatsappEnvios)} mensagens`} />
                      <MetricCard tone="rust" label="Custo e-mail" value={money(communicationCosts.emailCost)} current={communicationCosts.emailCost} small={`${number(emailEnvios)} e-mails enviados`} />
                    </div>
                  </header>

                  <Section num="01" title="Custos e Envios">
                    <div className="grid-2">
                      <Panel title="Detalhamento" expandable={false}>
                        <BarRows rows={communicationCosts.rows} color={color} valueFormatter={money} valueLabel="Valor" showPercent />
                      </Panel>
                      <Panel title="E-mail e WhatsApp por credor" meta="Top 6 por envios" expandable={false}>
                        <table>
                          <thead>
                            <tr><th>Credor / Grupo</th><th className="right">E-mails</th><th className="right">WhatsApp</th><th className="right">Custo WhatsApp</th><th className="right">Envios totais</th></tr>
                          </thead>
                          <tbody>
                            {communicationCosts.byCredor.length === 0 ? <tr><td colSpan={5} className="muted">Sem dados de comunicação no período.</td></tr> : null}
                            {communicationCosts.byCredor.slice(0, 6).map((row) => (
                              <tr key={row.credor}>
                                <td className="bold">{row.credor}</td>
                                <td className="right">{number(row.emails)}</td>
                                <td className="right">{number(row.whatsapp)}</td>
                                <td className="right">{money(row.custoWati)}</td>
                                <td className="right muted">{number(row.totalEnvios)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </Panel>
                    </div>
                  </Section>
                </>
              ) : null}
            </main>
          </div>
          <button type="button" className="tv-close-btn" onClick={() => setTvMode(false)} title="Sair do modo TV (ESC)">
            <X size={20} />
          </button>
        </div>
      ) : presentationMode ? (
        <div className="presentation-hud">
          <div>
            <strong>{TAB_LABELS[tab]}</strong>
            <span>{selectedPeriodLabel} · {systemLabel(system)} · {selectedBusinessDayLimit ? `${selectedBusinessDayLimit} primeiros dias úteis` : 'todos os dias úteis'}</span>
          </div>
          <div className="presentation-dots" aria-label="Slides da apresentação">
            {PRESENTATION_TABS.map((item) => (
              <button key={item} type="button" className={tab === item ? 'active' : ''} onClick={() => setTab(item)} aria-label={TAB_LABELS[item]} />
            ))}
          </div>
          <div className="presentation-system-switch" aria-label="Sistema">
            {(['consulth', 'sisth', 'total'] as SystemFilter[]).map((item) => (
              <button key={item} type="button" className={system === item ? 'active' : ''} aria-pressed={system === item} onClick={() => setSystem(item)}>
                {item === 'total' ? 'Total' : systemLabel(item)}
              </button>
            ))}
          </div>
          <button type="button" onClick={() => setPresentationPaused((current) => !current)}>
            {presentationPaused ? <Play size={15} /> : <Pause size={15} />}
            {presentationPaused ? 'Continuar' : 'Pausar'}
          </button>
          <button type="button" onClick={() => setPresentationMode(false)}>
            <X size={15} />
            Sair
          </button>
        </div>
      ) : null}
      <div className="system-bar" role="navigation" aria-label="Filtros do relatório">
        <div className="system-group" aria-label="Selecionar sistema">
          <span>Sistema</span>
          {(['consulth', 'sisth', 'total'] as SystemFilter[]).map((item) => (
            <button key={item} className={system === item ? 'active' : ''} type="button" aria-pressed={system === item} onClick={() => setSystem(item)}>
              {systemLabel(item)}
            </button>
          ))}
        </div>

        <div className="system-actions">
          <div className="credor-filter" ref={creditorFilterRef}>
            <button type="button" className="control-btn" onClick={() => {
              setFilterOpen((current) => !current);
              setPeriodFilterOpen(false);
            }}>
              <Building2 size={16} />
              Credores
              <strong>{selectedLabel}</strong>
              <ChevronDown size={14} />
            </button>
            {filterOpen ? (
              <div className="credor-menu">
                <div className="credor-menu-actions">
                  <button type="button" onClick={() => setSelectedCredores(new Set([NO_CREDITOR_SELECTION]))}>Nenhum</button>
                  <button type="button" onClick={() => setSelectedCredores(new Set())}>Todos</button>
                </div>
                {allCredores.map((credor) => (
                  <label key={credor}>
                    <input type="checkbox" checked={!noCreditorSelected && (selectedCredores.size === 0 || selectedCredores.has(credor))} onChange={() => toggleCredor(credor)} />
                    <span>{credor}</span>
                    {!noCreditorSelected && (selectedCredores.size === 0 || selectedCredores.has(credor)) ? <Check size={14} /> : null}
                  </label>
                ))}
              </div>
            ) : null}
          </div>

          <div className="credor-filter" ref={periodFilterRef}>
            <button type="button" className="control-btn" disabled={dateFilterIgnored} onClick={() => {
              setPeriodFilterOpen((current) => !current);
              setFilterOpen(false);
            }}>
              Meses
              <strong>{visiblePeriodLabel}</strong>
              <ChevronDown size={14} />
            </button>
            {periodFilterOpen ? (
              <div className="credor-menu">
                <div className="credor-menu-actions">
                  <button type="button" onClick={() => setSelectedPeriods(period ? new Set([period]) : new Set())}>Mês atual</button>
                  <button type="button" onClick={() => setSelectedPeriods(new Set(periods))}>Todos</button>
                </div>
                {periods.map((item) => (
                  <label key={item}>
                    <input type="checkbox" checked={visiblePeriods.has(item)} onChange={() => togglePeriodFilter(item)} />
                    <span>{periodLabel(item)}</span>
                    {visiblePeriods.has(item) ? <Check size={14} /> : null}
                  </label>
                ))}
              </div>
            ) : null}
          </div>
          <select value={businessDaySelectValue} disabled={dateFilterIgnored} onChange={(event) => setBusinessDayLimit(event.target.value)} aria-label="Dias úteis">
            <option value="all">Todos os dias úteis</option>
            {Array.from({ length: maxBusinessDaysInSelectedPeriods }, (_, index) => index + 1).map((day) => (
              <option key={day} value={day}>{day} dias úteis</option>
            ))}
          </select>
          <button type="button" className="control-btn presentation-trigger" onClick={() => {
            setPresentationMode(true);
            setPresentationPaused(false);
          }}>
            <Presentation size={16} />
            Apresentar
          </button>
          <button type="button" className="control-btn" onClick={() => {
            setTab('relatorio');
            setTvMode(true);
          }} title="Tela de resultados com auto-refresh a cada 30 minutos">
            <Presentation size={16} />
            TV
          </button>
          <button type="button" className="control-btn" onClick={() => window.print()}>
            <Printer size={16} />
            PDF
          </button>
          <button type="button" className="control-btn" disabled={excelExporting} onClick={exportMonthlyFinancialExcel}>
            <FileSpreadsheet size={16} />
            {excelExporting ? 'Gerando...' : 'Excel'}
          </button>
        </div>
      </div>

      <div className="tab-bar" role="tablist" aria-label="Abas do relatório">
        <button className={tab === 'relatorio' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'relatorio'} onClick={() => setTab('relatorio')}>Resultados</button>
        <button className={tab === 'performance' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'performance'} onClick={() => setTab('performance')}>Performance</button>
        <button className={tab === 'base-ativa' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'base-ativa'} onClick={() => setTab('base-ativa')}>Bases</button>
        <button className={tab === 'custos' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'custos'} onClick={() => setTab('custos')}>Custos</button>
      </div>

      {demoMode ? (
        <div className="demo-banner" role="note">
          <strong>Modo demo</strong>
          <span>Dados 100% fictícios para apresentação pública. A API real não é chamada nesta visualização.</span>
        </div>
      ) : null}

      {loading && rawDashboardEnabled ? <div className="loading-state" role="status" aria-live="polite">Carregando dados do portal...</div> : null}
      {error && rawDashboardEnabled ? <div className="error-state" role="alert">{error}</div> : null}

      {!loading && !error && tab === 'relatorio' ? (
        <>
          <header className="hero">
            <div className="hero-top">
              <div>
                <div className="logos">
                  <img src={logoUrl} alt="Portal do Acordo" />
                </div>
                <p>Resultados</p>
                <h1><span>{portfolioPeriodTitle}</span></h1>
              </div>
              <div className="hero-meta">
                <strong>{portfolioPeriodList.length === 1 ? periodLabel(primaryPortfolioPeriod) : `${portfolioPeriodList.length} meses`}</strong>
                <span>{portfolioPeriodRange}</span>
                <span>{number(businessDays)} dias úteis</span>
                <em>{systemLabel(system)}</em>
              </div>
            </div>

            <div className="kpi-row">
              <MetricCard tone="teal" label="Total Recuperado" value={compactMoney(resultMetrics.totalPago)} current={resultMetrics.totalPago} previous={resultPreviousMetrics?.totalPago} small="Pagamentos no período" summary="Total recuperado no período selecionado." />
              <MetricCard tone="gold" label="Faturamento" value={compactMoney(resultMetrics.faturamento)} current={resultMetrics.faturamento} previous={resultPreviousMetrics?.faturamento} small="Honorários, taxas, juros, multas e protestos" summary="Receitas de faturamento vinculadas aos pagamentos do período." />
              <MetricCard tone="rust" label="Acordos Pagos" value={number(resultMetrics.acordosPagos)} current={resultMetrics.acordosPagos} previous={resultPreviousMetrics?.acordosPagos} small="Processos com pagamento" summary="Quantidade de acordos/processos com pagamento no período." />
              <MetricCard tone="sky" label="Conversão" value={`${resultMetrics.conversao.toFixed(1)}%`} current={resultMetrics.conversao} previous={resultPreviousMetrics?.conversao} small={systemLabel(system)} summary="Conversão de acessos em acordos no recorte selecionado." />
              <MetricCard tone="teal" label="Acessos" value={number(resultMetrics.acessos)} current={resultMetrics.acessos} previous={resultPreviousMetrics?.acessos} small="Visitantes únicos" summary="Acessos registrados no Portal do Acordo." />
            </div>
          </header>

          <main className="main-content">
            {system === 'total' ? (
              <div className="notice">
                <strong>Modo Total:</strong> os acessos sem acordo são compartilhados entre Consulth e Sisth; o total exibido não é duplicado.
              </div>
            ) : null}

            <Section num="01" title="Indicadores e Detalhamento">
              <div className="grid-2">
                <Panel title="Indicadores principais" meta={selectedBusinessDayLimit ? `${selectedBusinessDayLimit} primeiros dias úteis` : 'Período completo'}>
                  <table>
                    <thead>
                      <tr><th>INDICADOR</th><th className="right">ATUAL</th><th className="right">MÊS ANTERIOR</th><th className="right">VARIAÇÃO</th></tr>
                    </thead>
                    <tbody>
                      {resultComparisonRows.map((row) => (
                        <tr key={row.name}>
                          <td className="bold">{row.name}</td>
                          <td className="right">{row.formatter(row.atual)}</td>
                          <td className="right muted">{row.anterior !== undefined ? row.formatter(row.anterior) : 'Sem base'}</td>
                          <td className={`right variation-cell ${row.variation !== null && row.variation >= 0 ? 'positive' : 'negative'}`}>{variationLabel(row.variation)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
                <Panel title="DETALHAMENTO">
                  <table>
                    <thead>
                      <tr><th>Componente</th><th className="right">Valor</th><th className="right">%</th></tr>
                    </thead>
                    <tbody>
                      {resultComponentRows.map((row) => (
                        <tr key={row.name}>
                          <td className="with-swatch"><span style={{ background: row.color }} />{row.name}</td>
                          <td className="right">{money(row.value)}</td>
                          <td className="right muted">{percent(row.value, resultMetrics.totalPago)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><td>Total Recuperado</td><td className="right">{money(resultMetrics.totalPago)}</td><td className="right">100%</td></tr>
                    </tfoot>
                  </table>
                </Panel>
              </div>
            </Section>

            <Section num="02" title="Projeção do Mês">
              <Panel title="Projeção do mês" meta={`${number(projectionBaseDays)} de ${number(businessDays)} dias úteis considerados`}>
                <table className="projection-table">
                  <colgroup>
                    <col />
                    <col span={5} />
                  </colgroup>
                  <thead>
                    <tr><th>Indicador</th><th className="right">Realizado</th><th className="right">Projeção final</th><th className="right">Meta mensal</th><th className="right">Falta para meta</th><th className="right">% projetada</th></tr>
                  </thead>
                  <tbody>
                    {projectionRows.map((row) => (
                      <tr key={row.name}>
                        <td className="bold">{row.name}</td>
                        <td className="right">{money(row.atual)}</td>
                        <td className="right">{money(row.projetado)}</td>
                        <td className="right">{row.meta === null ? '-' : money(row.meta)}</td>
                        <td className="right muted">{row.meta === null ? '-' : money(Math.max(row.meta - row.atual, 0))}</td>
                        <td className="right">{row.meta === null ? '-' : percent(row.projetado, row.meta)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </Section>

            <Section num="03" title="Acordos e Ticket Médio">
              <div className="grid-2">
                <Panel title="Acordos Formalizados" meta={`Top 5 de ${number(metrics.acordos)} formalizados`}>
                  {(expanded) => {
                    const rows = expanded ? acordosRows : acordosRows.slice(0, 5);
                    return (
                      <table>
                        <thead>
                          <tr><th>#</th><th>Credor / Grupo</th><th className="right">Acordos</th><th className="right">Acordos Pagos</th><th className="right">% Pagos</th></tr>
                        </thead>
                        <tbody>
                          {rows.length === 0 ? <tr><td colSpan={5} className="muted">Sem dados no período.</td></tr> : null}
                          {rows.map((row, index) => (
                            <tr key={row.name}>
                              <td><span className="rank-badge">{index + 1}</span></td>
                              <td className="bold">{row.name}</td>
                              <td className="right">{number(row.acordos)}</td>
                              <td className="right">{number(row.pagos)}</td>
                              <td className="right muted">{row.conversaoPago.toFixed(1)}%</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    );
                  }}
                </Panel>
                <Panel title="Ticket Médio por Credor">
                  {(expanded) => (
                    <table>
                      <thead>
                        <tr><th>#</th><th>Credor / Grupo</th><th className="right">Total Recuperado</th><th className="right">Qtd Pagos</th><th className="right">Ticket Médio</th></tr>
                      </thead>
                      <tbody>
                        {ticketRows.length === 0 ? <tr><td colSpan={5} className="muted">Sem dados no período.</td></tr> : null}
                        {(expanded ? ticketRows : ticketRows.slice(0, 5)).map((row, index) => (
                          <tr key={row.name}>
                            <td><span className="rank-badge">{index + 1}</span></td>
                            <td className="bold">{row.name}</td>
                            <td className="right">{money(row.total)}</td>
                            <td className="right muted">{number(row.qtd)}</td>
                            <td className="right bold">{money(row.ticket)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Panel>
              </div>
            </Section>

            <Section num="04" title="Evolução Diária">
              <div className="grid-2">
                <Panel title="Receita Diária" meta="Por data de baixa">
                  <div className="chart-wrap small">
                    <ResponsiveContainer>
                      <LineChart data={isMultiPeriod ? dailyRevenueComparisonRows : receitaDiaria}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        {!isMultiPeriod ? weeklyRevenueBlocks.map((row) => (
                          <ReferenceArea
                            key={row.label}
                            x1={row.x1}
                            x2={row.x2}
                            fill={row.fill}
                            fillOpacity={0.08}
                            stroke={row.fill}
                            strokeOpacity={0.18}
                            label={{ value: `${row.label} ${row.note}`, position: 'insideTop', fill: row.fill, fontSize: 10, fontWeight: 700 }}
                          />
                        )) : null}
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis tickFormatter={(value) => `R$${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number, name: string, item) => [money(value), isMultiPeriod ? comparisonTooltipName(name, item) : name]} />
                        <Legend verticalAlign="top" height={28} />
                        {isMultiPeriod ? periodSeries.map((item) => (
                          <Line key={item.key} type="monotone" dataKey={item.key} name={item.label} stroke={item.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        )) : (
                          <Line type="monotone" dataKey="receita" name="Receita diária" stroke={chartAccent} strokeWidth={2.5} dot={{ r: 3 }} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        )}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
                <Panel title="Acordos por Dia">
                  <div className="chart-wrap small">
                    <ResponsiveContainer>
                      {isMultiPeriod ? (
                        <BarChart data={dailyAgreementComparisonRows}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(value: number, name: string, item) => [`${value} acordos`, comparisonTooltipName(name, item)]} />
                          <Legend verticalAlign="top" height={28} />
                          {periodSeries.map((item) => (
                            <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                          ))}
                        </BarChart>
                      ) : (
                        <ComposedChart data={acordosDiarios}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} />
                          <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                          <YAxis yAxisId="left" allowDecimals={false} tick={{ fontSize: 10 }} label={{ value: 'Acordos', angle: -90, position: 'insideLeft', offset: 5 }} />
                          <YAxis yAxisId="right" orientation="right" allowDecimals={false} tick={{ fontSize: 10 }} label={{ value: 'Acessos', angle: 90, position: 'insideRight', offset: 5 }} />
                          <Tooltip formatter={(value: number, name: string) => {
                            if (name === 'Acordos por dia') return [`${value} acordos`, name];
                            if (name === 'Acessos') return [`${value} acessos`, name];
                            return [value, name];
                          }} />
                          <Legend verticalAlign="top" height={28} />
                          <Bar yAxisId="left" dataKey="acordos" name="Acordos por dia" fill={chartAccent} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE}>
                            {acordosDiarios.map((row, index) => <Cell key={row.date} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />)}
                          </Bar>
                          <Line yAxisId="right" type="monotone" dataKey="acessos" name="Acessos" stroke="#8884d8" strokeWidth={2} dot={false} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        </ComposedChart>
                      )}
                    </ResponsiveContainer>
                  </div>
                </Panel>
              </div>
            </Section>

          </main>
        </>
      ) : null}

      {tab === 'custos' ? (
        <>
          <header className="hero">
            <div className="hero-top">
              <div>
                <div className="logos">
                  <img src={logoUrl} alt="Portal do Acordo" />
                </div>
                <p>Custos</p>
                <h1><span>{selectedPeriodTitle}</span></h1>
              </div>
              <div className="hero-meta">
                <strong>{selectedPeriodLabel}</strong>
                <span>{selectedPeriodRange}</span>
                <span>{number(businessDays)} dias úteis</span>
                <em>{systemLabel(system)}</em>
              </div>
            </div>
            <div className="kpi-row">
              <MetricCard tone="teal" label="Total comunicação" value={money(communicationCosts.emailCost + whatsappCusto)} current={communicationCosts.emailCost + whatsappCusto} small="WhatsApp + e-mail" summary="Soma dos custos de comunicação no período." />
              <MetricCard tone="gold" label="Custo WhatsApp" value={money(whatsappCusto)} current={whatsappCusto} small={`${number(whatsappEnvios)} mensagens`} summary="Custo de WhatsApp calculado a R$ 0,05 por mensagem." />
              <MetricCard tone="rust" label="Custo e-mail" value={money(communicationCosts.emailCost)} current={communicationCosts.emailCost} small={`${number(emailEnvios)} e-mails enviados`} summary="Custo fixo mensal de e-mail registrado para o relatório." />
            </div>
          </header>

          <main className="main-content costs-content">
          {supplementalLoading ? <div className="loading-state">Carregando custos...</div> : null}
          {!supplementalLoading && supplementalRefreshing ? <div className="loading-state">Atualizando custos...</div> : null}
          {costsError ? (
            <div className="error-state" role="alert">
              {costsError} <button type="button" className="control-btn" onClick={retryCosts}>Tentar novamente</button>
            </div>
          ) : null}

          <Section num="01" title="Custos WhatsApp e E-mail">
            <Panel title="Detalhamento">
              <BarRows rows={communicationCosts.rows} color={color} valueFormatter={money} valueLabel="Valor" showPercent />
            </Panel>
          </Section>

          <Section num="02" title="Envios por Credor">
            <Panel title="E-mail e WhatsApp por credor" meta="Top 5 por envios">
              {(expanded) => (
                <table>
                  <thead>
                    <tr><th>Credor / Grupo</th><th className="right">E-mails</th><th className="right">WhatsApp</th><th className="right">Custo WhatsApp</th><th className="right">Envios totais</th></tr>
                  </thead>
                  <tbody>
                    {communicationCosts.byCredor.length === 0 ? (
                      <tr><td colSpan={5} className="muted">Sem dados de comunicação no período.</td></tr>
                    ) : null}
                    {(expanded ? communicationCosts.byCredor : communicationCosts.byCredor.slice(0, 5)).map((row) => (
                      <tr key={row.credor}>
                        <td className="bold">{row.credor}</td>
                        <td className="right">{number(row.emails)}</td>
                        <td className="right">{number(row.whatsapp)}</td>
                        <td className="right">{money(row.custoWati)}</td>
                        <td className="right muted">{number(row.totalEnvios)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </Panel>
          </Section>
          </main>
        </>
      ) : null}

      {tab === 'base-ativa' ? (
        <>
          <header className="hero">
            <div className="hero-top">
              <div>
                <div className="logos">
                  <img src={logoUrl} alt="Portal do Acordo" />
                </div>
                <p>Bases</p>
                <h1><span>{selectedPeriodTitle}</span></h1>
              </div>
              <div className="hero-meta">
                <strong>{selectedPeriodLabel}</strong>
                <span>{selectedPeriodRange}</span>
                <span>{noCreditorSelected ? 'Nenhum credor selecionado' : selectedCredores.size === 0 ? 'Todos os credores' : `${number(selectedCredores.size)} credores selecionados`}</span>
                <em>{systemLabel(system)}</em>
              </div>
            </div>
            <div className="kpi-row">
              <MetricCard tone="teal" label="Total de Processos" value={number(baseTotalProcessos)} current={baseTotalProcessos} small="Processos na base" summary="Quantidade de processos considerados na carteira/base filtrada." />
              <MetricCard tone="gold" label="Valor Total da Carteira" value={compactMoney(baseValorTotal)} current={baseValorTotal} small={`${number(baseTotalBorderos)} borderôs`} summary="Soma do valor informado nas importações válidas da carteira." />
              <MetricCard tone="sky" label="Credores Ativos" value={number(baseCredoresAtivos)} current={baseCredoresAtivos} small={baseStatusLabel} summary="Quantidade de grupos de credores ativos na base filtrada." />
              <MetricCard tone="rust" label="Ticket Médio" value={money(baseTicketMedio)} current={baseTicketMedio} small="Valor por processo" summary="Valor total da carteira dividido pela quantidade de processos da base." />
            </div>
          </header>

          <main className="main-content">
            {baseSummaryLoading ? <div className="loading-state">Carregando bases...</div> : null}
            {baseSummaryError ? <div className="error-state">{baseSummaryError}</div> : null}
            {!baseSummaryLoading && !baseSummaryError ? (
              <>
                {!baseSummary.aging_complete && baseSummary.status !== 'ready' ? (
                  <div className={baseSummary.status === 'error' ? 'error-state' : 'loading-state'}>
                    {baseSummary.error ??
                      (baseSummary.status === 'partial'
                        ? 'Os processos por credor já foram carregados. Os vencimentos ainda não terminaram dentro do tempo limite.'
                        : 'As Bases estão sendo atualizadas em segundo plano. Quando terminar, a tela passa a usar o cache local.')}
                  </div>
                ) : null}
                {baseTotalBorderos === 0 ? (
                  <div className="notice">
                    <strong>Sem importações no período selecionado.</strong> Selecione mais meses, outro sistema ou outros credores para ver o valor total da carteira.
                  </div>
                ) : null}

                <Section num="01" title="Visão por Credor">
                  <div className="grid-2">
                    <Panel title="Processos por Credor" meta={`Top ${Math.min(baseProcessCredorRows.length, 5)}`} expandable={false}>
                      <BarRows rows={baseProcessCredorRows.slice(0, 5)} color={color} valueLabel="Processos" />
                    </Panel>
                    <Panel title="Entrada x Recuperado" meta={`Top ${Math.min(baseEntryCreditorRows.length, 5)}`} expandable={false}>
                      <table>
                        <thead>
                          <tr><th>Credor / Grupo</th><th className="right">Entrada</th><th className="right">Recuperado</th><th className="right">% Rec.</th><th className="right">Proc.</th><th className="right">Acordos</th></tr>
                        </thead>
                        <tbody>
                          {baseEntryCreditorRows.length === 0 ? <tr><td colSpan={6} className="muted">Sem carteiras no período selecionado.</td></tr> : null}
                          {baseEntryCreditorRows.slice(0, 5).map((row) => (
                            <tr key={row.credor}>
                              <td className="bold">{row.credor}</td>
                              <td className="right">{money(row.valorEntrada)}</td>
                              <td className="right">{money(row.recuperado)}</td>
                              <td className="right">{row.percentualRecuperado.toFixed(2)}%</td>
                              <td className="right muted">{number(row.processos)}</td>
                              <td className="right muted">{number(row.acordos)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </Panel>
                  </div>
                </Section>

                <Section num="02" title="Envelhecimento">
                  <div className="grid-2">
                    <Panel title="Processos por Faixa" meta="Menor vencimento por processo">
                      <BarRows rows={baseAgingProcessRows} color={color} valueLabel="Processos" showPercent />
                    </Panel>
                    <Panel title="Valor Total por Faixa" meta="Títulos abertos da base ativa">
                      <div className="range-value-summary">
                        <span>Carteira ativa</span>
                        <strong>{compactMoney(baseRangeTotal)}</strong>
                        <small>Distribuição por menor vencimento dos processos ativos</small>
                      </div>
                      <div className="chart-wrap range-value-chart">
                        <ResponsiveContainer>
                          <BarChart data={baseRangeChartRows} layout="vertical" margin={{ top: 8, right: 88, bottom: 4, left: 10 }}>
                            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                            <XAxis type="number" tickFormatter={(value) => shortMoney(Number(value))} tick={{ fontSize: 10 }} />
                            <YAxis type="category" dataKey="name" width={96} tick={{ fontSize: 11, fontWeight: 700 }} />
                            <Tooltip
                              formatter={(value: number, name: string) => name === 'Valor total' ? [money(value), name] : [value, name]}
                              labelFormatter={(label) => `Faixa: ${label}`}
                            />
                            <Bar dataKey="valorCarteira" name="Valor total" radius={[0, 6, 6, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE}>
                              {baseRangeChartRows.map((row, index) => <Cell key={row.faixa} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />)}
                              <LabelList dataKey="valorCarteira" position="right" formatter={(value: number) => shortMoney(value)} className="range-value-label" />
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                      <div className="range-value-details">
                        {baseRangeChartRows.map((row, index) => (
                          <div className="range-value-detail" key={row.faixa}>
                            <span className="range-value-swatch" style={{ background: CHART_PALETTE[index % CHART_PALETTE.length] }} />
                            <strong>{row.name}</strong>
                            <span>{compactMoney(row.valorCarteira)}</span>
                            <small>{row.participacao.toFixed(1)}% | {number(row.processos)} processos</small>
                          </div>
                        ))}
                      </div>
                    </Panel>
                  </div>
                </Section>

                <Section num="03" title="Recuperação por Faixa">
                  <Panel title="Recuperação e Conversão por Faixa" meta="Valores estimados pela distribuição de processos por credor">
                    <div className="chart-wrap">
                      <ResponsiveContainer>
                        <BarChart data={baseRangeRows} layout="vertical" margin={{ left: 18, right: 24 }}>
                          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
                          <XAxis type="number" tickFormatter={(value) => `R$${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 10 }} />
                          <YAxis type="category" dataKey="name" width={108} tick={{ fontSize: 10 }} />
                          <Tooltip formatter={(value: number) => money(value)} />
                          <Legend verticalAlign="top" height={28} />
                          <Bar dataKey="valorCarteira" name="Valor da faixa" fill={COLORS.sky} radius={[0, 4, 4, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                          <Bar dataKey="recuperado" name="Recuperado" fill={COLORS.green} radius={[0, 4, 4, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                    <table>
                      <thead>
                        <tr><th>Faixa</th><th className="right">Recuperado</th><th className="right">% Recuperação</th><th className="right">Conversão</th></tr>
                      </thead>
                      <tbody>
                        {baseRangeRows.map((row) => (
                          <tr key={row.faixa}>
                            <td className="bold">{row.name}</td>
                            <td className="right">{money(row.recuperado)}</td>
                            <td className="right">{row.recuperacao.toFixed(2)}%</td>
                            <td className="right">{row.conversao.toFixed(2)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </Panel>
                </Section>
              </>
            ) : null}
          </main>
        </>
      ) : null}

      {!loading && !error && tab === 'carteiras' ? (
        <>
          <header className="hero">
            <div className="hero-top">
              <div>
                <div className="logos">
                  <img src={logoUrl} alt="Portal do Acordo" />
                </div>
                <p>Carteiras</p>
                <h1><span>{selectedPeriodTitle}</span></h1>
              </div>
              <div className="hero-meta">
                <strong>{selectedPeriodLabel}</strong>
                <span>{selectedPeriodRange}</span>
                <span>{number(businessDays)} dias úteis</span>
                <em>{systemLabel(system)}</em>
              </div>
            </div>
            <div className="kpi-row">
              <MetricCard tone="teal" label="Valor de entrada" value={compactMoney(portfolioView.totalValorEntrada)} current={portfolioView.totalValorEntrada} small={`${number(portfolioView.totalBorderos)} borderôs`} summary="Soma do valor informado nas importações válidas da carteira." />
              <MetricCard tone="gold" label="Processos importados" value={number(portfolioView.totalProcessos)} current={portfolioView.totalProcessos} small={`${number(portfolioView.totalTitulos)} títulos`} summary="Quantidade de processos importados nas carteiras selecionadas." />
              <MetricCard tone="sky" label="Recuperado" value={compactMoney(portfolioView.totalRecuperado)} current={portfolioView.totalRecuperado} small={`${portfolioView.totalValorEntrada > 0 ? ((portfolioView.totalRecuperado / portfolioView.totalValorEntrada) * 100).toFixed(2) : '0.00'}% da entrada`} summary="Total pago no período para os credores das carteiras." />
              <MetricCard tone="rust" label="Conversão carteira" value={`${portfolioView.totalProcessos > 0 ? ((portfolioView.totalAcordos / portfolioView.totalProcessos) * 100).toFixed(2) : '0.00'}%`} current={portfolioView.totalAcordos} small={`${number(portfolioView.totalAcordos)} acordos`} summary="Acordos formalizados sobre processos importados." />
            </div>
          </header>

          <main className="main-content">
            {portfolioLoading ? <div className="loading-state">Carregando carteiras...</div> : null}
            {portfolioError ? <div className="error-state">{portfolioError}</div> : null}
            {!portfolioLoading && !portfolioError ? (
              <>
                {filteredPortfolioData.length === 0 ? (
                  <div className="notice">
                    <strong>Sem importações no período selecionado.</strong> Selecione mais meses, mais dias úteis, outro sistema ou outros credores para ver o acumulado da carteira.
                  </div>
                ) : null}

                <Section num="01" title="Performance por Carteira">
                  <Panel title="Entrada x recuperado" meta={`Top ${Math.min(portfolioView.byCreditor.length, 8)}`}>
                    {(expanded) => (
                      <table>
                        <thead>
                          <tr><th>Carteira</th><th className="right">Entrada</th><th className="right">Recuperado</th><th className="right">% Rec.</th><th className="right">Proc.</th><th className="right">Acordos</th></tr>
                        </thead>
                        <tbody>
                          {portfolioView.byCreditor.length === 0 ? <tr><td colSpan={6} className="muted">Sem carteiras no período selecionado.</td></tr> : null}
                          {(expanded ? portfolioView.byCreditor : portfolioView.byCreditor.slice(0, 8)).map((row) => (
                            <tr key={row.credor}>
                              <td className="bold">{row.credor}</td>
                              <td className="right">{money(row.valorEntrada)}</td>
                              <td className="right">{money(row.recuperado)}</td>
                              <td className="right">{row.percentualRecuperado.toFixed(2)}%</td>
                              <td className="right muted">{number(row.processos)}</td>
                              <td className="right muted">{number(row.acordos)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    )}
                  </Panel>
                </Section>

                <Section num="02" title="Entradas por Dia Útil">
                  <div className="grid-2">
                    <Panel title="Valor importado" meta="Comparativo por mês">
                      {portfolioDailyComparisonRows.length === 0 ? (
                        <div className="empty-state">Sem importações com data útil no período selecionado.</div>
                      ) : (
                        <div className="chart-wrap small">
                          <ResponsiveContainer>
                            <BarChart data={portfolioDailyComparisonRows}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                              <YAxis tickFormatter={(value) => `R$${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(value: number, name: string, item) => [money(value), comparisonTooltipName(name, item)]} />
                              <Legend verticalAlign="top" height={28} />
                              {periodSeries.map((item) => (
                                <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              ))}
                            </BarChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </Panel>
                    <Panel title="Processos importados" meta="Por dia útil">
                      {portfolioDailyComparisonRows.length === 0 ? (
                        <div className="empty-state">Sem processos importados no recorte selecionado.</div>
                      ) : (
                        <div className="chart-wrap small">
                          <ResponsiveContainer>
                            <LineChart data={portfolioDailyComparisonRows}>
                              <CartesianGrid strokeDasharray="3 3" vertical={false} />
                              <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                              <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                              <Tooltip formatter={(value: number, name: string, item) => [number(value), comparisonTooltipName(name, item)]} />
                              <Legend verticalAlign="top" height={28} />
                              {periodSeries.map((item) => (
                                <Line key={`${item.key}_processos`} type="monotone" dataKey={`${item.key}_processos`} name={item.label} stroke={item.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={CHART_ANIMATION_ACTIVE} />
                              ))}
                            </LineChart>
                          </ResponsiveContainer>
                        </div>
                      )}
                    </Panel>
                  </div>
                </Section>

                <Section num="03" title="Evolução das Entradas">
                  <div className="grid-2">
                    <Panel title="Valor de entrada por mês">
                      <div className="chart-wrap small">
                        <ResponsiveContainer>
                          <BarChart data={portfolioView.monthly}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                            <YAxis tickFormatter={(value) => `R$${Math.round(Number(value) / 1000)}k`} tick={{ fontSize: 10 }} />
                            <Tooltip formatter={(value: number) => money(value)} />
                            <Bar dataKey="valorEntrada" name="Valor de entrada" fill={chartAccent} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    </Panel>
                    <Panel title="Processos importados por mês">
                      <BarRows rows={portfolioView.monthly.map((row) => ({ name: row.label, value: row.processos }))} color={color} valueLabel="Processos" />
                    </Panel>
                  </div>
                </Section>
              </>
            ) : null}
          </main>
        </>
      ) : null}

      {!loading && !error && tab === 'performance' ? (
        <>
          <header className="hero">
            <div className="hero-top">
              <div>
                <div className="logos">
                  <img src={logoUrl} alt="Portal do Acordo" />
                </div>
                <p>Performance</p>
                <h1><span>{selectedPeriodTitle}</span></h1>
              </div>
              <div className="hero-meta">
                <strong>{selectedPeriodLabel}</strong>
                <span>{selectedPeriodRange}</span>
                <span>{number(businessDays)} dias úteis</span>
                <em>{systemLabel(system)}</em>
              </div>
            </div>
            <div className="kpi-row">
              <MetricCard tone="teal" label="Envios" value={number(totalEnviosCanal)} current={totalEnviosCanal} small={`${number(emailEnvios)} e-mails - ${number(whatsappEnvios)} WhatsApp`} summary="Total de comunicações enviadas no período." />
              <MetricCard tone="gold" label="CLIQUES NO LINK" value={number(totalCliquesLink)} current={totalCliquesLink} small={`${number(cliquesPortal)} WhatsApp - ${number(emailClickTotal)} e-mail`} summary="Cliques no link de WhatsApp e e-mail somados no período." />
              <MetricCard tone="sky" label="Acessos" value={number(acessosPortal)} current={acessosPortal} previous={previousPerformanceMetrics?.acessos} small="Acessos no site" summary="Acessos registrados no Portal do Acordo." />
              <MetricCard tone="teal" label="Quantidade de Acordos" value={number(acordosPortal)} current={acordosPortal} previous={previousPerformanceMetrics?.acordos} small="Acordos formalizados" summary="Quantidade de acordos formalizados no período." />
              <MetricCard tone="rust" label="Conversão" value={`${conversaoPortal.toFixed(1)}%`} current={conversaoPortal} previous={previousPerformanceMetrics?.conversao} small={`${number(acordosPortal)} acordos`} summary="Conversão de acessos em acordos no período." />
            </div>
          </header>

          <main className="main-content">

          <Section num="01" title="Acessos e Conversão">
            <div className="grid-2">
              <Panel title="Acessos e Acordos">
                <div className="center-funnel">
                  {accessFunnelRows.map((row, index) => (
                    <div className="center-funnel-row" key={row.name}>
                      <div className="center-funnel-bar" style={{ width: `${Math.max(Math.min(row.fill, 100), 12)}%`, background: CHART_PALETTE[index % CHART_PALETTE.length] }}>
                        <span>{row.name}</span>
                        <strong>{row.value}</strong>
                      </div>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="Acessos com Acordo por Credor" meta="Top 5">
                {(expanded) => <BarRows rows={expanded ? acessosCredorRows : acessosCredorRows.slice(0, 5)} color={color} valueLabel="Qtd." visualLabel="Acordos por Credor" />}
              </Panel>
            </div>
          </Section>

          {/* Comunicação por Dia Útil mantida no código, mas retirada da tela por enquanto.
          <Section num="02" title="Comunicação por Dia Útil">
            <div className="grid-2">
              <Panel title="Envios WhatsApp" meta="Comparativo por mês">
                {whatsappDailyComparisonRows.length === 0 ? (
                  <div className="empty-state">Sem dados diários de WhatsApp para o período selecionado.</div>
                ) : (
                  <div className="chart-wrap small">
                    <ResponsiveContainer>
                      <BarChart data={whatsappDailyComparisonRows}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number, name: string, item) => [number(value), comparisonTooltipName(name, item)]} />
                        <Legend verticalAlign="top" height={28} />
                        {periodSeries.map((item) => (
                          <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        ))}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
              <Panel title="Cliques WhatsApp" meta="CLICKED por dia útil">
                {whatsappDailyComparisonRows.length === 0 ? (
                  <div className="empty-state">Sem dados diários de clique para o período selecionado.</div>
                ) : (
                  <div className="chart-wrap small">
                    <ResponsiveContainer>
                      <LineChart data={whatsappDailyComparisonRows}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number, name: string, item) => [number(value), comparisonTooltipName(name, item)]} />
                        <Legend verticalAlign="top" height={28} />
                        {periodSeries.map((item) => (
                          <Line key={`${item.key}_clicked`} type="monotone" dataKey={`${item.key}_clicked`} name={item.label} stroke={item.color} strokeWidth={2.5} dot={{ r: 3 }} connectNulls isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        ))}
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
            </div>
          </Section>
          */}

          <Section num="02" title="Cliques por Credor">
            <div className="grid-2">
              <Panel title="WhatsApp e E-mail por Credor" meta={`${number(totalCliquesLink)} cliques no link`}>
                {(expanded) => {
                  const rows = expanded ? clickCredorRows : clickCredorRows.slice(0, 5);
                  return (
                    <table>
                      <thead>
                        <tr><th>Credor / Grupo</th><th className="right">WhatsApp</th><th className="right">E-mail</th><th className="right">Total</th><th className="right">Acessos</th><th className="right">Acordos</th><th className="right">Conversão</th><th className="right">Último clique</th></tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? <tr><td colSpan={8} className="muted">Sem cliques no período.</td></tr> : null}
                        {rows.map((row) => (
                          <tr key={row.credor}>
                            <td className="bold">{row.credor}</td>
                            <td className="right">{number(row.whatsapp)}</td>
                            <td className="right">{number(row.email)}</td>
                            <td className="right bold">{number(row.total)}</td>
                            <td className="right">{number(row.acessos)}</td>
                            <td className="right">{number(row.acordos)}</td>
                            <td className="right">{row.conversao.toFixed(1)}%</td>
                            <td className="right">{dateTime(row.ultimoClique)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                }}
              </Panel>
              <Panel title="Últimos cliques" meta="WhatsApp e e-mail">
                {(expanded) => {
                  const rows = expanded ? recentClickRows : recentClickRows.slice(0, 5);
                  return (
                    <table>
                      <thead>
                        <tr><th>Horário</th><th>Canal</th><th>Credor</th><th>Processo</th><th>Destinatário</th><th>Campanha</th></tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? <tr><td colSpan={6} className="muted">Sem eventos rastreados.</td></tr> : null}
                        {rows.map((row) => (
                          <tr key={row.id}>
                            <td className="bold">{dateTime(row.data)}</td>
                            <td>{row.canal}</td>
                            <td>{row.credor}</td>
                            <td>{row.processo || '-'}</td>
                            <td>{row.destinatario}</td>
                            <td>{row.campanha}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                }}
              </Panel>
            </div>
          </Section>

          <Section num="03" title="Conversão e Horários">
            <div className="grid-2">
              <Panel title="Funil do Canal">
                <div className="funnel-grid">
                  {funnelRows.map((row, index) => (
                    <div className="funnel-card" key={row.name}>
                      <span>{row.name}</span>
                      <strong>{row.value.toFixed(1)}%</strong>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.min(row.value, 100)}%`, background: CHART_PALETTE[index % CHART_PALETTE.length] }} /></div>
                    </div>
                  ))}
                </div>
              </Panel>
              <Panel title="Melhores horários" meta="Ordem cronológica; melhor conversão destacada">
                {(expanded) => {
                  const rows = expanded
                    ? hourlyConversionRows
                    : [...hourlyConversionRows]
                      .filter((row) => row.acessos > 0 || row.acordos > 0)
                      .sort((a, b) => b.conversao - a.conversao || b.acordos - a.acordos || b.acessos - a.acessos)
                      .slice(0, 5)
                      .sort((a, b) => a.hour - b.hour);

                  return (
                    <table>
                      <thead>
                        <tr><th>Horário</th><th className="right">Acessos</th><th className="right">Acordos</th><th className="right">Conversão</th></tr>
                      </thead>
                      <tbody>
                        {rows.length === 0 ? <tr><td colSpan={4} className="muted">Sem horário nos dados carregados.</td></tr> : null}
                        {rows.map((row) => (
                          <tr key={row.hour} className={bestHourlyRow?.hour === row.hour ? 'highlight-row' : ''}>
                            <td className="bold">{row.label}</td>
                            <td className="right">{number(row.acessos)}</td>
                            <td className="right">{number(row.acordos)}</td>
                            <td className="right">{row.conversao.toFixed(1)}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  );
                }}
              </Panel>
            </div>
          </Section>

          <Section num="04" title="Comparativo Mensal">
            <div className="grid-2">
              <Panel title="Volume de Envios">
                <div className="chart-wrap small">
                  <ResponsiveContainer>
                    <ComposedChart data={monthlyEvolution}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value: number, name: string) => [number(value), name]} />
                      <Legend verticalAlign="top" height={28} />
                      <Bar dataKey="emails" name="E-mails" fill={COLORS.sky} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                      <Bar dataKey="whatsapp" name="WhatsApp" fill={COLORS.green} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                      <Line type="monotone" dataKey="envios" name="Total de envios" stroke={COLORS.gold} strokeWidth={2.5} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
              <Panel title="Acessos, Acordos e Conversão">
                <div className="chart-wrap small">
                  <ResponsiveContainer>
                    <ComposedChart data={monthlyEvolution}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="volume" allowDecimals={false} tick={{ fontSize: 10 }} />
                      <YAxis yAxisId="rate" orientation="right" tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value: number, name: string) => [name === 'Conversão acesso -> acordo' ? `${value.toFixed(1)}%` : number(value), name]} />
                      <Legend verticalAlign="top" height={28} />
                      <Bar yAxisId="volume" dataKey="acessos" name="Acessos" fill={COLORS.sky} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                      <Bar yAxisId="volume" dataKey="acordos" name="Acordos" fill={COLORS.rust} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                      <Line yAxisId="rate" type="monotone" dataKey="conversao" name="Conversão acesso -> acordo" stroke={COLORS.green} strokeWidth={2.5} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                    </ComposedChart>
                  </ResponsiveContainer>
                </div>
              </Panel>
            </div>
          </Section>

          <Section num="05" title="Custo por Canal">
            <div className="grid-2">
              <Panel title="Custo por acesso e por acordo" meta="Acesso/acordo usam o total do período">
                <table>
                  <thead>
                    <tr><th>Canal</th><th className="right">Envios</th><th className="right">Custo</th><th className="right">Custo/envio</th><th className="right">Custo/acesso</th><th className="right">Custo/acordo</th></tr>
                  </thead>
                  <tbody>
                    {channelCostRows.map((row) => (
                      <tr key={row.canal}>
                        <td className="bold">{row.canal}</td>
                        <td className="right">{number(row.envios)}</td>
                        <td className="right">{money(row.custo)}</td>
                        <td className="right muted">{money(row.custoPorEnvio)}</td>
                        <td className="right">{money(row.custoPorAcesso)}</td>
                        <td className="right">{money(row.custoPorAcordo)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
              <Panel title="Top Dias de Conversão" meta={`Top ${topDays.length}`}>
                <div className="topdays-list">
                  {topDays.length === 0 ? <div className="empty-state">Sem dados no período.</div> : null}
                  {topDays.map((row, index) => (
                    <div className="topday-row" key={row.date}>
                      <span className={`rank-badge ${index < 3 ? 'featured' : ''}`}>{index + 1}</span>
                      <span>{row.label}</span>
                      <div className="bar-track"><div className="bar-fill" style={{ width: `${(row.acordos / Math.max(topDays[0]?.acordos || 1, 1)) * 100}%`, background: CHART_PALETTE[index % CHART_PALETTE.length] }} /></div>
                      <strong>{number(row.acordos)} acordos</strong>
                      <em>{row.conversao.toFixed(1)}% conv.</em>
                    </div>
                  ))}
                </div>
              </Panel>
            </div>
          </Section>

          <Section num="06" title="Pagamentos por Negociador">
            <div className="neg-grid">
              {negociadores.length === 0 ? <div className="empty-state">Sem dados no período.</div> : null}
              {negociadores.map((row, index) => (
                <div className="neg-card" key={row.name}>
                  <span>{row.name}</span>
                  <strong>{compactMoney(row.total)}</strong>
                  <small>{number(row.qtd)} pagamento{row.qtd === 1 ? '' : 's'}</small>
                  <div style={{ width: `${(row.total / Math.max(negociadores[0]?.total || 1, 1)) * 100}%`, background: CHART_PALETTE[index % CHART_PALETTE.length] }} />
                </div>
              ))}
            </div>
          </Section>
          </main>
        </>
      ) : null}

      <footer className="footer">
        <span>Relatório atualizado em {new Date().toLocaleDateString('pt-BR')}</span>
        <span title="Versão do commit e horário em que o build publicado foi gerado">
          Portal {__APP_VERSION__} · publicado em {dateTime(__APP_DEPLOYED_AT__)}
        </span>
      </footer>
    </div>
  );
}

export default DashboardPage;
