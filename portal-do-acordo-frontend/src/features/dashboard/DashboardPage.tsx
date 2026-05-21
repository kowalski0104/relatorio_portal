import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ComposedChart,
  Line,
  LineChart,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { Building2, Check, ChevronDown, Pause, Play, Presentation, Printer, X } from 'lucide-react';
import logoUrl from '../../assets/portal-agreement-logo.png';
import { BarRows } from './components/BarRows';
import { MetricCard } from './components/MetricCard';
import { Panel } from './components/Panel';
import { Section } from './components/Section';
import { CHART_PALETTE, COLORS, FIXED_EMAIL_COST } from './config/constants';
import { DEMO_WHATSAPP_CAMPAIGN_DATA, isDemoMode } from './data/demoDashboardData';
import { WHATSAPP_CAMPAIGN_DATA, type WhatsappCampaignCredor } from './data/whatsappCampaigns';
import { useActiveBaseData, useDashboardData, useDashboardSupplementalData, usePortfolioData } from './hooks/useDashboardData';
import type { Access, Agreement, CostsData, DashboardTab, PortfolioEntry, SystemFilter, ThemeMode } from './types';
import { groupBy, isNoCreditorSelection, NO_CREDITOR_SELECTION, normalizeCreditorGroup } from './utils/creditors';
import { businessDayIndexMap, businessDaysInPeriod, dayLabel, monthKey, periodLabel, periodRangeLabel, previousPeriod } from './utils/dates';
import { countBusinessDaysWithData, filterDashboardData, getAvailableCreditors, matchesSystem, summarizeDashboardMetrics } from './utils/dashboardMetrics';
import { compactMoney, dateTime, money, number, percent, safeNumber, systemLabel } from './utils/formatters';
import './styles/dashboard.css';

const safe = safeNumber;
const CHART_ANIMATION_ACTIVE = false;
const PRESENTATION_TABS: DashboardTab[] = ['relatorio', 'performance', 'carteiras', 'custos', 'base-ativa'];
const TAB_LABELS: Record<DashboardTab, string> = {
  relatorio: 'Resultados',
  custos: 'Custos',
  performance: 'Performance',
  carteiras: 'Carteiras',
  'base-ativa': 'Bases',
};

function variation(current: number, previous: number | null | undefined) {
  return previous && previous !== 0 ? ((current - previous) / previous) * 100 : null;
}

function variationLabel(value: number | null) {
  return value !== null && Number.isFinite(value) ? `${value >= 0 ? '+' : ''}${value.toFixed(1)}%` : 'Sem base';
}

function getInitialTab(): DashboardTab {
  if (typeof window === 'undefined') return 'relatorio';
  const requestedTab = new URLSearchParams(window.location.search).get('tab') as DashboardTab | null;
  return requestedTab && TAB_LABELS[requestedTab] ? requestedTab : 'relatorio';
}

function DashboardPage() {
  const demoMode = isDemoMode();
  const { data, loading, error, period, setPeriod, periods } = useDashboardData();
  const [system, setSystem] = useState<SystemFilter>(() => demoMode ? 'total' : 'consulth');
  const [theme, setTheme] = useState<ThemeMode>(() => {
    if (typeof window === 'undefined') return 'night';
    const savedTheme = window.localStorage.getItem('portal-theme');
    return savedTheme === 'sisth' ? 'sisth' : 'night';
  });
  const [tab, setTab] = useState<DashboardTab>(getInitialTab);
  const [selectedCredores, setSelectedCredores] = useState<Set<string>>(new Set());
  const [selectedPeriods, setSelectedPeriods] = useState<Set<string>>(new Set());
  const [businessDayLimit, setBusinessDayLimit] = useState('all');
  const [filterOpen, setFilterOpen] = useState(false);
  const [periodFilterOpen, setPeriodFilterOpen] = useState(false);
  const [presentationMode, setPresentationMode] = useState(false);
  const [presentationPaused, setPresentationPaused] = useState(false);
  const creditorFilterRef = useRef<HTMLDivElement>(null);
  const periodFilterRef = useRef<HTMLDivElement>(null);
  const effectivePeriods = useMemo(() => (selectedPeriods.size > 0 ? selectedPeriods : period ? new Set([period]) : new Set<string>()), [period, selectedPeriods]);
  const portfolioPeriods = effectivePeriods;
  const dateFilterIgnored = tab === 'base-ativa';
  const visiblePeriods = dateFilterIgnored ? new Set(periods) : effectivePeriods;
  const selectedPeriodList = useMemo(() => Array.from(effectivePeriods).sort().reverse(), [effectivePeriods]);
  const portfolioPeriodList = useMemo(() => Array.from(portfolioPeriods).sort().reverse(), [portfolioPeriods]);
  const primaryPeriod = selectedPeriodList[0] ?? period;
  const primaryPortfolioPeriod = portfolioPeriodList[0] ?? primaryPeriod;
  const isMultiPeriod = selectedPeriodList.length > 1;
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
  const { costs: custos, communication: comunicacao } = useDashboardSupplementalData(primaryPeriod, system, selectedCredores);
  const { activeBaseReport, activeBaseLoading, activeBaseError } = useActiveBaseData(system, selectedCredores, tab === 'base-ativa');
  const { portfolioData, portfolioLoading, portfolioError } = usePortfolioData(system, portfolioPeriods, selectedCredores, tab === 'carteiras');

  useEffect(() => {
    window.localStorage.setItem('portal-theme', theme);
  }, [theme]);

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
    if (!presentationMode) return;
    setFilterOpen(false);
    setPeriodFilterOpen(false);
  }, [presentationMode]);

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
      if (!presentationMode) return;
      if (event.key === 'Escape') setPresentationMode(false);
      if (event.key === ' ') {
        event.preventDefault();
        setPresentationPaused((current) => !current);
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
  }, [presentationMode]);

  const allCredores = useMemo(() => getAvailableCreditors(data), [data]);
  const noCreditorSelected = isNoCreditorSelection(selectedCredores);

  const color = COLORS[system];
  const chartAccent = theme === 'night' && color === COLORS.consulth ? COLORS.sky : color;
  const businessDays = useMemo(() => selectedPeriodList.reduce((sum, item) => sum + businessDaysInPeriod(item), 0), [selectedPeriodList]);
  const maxBusinessDaysInSelectedPeriods = useMemo(() => selectedPeriodList.reduce((max, item) => Math.max(max, businessDaysInPeriod(item)), 0), [selectedPeriodList]);
  const businessDayMap = useMemo(() => {
    const map = new Map<string, number>();
    selectedPeriodList.forEach((item) => {
      businessDayIndexMap(item).forEach((index, date) => map.set(date, index));
    });
    return map;
  }, [selectedPeriodList]);
  const selectedBusinessDayLimit = !dateFilterIgnored && businessDayLimit !== 'all' ? Math.min(Number(businessDayLimit), maxBusinessDaysInSelectedPeriods) : null;
  const businessDaySelectValue = dateFilterIgnored || businessDayLimit === 'all' || maxBusinessDaysInSelectedPeriods === 0
    ? 'all'
    : String(Math.min(Number(businessDayLimit), maxBusinessDaysInSelectedPeriods));
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
  const portfolioFiltered = useMemo(
    () => filterDashboardData({ data, system, period: primaryPortfolioPeriod, periods: portfolioPeriods, selectedCreditors: selectedCredores, businessDayMap, selectedBusinessDayLimit }),
    [businessDayMap, data, portfolioPeriods, primaryPortfolioPeriod, selectedBusinessDayLimit, selectedCredores, system]
  );
  const consideredBusinessDays = selectedBusinessDayLimit
    ? selectedPeriodList.reduce((sum, item) => sum + Math.min(selectedBusinessDayLimit, businessDaysInPeriod(item)), 0)
    : Math.max(countBusinessDaysWithData(filtered, businessDayMap), 1);

  const metrics = useMemo(() => {
    return summarizeDashboardMetrics(filtered);
  }, [filtered]);

  const projectionRows = useMemo(() => {
    const factor = businessDays > 0 && consideredBusinessDays > 0 ? businessDays / consideredBusinessDays : 0;

    return [
      { name: 'Total Pago', atual: metrics.totalPago, projetado: metrics.totalPago * factor },
      { name: 'Capital', atual: metrics.capital, projetado: metrics.capital * factor },
      { name: 'Honorários', atual: metrics.honorarios, projetado: metrics.honorarios * factor },
      { name: 'Valor negociado', atual: metrics.totalAcordos, projetado: metrics.totalAcordos * factor },
    ];
  }, [businessDays, consideredBusinessDays, metrics]);

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
  const resultMonthlyRows = useMemo(() => {
    const keys = isMultiPeriod ? [...selectedPeriodList].sort() : previousPeriodKey ? [previousPeriodKey, primaryPeriod] : [primaryPeriod];

    return keys.map((key) => {
      const comparisonPeriod = previousPeriod(key);
      const periodBusinessDayMap = key === previousPeriodKey ? previousBusinessDayMap : businessDayMap;
      const rows = filterDashboardData({
        data,
        system,
        period: key,
        periods: new Set([key]),
        selectedCreditors: selectedCredores,
        businessDayMap: periodBusinessDayMap,
        selectedBusinessDayLimit,
      });
      const previousRows = comparisonPeriod ? filterDashboardData({
        data,
        system,
        period: comparisonPeriod,
        periods: new Set([comparisonPeriod]),
        selectedCreditors: selectedCredores,
        businessDayMap: businessDayIndexMap(comparisonPeriod),
        selectedBusinessDayLimit,
      }) : null;
      const monthMetrics = summarizeDashboardMetrics(rows);
      const comparisonMetrics = previousRows ? summarizeDashboardMetrics(previousRows) : null;
      const totalPagoVariation = variation(monthMetrics.totalPago, comparisonMetrics?.totalPago);
      const acordosVariation = variation(monthMetrics.acordos, comparisonMetrics?.acordos);

      return {
        period: key,
        label: periodLabel(key),
        totalPago: monthMetrics.totalPago,
        capital: monthMetrics.capital,
        acordos: monthMetrics.acordos,
        acessos: monthMetrics.acessos,
        conversao: monthMetrics.conversao,
        ticket: monthMetrics.ticketPorAcordo,
        totalPagoVariation,
        acordosVariation,
      };
    });
  }, [businessDayMap, data, isMultiPeriod, previousBusinessDayMap, previousPeriodKey, primaryPeriod, selectedBusinessDayLimit, selectedCredores, selectedPeriodList, system]);
  const resultComparisonRows = useMemo(() => [
    { name: 'Total Pago', atual: metrics.totalPago, anterior: previousMetrics?.totalPago, variation: variation(metrics.totalPago, previousMetrics?.totalPago), formatter: money },
    { name: 'Capital Recuperado', atual: metrics.capital, anterior: previousMetrics?.capital, variation: variation(metrics.capital, previousMetrics?.capital), formatter: money },
    { name: 'Acordos', atual: metrics.acordos, anterior: previousMetrics?.acordos, variation: variation(metrics.acordos, previousMetrics?.acordos), formatter: number },
    { name: 'Acessos', atual: metrics.acessos, anterior: previousMetrics?.acessos, variation: variation(metrics.acessos, previousMetrics?.acessos), formatter: number },
    { name: 'Conversão', atual: metrics.conversao, anterior: previousMetrics?.conversao, variation: variation(metrics.conversao, previousMetrics?.conversao), formatter: (value: number) => `${value.toFixed(1)}%` },
  ], [metrics, previousMetrics]);

  const componentRows = useMemo(() => {
    const rows = [
      { name: 'Capital Pago', value: filtered.baixas.reduce((sum, row) => sum + safe(row.capital_pago), 0), color },
      { name: 'Juros', value: filtered.baixas.reduce((sum, row) => sum + safe(row.juros_pago), 0), color: COLORS.gold },
      { name: 'Multa', value: filtered.baixas.reduce((sum, row) => sum + safe(row.multa_pago), 0), color: COLORS.rust },
      { name: 'Honorários', value: filtered.baixas.reduce((sum, row) => sum + safe(row.honorarios_pago_portal), 0), color: COLORS.sky },
    ];
    return rows.filter((row) => row.value > 0);
  }, [color, filtered.baixas]);

  const acessosCredorRows = useMemo(() => {
    const groups = groupBy(filtered.acessos.filter((row) => row.situacao === 'COM ACORDO' && row.credor && row.credor !== 'OUTROS'), (row) => row.credor || 'OUTROS');
    return Object.entries(groups).map(([name, rows]) => ({ name, value: rows.length })).sort((a, b) => b.value - a.value);
  }, [filtered.acessos]);

  const acordosRows = useMemo(() => {
    const groups = groupBy(filtered.acordos, (row) => row.credor || 'OUTROS');
    return Object.entries(groups).map(([name, rows]) => ({ name, value: rows.length })).sort((a, b) => b.value - a.value);
  }, [filtered.acordos]);

  const ticketRows = useMemo(() => {
    const groups = groupBy(filtered.baixas, (row) => row.credor || 'OUTROS');
    return Object.entries(groups)
      .map(([name, rows]) => {
        const total = rows.reduce((sum, row) => sum + safe(row.total_pago_portal), 0);
        return { name, total, qtd: rows.length, ticket: rows.length > 0 ? total / rows.length : 0 };
      })
      .sort((a, b) => b.total - a.total);
  }, [filtered.baixas]);

  const receitaDiaria = useMemo(() => {
    const groups = groupBy(filtered.baixas, (row) => row.data);
    return Object.entries(groups)
      .map(([date, rows]) => ({ date, label: dayLabel(date), businessDay: businessDayMap.get(date) ?? 0, receita: rows.reduce((sum, row) => sum + safe(row.total_pago_portal), 0) }))
      .filter((row) => row.businessDay > 0)
      .sort((a, b) => a.businessDay - b.businessDay || a.date.localeCompare(b.date));
  }, [businessDayMap, filtered.baixas]);

  const acordosDiarios = useMemo(() => {
    const groups = groupBy(filtered.acordos, (row) => row.data);
    return Object.entries(groups)
      .map(([date, rows]) => ({ date, label: dayLabel(date), businessDay: businessDayMap.get(date) ?? 0, acordos: rows.length }))
      .filter((row) => row.businessDay > 0)
      .sort((a, b) => a.businessDay - b.businessDay || a.date.localeCompare(b.date));
  }, [businessDayMap, filtered.acordos]);

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
    const rowsByBusinessDay = new Map<number, Record<string, string | number>>();

    filtered.acordos.forEach((row) => {
      const businessDay = businessDayMap.get(row.data);
      if (!businessDay) return;
      const periodKey = monthKey(row.data);
      const series = periodSeries.find((item) => item.period === periodKey);
      if (!series) return;

      const current = rowsByBusinessDay.get(businessDay) ?? { businessDay, label: `${businessDay}º dia útil` };
      current[series.key] = safe(current[series.key] as number) + 1;
      current[`${series.key}_date`] = dayLabel(row.data);
      rowsByBusinessDay.set(businessDay, current);
    });

    return Array.from(rowsByBusinessDay.values()).sort((a, b) => Number(a.businessDay) - Number(b.businessDay));
  }, [businessDayMap, filtered.acordos, periodSeries]);

  const topDays = useMemo(() => {
    const acessosByDay = groupBy(filtered.acessos, (row) => row.data);
    return acordosDiarios
      .map((row) => ({
        ...row,
        conversao: acessosByDay[row.date]?.length ? (row.acordos / acessosByDay[row.date].length) * 100 : 0,
      }))
      .sort((a, b) => b.acordos - a.acordos)
      .slice(0, 5);
  }, [acordosDiarios, filtered.acessos]);

  const hourlyConversionRows = useMemo(() => {
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
      .map((row) => ({ ...row, conversao: row.acessos > 0 ? (row.acordos / row.acessos) * 100 : 0 }))
      .filter((row) => row.acessos > 0 || row.acordos > 0);
  }, [filtered.acessos, filtered.acordos]);

  const conversionCredorRows = useMemo(() => {
    const acessosByCredor = groupBy(filtered.acessos.filter((row) => row.credor), (row) => row.credor || 'OUTROS');
    const acordosByCredor = groupBy(filtered.acordos.filter((row) => row.credor), (row) => row.credor || 'OUTROS');
    const names = new Set([...Object.keys(acessosByCredor), ...Object.keys(acordosByCredor)]);

    return Array.from(names)
      .map((name) => {
        const acessos = acessosByCredor[name]?.length ?? 0;
        const acordos = acordosByCredor[name]?.length ?? 0;
        return { name, acessos, acordos, conversao: acessos > 0 ? (acordos / acessos) * 100 : 0 };
      })
      .filter((row) => row.acessos > 0)
      .sort((a, b) => b.conversao - a.conversao || b.acordos - a.acordos);
  }, [filtered.acessos, filtered.acordos]);

  const negociadores = useMemo(() => {
    const groups = groupBy(filtered.baixas, (row) => row.negociador || 'Sem negociador');
    return Object.entries(groups)
      .map(([name, rows]) => ({
        name,
        total: rows.reduce((sum, row) => sum + safe(row.total_pago_portal), 0),
        qtd: rows.length,
      }))
      .sort((a, b) => b.total - a.total);
  }, [filtered.baixas]);

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
  const cliquesPortal = whatsappCampaignEnabled ? whatsappCampaignTotals.clicked : metrics.acessos;
  const acessosPortal = metrics.acessos;
  const whatsappEnvios = whatsappCampaignEnabled ? whatsappCampaignTotals.envios : storedWhatsappEnvios;
  const whatsappCusto = whatsappCampaignEnabled ? whatsappCampaignTotals.custo : storedWhatsappEnvios * 0.05;
  const totalEnviosCanal = emailEnvios + whatsappEnvios;
  const enviosMensuraveis = whatsappEnvios;
  const funnelRows = [
    { name: 'Envio WhatsApp -> clique', value: enviosMensuraveis > 0 ? (cliquesPortal / enviosMensuraveis) * 100 : 0 },
    { name: 'Clique -> acesso', value: cliquesPortal > 0 ? (acessosPortal / cliquesPortal) * 100 : 0 },
    { name: 'Acesso -> acordo', value: acessosPortal > 0 ? (metrics.acordos / acessosPortal) * 100 : 0 },
    { name: 'WhatsApp -> acordo', value: enviosMensuraveis > 0 ? (metrics.acordos / enviosMensuraveis) * 100 : 0 },
  ];
  const channelCostRows = useMemo(() => {
    const emailCost = communicationCosts.emailCost;
    const whatsappCost = whatsappCusto;
    return [
      { canal: 'E-mail', envios: emailEnvios, custo: emailCost },
      { canal: 'WhatsApp', envios: whatsappEnvios, custo: whatsappCost },
    ].map((row) => ({
      ...row,
      custoPorAcesso: metrics.acessos > 0 ? row.custo / metrics.acessos : 0,
      custoPorAcordo: metrics.acordos > 0 ? row.custo / metrics.acordos : 0,
      custoPorEnvio: row.envios > 0 ? row.custo / row.envios : 0,
    }));
  }, [communicationCosts.emailCost, emailEnvios, metrics.acessos, metrics.acordos, whatsappCusto, whatsappEnvios]);
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
  }, [comunicacaoView.envios.emails, comunicacaoView.mensal, data.acessos, data.acordos, primaryPeriod, system, whatsappCampaignEnabled, whatsappCampaignTotals.clicked, whatsappCampaignTotals.envios]);
  const selectedLabel = noCreditorSelected ? 'Nenhum' : selectedCredores.size === 0 || selectedCredores.size === allCredores.length ? 'Todos' : `${selectedCredores.size}/${allCredores.length}`;
  const selectedPeriodLabel = selectedPeriodList.length === 1 ? periodLabel(primaryPeriod) : `${selectedPeriodList.length} meses`;
  const selectedPeriodTitle = selectedPeriodList.length === 1 ? periodLabel(primaryPeriod, true) : `${selectedPeriodList.length} meses selecionados`;
  const selectedPeriodRange = selectedPeriodList.length === 1 ? periodRangeLabel(primaryPeriod) : `${periodLabel([...selectedPeriodList].sort()[0] ?? primaryPeriod)} a ${periodLabel(selectedPeriodList[0] ?? primaryPeriod)}`;
  const visiblePeriodList = useMemo(() => Array.from(visiblePeriods).sort().reverse(), [visiblePeriods]);
  const visiblePrimaryPeriod = visiblePeriodList[0] ?? primaryPeriod;
  const visiblePeriodLabel = dateFilterIgnored ? 'Não aplicado' : visiblePeriodList.length === 1 ? periodLabel(visiblePrimaryPeriod) : `${visiblePeriodList.length} meses`;
  const portfolioPeriodTitle = portfolioPeriodList.length === 1 ? periodLabel(primaryPortfolioPeriod, true) : `${portfolioPeriodList.length} meses selecionados`;
  const portfolioPeriodRange = portfolioPeriodList.length === 1 ? periodRangeLabel(primaryPortfolioPeriod) : `${periodLabel([...portfolioPeriodList].sort()[0] ?? primaryPortfolioPeriod)} a ${periodLabel(primaryPortfolioPeriod)}`;
  const activeBaseCredorRows = useMemo(
    () => activeBaseReport.by_credor.map((row) => ({ name: row.credor, value: row.processos })),
    [activeBaseReport.by_credor]
  );
  const activeBaseAgingRows = useMemo(() => {
    const order = ['0-90', '91-180', '181-360', '361+', 'SEM VENCIMENTO'];
    const labels: Record<string, string> = {
      '0-90': '0 a 90 dias',
      '91-180': '91 a 180 dias',
      '181-360': '181 a 360 dias',
      '361+': '361+ dias',
      'SEM VENCIMENTO': 'Sem vencimento',
    };
    const byRange = new Map(activeBaseReport.aging.map((row) => [row.faixa, row.processos]));
    return order.map((range) => ({ name: labels[range] ?? range, value: byRange.get(range) ?? 0 }));
  }, [activeBaseReport.aging]);
  const activeBaseStatusLabel =
    activeBaseReport.aging_complete || activeBaseReport.status === 'ready'
      ? 'Cache atualizado'
      : activeBaseReport.status === 'refreshing'
        ? 'Cache atualizando'
        : activeBaseReport.status === 'partial'
          ? 'Vencimentos pendentes'
          : activeBaseReport.status === 'error'
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
      current[series.key] = safe(current[series.key] as number) + safe(row.tottit || row.valor_imp);
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
        const valorEntrada = rows.reduce((sum, row) => sum + safe(row.tottit || row.valor_imp), 0);
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
        valorEntrada: rows.reduce((sum, row) => sum + safe(row.tottit || row.valor_imp), 0),
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

  return (
    <div className={`dashboard-shell theme-${theme} ${presentationMode ? 'presentation-mode' : ''}`}>
      {presentationMode ? (
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
          <button type="button" className="control-btn" onClick={() => setTheme(theme === 'sisth' ? 'night' : 'sisth')}>
            Tema {theme === 'sisth' ? 'Escuro' : 'Claro'}
          </button>
          <button type="button" className="control-btn presentation-trigger" onClick={() => {
            setPresentationMode(true);
            setPresentationPaused(false);
          }}>
            <Presentation size={16} />
            Apresentar
          </button>
          <button type="button" className="control-btn" onClick={() => window.print()}>
            <Printer size={16} />
            PDF
          </button>
        </div>
      </div>

      <div className="tab-bar" role="tablist" aria-label="Abas do relatório">
        <button className={tab === 'relatorio' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'relatorio'} onClick={() => setTab('relatorio')}>Resultados</button>
        <button className={tab === 'custos' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'custos'} onClick={() => setTab('custos')}>Custos</button>
        <button className={tab === 'performance' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'performance'} onClick={() => setTab('performance')}>Performance</button>
        <button className={tab === 'carteiras' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'carteiras'} onClick={() => setTab('carteiras')}>Carteiras</button>
        <button className={tab === 'base-ativa' ? 'active' : ''} type="button" role="tab" aria-selected={tab === 'base-ativa'} onClick={() => setTab('base-ativa')}>Bases</button>
      </div>

      {demoMode ? (
        <div className="demo-banner" role="note">
          <strong>Modo demo</strong>
          <span>Dados 100% fictícios para apresentação pública. A API real não é chamada nesta visualização.</span>
        </div>
      ) : null}

      {loading ? <div className="loading-state" role="status" aria-live="polite">Carregando dados do portal...</div> : null}
      {error ? <div className="error-state" role="alert">{error}</div> : null}

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
              <MetricCard tone="teal" label="Total Pago" value={compactMoney(metrics.totalPago)} current={metrics.totalPago} previous={previousMetrics?.totalPago} small="Capital + Taxas" summary="Total recuperado no período selecionado." />
              <MetricCard tone="gold" label="Capital Recuperado" value={compactMoney(metrics.capital)} current={metrics.capital} previous={previousMetrics?.capital} small="Valor capital" summary="Capital recuperado sem juros, multa e honorários." />
              <MetricCard tone="rust" label="Acordos" value={number(metrics.acordos)} current={metrics.acordos} previous={previousMetrics?.acordos} small="Formalizados" summary="Quantidade de acordos formalizados no período." />
              <MetricCard tone="sky" label="Credores Atendidos" value={number(metrics.credores)} current={metrics.credores} previous={previousMetrics?.credores} small="Grupos distintos" summary="Quantidade de credores com movimentação no relatório." />
              <MetricCard tone="teal" label="Acessos" value={number(metrics.acessos)} current={metrics.acessos} previous={previousMetrics?.acessos} small="Visitantes únicos" summary="Acessos registrados no Portal do Acordo." />
            </div>
          </header>

          <main className="main-content">
            {system === 'total' ? (
              <div className="notice">
                <strong>Modo Total:</strong> os acessos sem acordo são compartilhados entre Consulth e Sisth; o total exibido não é duplicado.
              </div>
            ) : null}

            <Section num="01" title="Projeção do Mês">
              <div className="grid-2">
                <Panel title="Valores até o final do mês" meta={`${number(projectionBaseDays)} de ${number(businessDays)} dias úteis considerados`}>
                  <div className="chart-wrap small">
                    <ResponsiveContainer>
                      <BarChart data={projectionRows}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="name" tick={{ fontSize: 10 }} />
                        <YAxis tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number, name: string) => [money(value), name]} />
                        <Legend verticalAlign="top" height={28} />
                        <Bar dataKey="atual" name="Atual" fill={COLORS.sky} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        <Bar dataKey="projetado" name="Projetado" fill={COLORS.green} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
                <Panel title="Resumo da projeção">
                  <table>
                    <thead>
                      <tr><th>Indicador</th><th className="right">Atual</th><th className="right">Projetado</th></tr>
                    </thead>
                    <tbody>
                      {projectionRows.map((row) => (
                        <tr key={row.name}>
                          <td className="bold">{row.name}</td>
                          <td className="right">{money(row.atual)}</td>
                          <td className="right">{money(row.projetado)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              </div>
            </Section>

            <Section num="02" title={isMultiPeriod ? 'Resumo por Mês' : 'Comparativo com Mês Anterior'}>
              <div className="grid-2">
                <Panel title="Indicadores principais" meta={selectedBusinessDayLimit ? `${selectedBusinessDayLimit} primeiros dias úteis` : 'Período completo'}>
                  <table>
                    <thead>
                      <tr><th>Indicador</th><th className="right">Atual</th><th className="right">Base anterior</th><th className="right">Variação</th></tr>
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
                <Panel title="Evolução mensal filtrada" meta="Mesmo recorte de dias úteis">
                  <table>
                    <thead>
                      <tr><th>Mês</th><th className="right">Total Pago</th><th className="right">Var.</th><th className="right">Acordos</th><th className="right">Conv.</th></tr>
                    </thead>
                    <tbody>
                      {resultMonthlyRows.map((row) => (
                        <tr key={row.period}>
                          <td className="bold">{row.label}</td>
                          <td className="right">{money(row.totalPago)}</td>
                          <td className={`right variation-cell ${row.totalPagoVariation !== null && row.totalPagoVariation >= 0 ? 'positive' : 'negative'}`}>{variationLabel(row.totalPagoVariation)}</td>
                          <td className="right">{number(row.acordos)}</td>
                          <td className="right muted">{row.conversao.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Panel>
              </div>
            </Section>

            <Section num="03" title="Remuneração">
              <div className="grid-2">
                <Panel title="Detalhamento por Componente">
                  <table>
                    <thead>
                      <tr><th>Componente</th><th className="right">Valor</th><th className="right">%</th></tr>
                    </thead>
                    <tbody>
                      {componentRows.map((row) => (
                        <tr key={row.name}>
                          <td className="with-swatch"><span style={{ background: row.color }} />{row.name}</td>
                          <td className="right">{money(row.value)}</td>
                          <td className="right muted">{percent(row.value, metrics.totalPago)}</td>
                        </tr>
                      ))}
                    </tbody>
                    <tfoot>
                      <tr><td>Total Pago</td><td className="right">{money(metrics.totalPago)}</td><td className="right">100%</td></tr>
                    </tfoot>
                  </table>
                </Panel>
                <Panel title="Composição da Remuneração" meta="Valores por componente">
                  <div className="chart-wrap">
                    <ResponsiveContainer>
                      <PieChart>
                        <Pie data={componentRows} dataKey="value" nameKey="name" innerRadius={68} outerRadius={96} paddingAngle={2} isAnimationActive={CHART_ANIMATION_ACTIVE}>
                          {componentRows.map((row) => <Cell key={row.name} fill={row.color} />)}
                        </Pie>
                        <Tooltip formatter={(value: number, name: string) => [money(value), name]} />
                        <Legend verticalAlign="bottom" height={36} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              </div>
            </Section>

            <Section num="04" title="Acordos Formalizados">
              <div className="grid-2">
                <Panel title="Acordos por Credor / Grupo" meta={`Top 5 de ${number(metrics.acordos)} processos`}>
                  {(expanded) => <BarRows rows={expanded ? acordosRows : acordosRows.slice(0, 5)} color={color} valueLabel="Qtd." showPercent />}
                </Panel>
                <Panel title="Distribuição Visual" summary="Clique para expandir e ver todos os credores do sistema selecionado.">
                  {(expanded) => {
                    const rows = expanded ? acordosRows : acordosRows.slice(0, 5);
                    return (
                      <div className="chart-wrap">
                        <ResponsiveContainer>
                          <BarChart data={rows}>
                            <CartesianGrid strokeDasharray="3 3" vertical={false} />
                            <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-20} textAnchor="end" height={70} />
                            <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                            <Tooltip formatter={(value: number) => [`${value} acordos`, 'Quantidade']} />
                            <Legend verticalAlign="top" height={28} />
                            <Bar dataKey="value" name="Quantidade de acordos" fill={chartAccent} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE}>
                              {rows.map((row, index) => <Cell key={row.name} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />)}
                            </Bar>
                          </BarChart>
                        </ResponsiveContainer>
                      </div>
                    );
                  }}
                </Panel>
              </div>
            </Section>

            <Section num="05" title="Ticket Médio por Credor">
              <div className="grid-2">
                <Panel title="Ranking - Ticket Médio" className="ticket-panel">
                  {(expanded) => (
                    <BarRows rows={(expanded ? ticketRows : ticketRows.slice(0, 5)).map((row) => ({ name: row.name, value: row.total }))} color={color} valueFormatter={money} valueLabel="Total Pago" />
                  )}
                </Panel>
                <Panel title="Detalhamento">
                  {(expanded) => (
                    <table>
                      <thead>
                        <tr><th>#</th><th>Credor / Grupo</th><th className="right">Total Pago</th><th className="right">Qtd.</th><th className="right">Ticket Médio</th></tr>
                      </thead>
                      <tbody>
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

            <Section num="06" title="Evolução Diária">
              <div className="grid-2">
                <Panel title="Receita Diária" meta="Por data de baixa">
                  <div className="chart-wrap small">
                    <ResponsiveContainer>
                      <LineChart data={isMultiPeriod ? dailyRevenueComparisonRows : receitaDiaria}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
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
                <Panel title="Acordos por Dia Útil">
                  <div className="chart-wrap small">
                    <ResponsiveContainer>
                      <BarChart data={isMultiPeriod ? dailyAgreementComparisonRows : acordosDiarios}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number, name: string, item) => [`${value} acordos`, isMultiPeriod ? comparisonTooltipName(name, item) : name]} />
                        <Legend verticalAlign="top" height={28} />
                        {isMultiPeriod ? periodSeries.map((item) => (
                          <Bar key={item.key} dataKey={item.key} name={item.label} fill={item.color} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        )) : (
                          <Bar dataKey="acordos" name="Acordos por dia útil" fill={chartAccent} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE}>
                            {acordosDiarios.map((row, index) => <Cell key={row.date} fill={CHART_PALETTE[index % CHART_PALETTE.length]} />)}
                          </Bar>
                        )}
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </Panel>
              </div>
            </Section>

            <Section num="07" title="Top Dias de Conversão">
              <Panel title="Maiores volumes de acordos no período" meta={`Top ${topDays.length}`}>
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
            </Section>

            <Section num="08" title="Pagamentos por Negociador">
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

      {!loading && !error && tab === 'custos' ? (
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

      {!loading && !error && tab === 'base-ativa' ? (
        <>
          <header className="hero">
            <div className="hero-top">
              <div>
                <div className="logos">
                  <img src={logoUrl} alt="Portal do Acordo" />
                </div>
                <p>Bases</p>
                <h1><span>{systemLabel(system)}</span></h1>
              </div>
              <div className="hero-meta">
                <strong>{number(activeBaseReport.total_processos)} processos</strong>
                <span>{noCreditorSelected ? 'Nenhum credor selecionado' : selectedCredores.size === 0 ? 'Todos os credores' : `${number(selectedCredores.size)} credores selecionados`}</span>
                <span>{activeBaseStatusLabel}</span>
                <em>{activeBaseReport.aging_complete ? dateTime(activeBaseReport.aging_updated_at ?? activeBaseReport.updated_at) : dateTime(activeBaseReport.updated_at)}</em>
              </div>
            </div>
            <div className="kpi-row">
              <MetricCard tone="teal" label="Processos ativos" value={number(activeBaseReport.total_processos)} current={activeBaseReport.total_processos} small="Ativos no portal" summary="Processos com credor ATIVO e status diferente de devolução, baixado ou quitado." />
              <MetricCard tone="gold" label="Credores" value={number(activeBaseReport.total_credores)} current={activeBaseReport.total_credores} small="Grupos distintos" summary="Quantidade de grupos de credores na base ativa filtrada." />
              <MetricCard tone="sky" label="Vencimentos" value={activeBaseReport.aging_complete ? 'OK' : 'Atualizando'} current={activeBaseReport.aging_complete ? 1 : 0} small="Menor vencimento por processo" summary="Processos agrupados pela idade do menor vencimento." />
              <MetricCard tone="rust" label="Faixa crítica" value={number(activeBaseAgingRows.find((row) => row.name === '361+ dias')?.value ?? 0)} current={activeBaseAgingRows.find((row) => row.name === '361+ dias')?.value ?? 0} small="361+ dias" summary="Processos com menor vencimento acima de 360 dias." />
            </div>
          </header>

          <main className="main-content">
            {activeBaseLoading ? <div className="loading-state">Carregando bases...</div> : null}
            {activeBaseError ? <div className="error-state">{activeBaseError}</div> : null}
            {!activeBaseLoading && !activeBaseError ? (
              <>
                {!activeBaseReport.aging_complete && activeBaseReport.status !== 'ready' ? (
                  <div className={activeBaseReport.status === 'error' ? 'error-state' : 'loading-state'}>
                    {activeBaseReport.error ??
                      (activeBaseReport.status === 'partial'
                        ? 'Os processos por credor já foram carregados. Os vencimentos ainda não terminaram dentro do tempo limite.'
                        : 'As Bases estão sendo atualizadas em segundo plano. Quando terminar, a tela passa a usar o cache local.')}
                  </div>
                ) : null}

                <Section num="01" title="Bases por Credor">
                  <Panel title="Distribuição de processos" meta={`Top ${Math.min(activeBaseCredorRows.length, 10)}`}>
                    {(expanded) => <BarRows rows={expanded ? activeBaseCredorRows : activeBaseCredorRows.slice(0, 10)} color={color} valueLabel="Processos" />}
                  </Panel>
                </Section>

                <Section num="02" title="Vencimentos das Bases">
                  <Panel title="Processos por faixa de vencimento" meta="Menor vencimento por processo">
                    <BarRows rows={activeBaseAgingRows} color={color} valueLabel="Processos" showPercent />
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
              <MetricCard tone="gold" label="Cliques" value={number(cliquesPortal)} current={cliquesPortal} small={whatsappCampaignEnabled ? 'Cliques pelo WhatsApp' : 'Eventos do portal'} summary="Cliques no link usados no funil de performance." />
              <MetricCard tone="sky" label="Acessos" value={number(acessosPortal)} current={acessosPortal} previous={previousMetrics?.acessos} small="Acessos no site" summary="Acessos registrados no Portal do Acordo." />
              <MetricCard tone="rust" label="Conversão" value={`${metrics.conversao.toFixed(1)}%`} current={metrics.conversao} previous={previousMetrics?.conversao} small={`${number(metrics.acordos)} acordos`} summary="Conversão de acessos em acordos no período." />
            </div>
          </header>

          <main className="main-content">

          <Section num="01" title="Acessos e Conversão">
            <div className="grid-2">
              <Panel title="Distribuição de Acessos">
                <div className="access-meter">
                  <div style={{ width: `${metrics.acessos > 0 ? (metrics.acessosComAcordo / metrics.acessos) * 100 : 0}%`, background: chartAccent }} />
                </div>
                <div className="stat-list">
                  <span>Total de acessos <strong>{number(metrics.acessos)}</strong></span>
                  <span>Com acordo <strong>{number(metrics.acessosComAcordo)}</strong></span>
                  <span>Sem acordo <strong>{number(metrics.acessosSemAcordo)}</strong></span>
                  <span>Taxa de conversão <strong>{metrics.acessos > 0 ? ((metrics.acessosComAcordo / metrics.acessos) * 100).toFixed(1) : '0.0'}%</strong></span>
                </div>
              </Panel>
              <Panel title="Acessos com Acordo por Credor" meta="Top 5">
                {(expanded) => <BarRows rows={expanded ? acessosCredorRows : acessosCredorRows.slice(0, 5)} color={color} valueLabel="Qtd." />}
              </Panel>
            </div>
          </Section>

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

          {whatsappCampaignEnabled ? (
            <Section num="03" title="WhatsApp por Credor">
              <Panel title="Top 5 envios WhatsApp" meta={`${money(whatsappCampaignTotals.custo)} em ${number(whatsappCampaignTotals.envios)} mensagens · ${number(whatsappCampaignMatched)} telefones identificados`}>
                {(expanded) => (
                  <table>
                    <thead>
                      <tr><th>Credor / Grupo</th><th className="right">Envios</th><th className="right">Cliques</th><th className="right">Acessos</th><th className="right">Acordos</th><th className="right">Cliques/envios</th><th className="right">Acessos/envios</th><th className="right">Conv. envio/acordo</th><th className="right">Custo</th></tr>
                    </thead>
                    <tbody>
                      {(expanded ? whatsappPerformanceRows : whatsappPerformanceRows.slice(0, 5)).map((row) => (
                        <tr key={row.credor}>
                          <td className="bold">{row.credor}</td>
                          <td className="right">{number(row.envios)}</td>
                          <td className="right muted">{number(row.clicked)}</td>
                          <td className="right">{number(row.acessos)}</td>
                          <td className="right">{number(row.acordos)}</td>
                          <td className="right">{row.envios > 0 ? ((row.clicked / row.envios) * 100).toFixed(1) : '0.0'}%</td>
                          <td className="right">{row.taxaAcesso.toFixed(1)}%</td>
                          <td className="right">{row.taxaAcordo.toFixed(1)}%</td>
                          <td className="right">{money(row.custo)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </Panel>
            </Section>
          ) : null}

          <Section num="04" title="Indicadores de Conversão">
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
              <Panel title="Tabela Resumida">
                <table>
                  <thead>
                    <tr><th>Etapa</th><th className="right">Volume</th><th className="right">Conversão</th></tr>
                  </thead>
                  <tbody>
                    <tr><td>Envios WhatsApp</td><td className="right">{number(enviosMensuraveis)}</td><td className="right muted">100%</td></tr>
                    <tr><td>Cliques</td><td className="right">{number(cliquesPortal)}</td><td className="right">{funnelRows[0].value.toFixed(1)}%</td></tr>
                    <tr><td>Acessos / cadastros</td><td className="right">{number(acessosPortal)}</td><td className="right">{funnelRows[1].value.toFixed(1)}%</td></tr>
                    <tr><td>Acordos</td><td className="right">{number(metrics.acordos)}</td><td className="right">{funnelRows[2].value.toFixed(1)}%</td></tr>
                  </tbody>
                </table>
              </Panel>
            </div>
          </Section>

          <Section num="05" title="Comparativo Mensal">
            <div className="grid-2">
              <Panel title="Volume de Envios">
                <div className="chart-wrap small">
                  <ResponsiveContainer>
                    <BarChart data={monthlyEvolution}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                      <YAxis tick={{ fontSize: 10 }} />
                      <Tooltip formatter={(value: number, name: string) => [number(value), name]} />
                      <Legend verticalAlign="top" height={28} />
                      <Bar dataKey="emails" name="E-mails" fill={COLORS.sky} stackId="envios" radius={[0, 0, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                      <Bar dataKey="whatsapp" name="WhatsApp" fill={COLORS.green} stackId="envios" radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                    </BarChart>
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

          <Section num="06" title="Performance por Horário">
            <div className="grid-2">
              <Panel title="Conversão por faixa de horário">
                {hourlyConversionRows.length === 0 ? (
                  <div className="empty-state">O banco está retornando apenas a data, sem hora real. Assim que existir uma coluna com horário, este gráfico passa a mostrar a conversão por faixa.</div>
                ) : (
                  <div className="chart-wrap small">
                    <ResponsiveContainer>
                      <ComposedChart data={hourlyConversionRows}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} />
                        <XAxis dataKey="label" tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="volume" allowDecimals={false} tick={{ fontSize: 10 }} />
                        <YAxis yAxisId="rate" orientation="right" tickFormatter={(value) => `${value}%`} tick={{ fontSize: 10 }} />
                        <Tooltip formatter={(value: number, name: string) => [name === 'Conversão' ? `${value.toFixed(1)}%` : number(value), name]} />
                        <Legend verticalAlign="top" height={28} />
                        <Bar yAxisId="volume" dataKey="acessos" name="Acessos" fill={COLORS.sky} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        <Bar yAxisId="volume" dataKey="acordos" name="Acordos" fill={COLORS.rust} radius={[4, 4, 0, 0]} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                        <Line yAxisId="rate" type="monotone" dataKey="conversao" name="Conversão" stroke={COLORS.green} strokeWidth={2.5} isAnimationActive={CHART_ANIMATION_ACTIVE} />
                      </ComposedChart>
                    </ResponsiveContainer>
                  </div>
                )}
              </Panel>
              <Panel title="Melhores horários" meta="Ordenado por conversão">
                <table>
                  <thead>
                    <tr><th>Horário</th><th className="right">Acessos</th><th className="right">Acordos</th><th className="right">Conversão</th></tr>
                  </thead>
                  <tbody>
                    {hourlyConversionRows.length === 0 ? <tr><td colSpan={4} className="muted">Sem horário nos dados carregados.</td></tr> : null}
                    {[...hourlyConversionRows].sort((a, b) => b.conversao - a.conversao || b.acordos - a.acordos).slice(0, 8).map((row) => (
                      <tr key={row.hour}>
                        <td className="bold">{row.label}</td>
                        <td className="right">{number(row.acessos)}</td>
                        <td className="right">{number(row.acordos)}</td>
                        <td className="right">{row.conversao.toFixed(1)}%</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </Panel>
            </div>
          </Section>

          <Section num="07" title="Custo por Canal">
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
          </Section>

          <Section num="08" title="Credores por Conversão">
            <Panel title="Top credores por taxa de conversão" meta="Acordos / acessos">
              {(expanded) => (
                <table>
                  <thead>
                    <tr><th>Credor / Grupo</th><th className="right">Acessos</th><th className="right">Acordos</th><th className="right">Conversão</th></tr>
                  </thead>
                  <tbody>
                    {conversionCredorRows.length === 0 ? <tr><td colSpan={4} className="muted">Sem dados no período.</td></tr> : null}
                    {(expanded ? conversionCredorRows : conversionCredorRows.slice(0, 5)).map((row) => (
                      <tr key={row.name}>
                        <td className="bold">{row.name}</td>
                        <td className="right">{number(row.acessos)}</td>
                        <td className="right">{number(row.acordos)}</td>
                        <td className="right">{row.conversao.toFixed(1)}%</td>
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

      <footer className="footer">Relatório atualizado em {new Date().toLocaleDateString('pt-BR')}</footer>
    </div>
  );
}

export default DashboardPage;
