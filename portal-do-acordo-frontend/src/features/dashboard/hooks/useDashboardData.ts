import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  DEMO_DASHBOARD_DATA,
  DEMO_PRIMARY_PERIOD,
  getDemoActiveBase,
  getDemoBaseSummary,
  getDemoCommunication,
  getDemoCosts,
  getDemoPortfolio,
  isDemoMode,
} from '../data/demoDashboardData';
import { fetchActiveBase, fetchBaseSummary, fetchCommunication, fetchCosts, fetchCreditors, fetchDashboardData, fetchDashboardPerformanceSummary, fetchDashboardResultGraphs, fetchDashboardResultSummary, fetchEmailClicks, fetchPeriods, fetchPortfolio } from '../services/dashboardApi';
import type { ActiveBaseReport, BaseSummaryReport, CommunicationData, CostsData, DashboardData, DashboardPerformanceSummary, DashboardResultGraphs, DashboardResultSummary, EmailClickData, PortfolioEntry, SystemFilter } from '../types';
import { monthKey, previousPeriod } from '../utils/dates';

const EMPTY_DASHBOARD_DATA: DashboardData = { baixas: [], acordos: [], acessos: [] };
const EMPTY_ACTIVE_BASE_REPORT: ActiveBaseReport = {
  updated_at: null,
  aging_updated_at: null,
  status: 'empty',
  total_processos: 0,
  total_credores: 0,
  aging_complete: false,
  by_credor: [],
  aging: [],
  aging_by_credor: [],
};
const EMPTY_BASE_SUMMARY_REPORT: BaseSummaryReport = {
  generated_at: '',
  updated_at: null,
  aging_updated_at: null,
  status: 'empty',
  total_processos: 0,
  total_credores: 0,
  valor_total_carteira: 0,
  total_borderos: 0,
  ticket_medio: 0,
  aging_complete: false,
  processos_por_credor: [],
  entrada_por_credor: [],
  aging: [],
};
const DASHBOARD_RESPONSE_CACHE_TTL_MS = 10 * 60 * 1000;
const dashboardResponseCache = new Map<string, { data: unknown; expiresAt: number }>();

function responseCacheKey(prefix: string, period: string, system: SystemFilter, selectedCreditors: Set<string>) {
  return `${prefix}:${period}:${system}:${Array.from(selectedCreditors).sort().join('|')}`;
}

function getCachedResponse<T>(key: string) {
  const cached = dashboardResponseCache.get(key);
  if (!cached) return undefined;
  if (cached.expiresAt <= Date.now()) {
    dashboardResponseCache.delete(key);
    return undefined;
  }

  return cached.data as T;
}

function setCachedResponse<T>(key: string, data: T) {
  dashboardResponseCache.set(key, { data, expiresAt: Date.now() + DASHBOARD_RESPONSE_CACHE_TTL_MS });
}

export function useDashboardData(selectedPeriods: Set<string>, system: SystemFilter, enabled: boolean, includePreviousPeriod = true) {
  const [cache, setCache] = useState<Record<string, DashboardData>>({});
  const [periods, setPeriods] = useState<string[]>(() => isDemoMode() ? getAvailablePeriods(DEMO_DASHBOARD_DATA) : [getCurrentPeriodKey()]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(() => isDemoMode() ? DEMO_PRIMARY_PERIOD : getCurrentPeriodKey());

  useEffect(() => {
    if (isDemoMode()) {
      setCache(Object.fromEntries(getAvailablePeriods(DEMO_DASHBOARD_DATA).map((item) => [item, filterDataByPeriod(DEMO_DASHBOARD_DATA, item)])));
      setPeriods(getAvailablePeriods(DEMO_DASHBOARD_DATA));
      setPeriod(DEMO_PRIMARY_PERIOD);
      setError('');
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    fetchPeriods(system, controller.signal)
      .then((result) => {
        const currentPeriod = getCurrentPeriodKey();
        const nextPeriods = result.length > 0 ? result : [currentPeriod];
        setPeriods(nextPeriods.includes(currentPeriod) ? nextPeriods : [currentPeriod, ...nextPeriods]);
      })
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
      });

    return () => {
      controller.abort();
    };
  }, [system]);

  const requestedPeriods = useMemo(() => {
    const basePeriods = selectedPeriods.size > 0 ? Array.from(selectedPeriods) : period ? [period] : [];
    return basePeriods.length === 1 && includePreviousPeriod ? Array.from(new Set([...basePeriods, previousPeriod(basePeriods[0])])) : basePeriods;
  }, [includePreviousPeriod, period, selectedPeriods]);

  useEffect(() => {
    if (!enabled || isDemoMode()) {
      setLoading(false);
      return undefined;
    }

    const missingPeriods = requestedPeriods.filter((item) => !cache[item]);
    if (missingPeriods.length === 0) {
      setLoading(false);
      return undefined;
    }

    const controller = new AbortController();
    let active = true;
    setLoading(true);

    Promise.all(missingPeriods.map((item) => fetchDashboardData(item, controller.signal).then((result) => [item, result] as const)))
      .then((results) => {
        if (!active) return;
        setCache((current) => ({
          ...current,
          ...Object.fromEntries(results),
        }));
        setError('');
      })
      .catch((err) => {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [cache, enabled, requestedPeriods]);

  const data = useMemo(
    () => mergeDashboardData(requestedPeriods.map((item) => cache[item]).filter(Boolean)),
    [cache, requestedPeriods]
  );

  const visiblePeriods = useMemo(
    () => period && !periods.includes(period) ? [period, ...periods] : periods,
    [period, periods]
  );

  return { data, loading, error, period, setPeriod, periods: visiblePeriods };
}

type SupplementalOptions = {
  costs?: boolean;
  communication?: boolean;
  communicationDaily?: boolean;
  emailClicks?: boolean;
  emailClicksEndDate?: string | null;
};

export function useDashboardSupplementalData(period: string, system: SystemFilter, selectedCreditors: Set<string>, options: SupplementalOptions = {}) {
  const [costs, setCosts] = useState<CostsData | null>(null);
  const [communication, setCommunication] = useState<CommunicationData | null>(null);
  const [emailClicks, setEmailClicks] = useState<EmailClickData | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [costsError, setCostsError] = useState('');
  const [costsRetryVersion, setCostsRetryVersion] = useState(0);
  const costsEnabled = options.costs ?? true;
  const communicationEnabled = options.communication ?? true;
  const communicationDailyEnabled = options.communicationDaily ?? false;
  const emailClicksEnabled = options.emailClicks ?? true;
  const emailClicksEndDate = options.emailClicksEndDate ?? null;

  useEffect(() => {
    const hasEnabledRequest = costsEnabled || communicationEnabled || emailClicksEnabled;
    if (!hasEnabledRequest || !period) {
      setLoading(false);
      setRefreshing(false);
      return;
    }
    if (isDemoMode()) {
      if (costsEnabled) setCosts(getDemoCosts(period, system));
      if (communicationEnabled) setCommunication(getDemoCommunication(period, system, selectedCreditors));
      if (emailClicksEnabled) setEmailClicks(null);
      setCostsError('');
      setLoading(false);
      setRefreshing(false);
      return;
    }

    const costsKey = responseCacheKey('costs', period, system, new Set());
    const communicationKey = `${responseCacheKey('communication', period, system, selectedCreditors)}:diario:${communicationDailyEnabled}`;
    const emailClicksKey = `${responseCacheKey('email-clicks', period, system, selectedCreditors)}:data-fim:${emailClicksEndDate ?? 'mes-completo'}`;
    const cachedCosts = costsEnabled ? getCachedResponse<CostsData>(costsKey) : undefined;
    const cachedCommunication = communicationEnabled ? getCachedResponse<CommunicationData>(communicationKey) : undefined;
    const cachedEmailClicks = emailClicksEnabled ? getCachedResponse<EmailClickData>(emailClicksKey) : undefined;
    const loadCosts = costsEnabled && !cachedCosts;
    const loadCommunication = communicationEnabled && !cachedCommunication;
    const loadEmailClicks = emailClicksEnabled && !cachedEmailClicks;

    if (cachedCosts) {
      setCosts(cachedCosts);
      setCostsError('');
    }
    if (cachedCommunication) setCommunication(cachedCommunication);
    if (cachedEmailClicks) setEmailClicks(cachedEmailClicks);
    if (!loadCosts && !loadCommunication && !loadEmailClicks) {
      setLoading(false);
      setRefreshing(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    const hasVisibleData =
      (!costsEnabled || Boolean(cachedCosts ?? costs)) &&
      (!communicationEnabled || Boolean(cachedCommunication ?? communication)) &&
      (!emailClicksEnabled || Boolean(cachedEmailClicks ?? emailClicks));
    setLoading(!hasVisibleData);
    setRefreshing(hasVisibleData);
    const preserveOnError = <T,>(request: Promise<T | null>, previous: T | null) =>
      request.then((data) => ({ data, fresh: true })).catch(() => ({ data: previous, fresh: false }));
    const preserveCostsOnError = (request: Promise<CostsData | null>, previous: CostsData | null) =>
      request
        .then((data) => {
          if (!data) {
            if (active) setCostsError('Nao foi possivel carregar os custos. Os ultimos dados disponiveis foram mantidos.');
            return { data: previous, fresh: false };
          }
          if (active) setCostsError('');
          return { data, fresh: true };
        })
        .catch((err) => {
          if (active && !(err instanceof DOMException && err.name === 'AbortError')) {
            setCostsError('Nao foi possivel carregar os custos. Os ultimos dados disponiveis foram mantidos.');
          }
          return { data: previous, fresh: false };
        });
    const preserveCurrent = <T,>(data: T | null) => Promise.resolve({ data, fresh: false });

    Promise.all([
      loadCosts ? preserveCostsOnError(fetchCosts(period, system, controller.signal), costs) : preserveCurrent(cachedCosts ?? costs),
      loadCommunication ? preserveOnError(fetchCommunication(period, system, selectedCreditors, controller.signal, communicationDailyEnabled), communication) : preserveCurrent(cachedCommunication ?? communication),
      loadEmailClicks ? preserveOnError(fetchEmailClicks(period, system, selectedCreditors, emailClicksEndDate, controller.signal), emailClicks) : preserveCurrent(cachedEmailClicks ?? emailClicks),
    ])
      .then(([costsResult, communicationResult, emailClicksResult]) => {
        if (!active) return;
        if (costsResult.fresh && costsResult.data) setCachedResponse(costsKey, costsResult.data);
        if (communicationResult.fresh && communicationResult.data) setCachedResponse(communicationKey, communicationResult.data);
        if (emailClicksResult.fresh && emailClicksResult.data) setCachedResponse(emailClicksKey, emailClicksResult.data);
        if (costsEnabled) setCosts(costsResult.data);
        if (communicationEnabled) setCommunication(communicationResult.data);
        if (emailClicksEnabled) setEmailClicks(emailClicksResult.data);
      })
      .finally(() => {
        if (!active) return;
        setLoading(false);
        setRefreshing(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [communicationDailyEnabled, communicationEnabled, costsEnabled, costsRetryVersion, emailClicksEnabled, emailClicksEndDate, period, selectedCreditors, system]);

  const retryCosts = useCallback(() => {
    setCostsError('');
    setCostsRetryVersion((current) => current + 1);
  }, []);

  return { costs, communication, emailClicks, loading, refreshing, costsError, retryCosts };
}

export function useCreditorsData(period: string, system: SystemFilter) {
  const [creditors, setCreditors] = useState<string[]>([]);

  useEffect(() => {
    if (!period) return;
    if (isDemoMode()) {
      setCreditors(getDemoActiveBase(system, new Set()).by_credor.map((row) => row.credor));
      return;
    }

    const controller = new AbortController();
    fetchCreditors(period, system, controller.signal)
      .then(setCreditors)
      .catch((err) => {
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setCreditors([]);
      });

    return () => controller.abort();
  }, [period, system]);

  return creditors;
}

export function useDashboardResultSummary(period: string, system: SystemFilter, selectedCreditors: Set<string>, enabled: boolean) {
  const [data, setData] = useState<DashboardResultSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !period || isDemoMode()) {
      setLoading(false);
      setError('');
      return undefined;
    }

    const cacheKey = responseCacheKey('dashboard-result-summary', period, system, selectedCreditors);
    const cached = getCachedResponse<DashboardResultSummary>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError('');
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);

    fetchDashboardResultSummary(period, system, selectedCreditors, controller.signal)
      .then((result) => {
        if (!active) return;
        if (result) setCachedResponse(cacheKey, result);
        setData(result);
      })
      .catch((err) => {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Erro ao carregar resumo de resultados.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, period, selectedCreditors, system]);

  return { resultSummary: data, resultSummaryLoading: loading, resultSummaryError: error };
}

export function useDashboardResultGraphs(period: string, system: SystemFilter, selectedCreditors: Set<string>, enabled: boolean) {
  const [data, setData] = useState<DashboardResultGraphs | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !period || isDemoMode()) {
      setLoading(false);
      setError('');
      return undefined;
    }

    const cacheKey = responseCacheKey('dashboard-result-graphs', period, system, selectedCreditors);
    const cached = getCachedResponse<DashboardResultGraphs>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError('');
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);

    fetchDashboardResultGraphs(period, system, selectedCreditors, controller.signal)
      .then((result) => {
        if (!active) return;
        if (result) setCachedResponse(cacheKey, result);
        setData(result);
      })
      .catch((err) => {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Erro ao carregar graficos de resultados.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, period, selectedCreditors, system]);

  return { resultGraphs: data, resultGraphsLoading: loading, resultGraphsError: error };
}

export function useDashboardPerformanceSummary(period: string, system: SystemFilter, selectedCreditors: Set<string>, enabled: boolean) {
  const [data, setData] = useState<DashboardPerformanceSummary | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled || !period || isDemoMode()) {
      setLoading(false);
      setError('');
      return undefined;
    }

    const cacheKey = responseCacheKey('dashboard-performance-summary', period, system, selectedCreditors);
    const cached = getCachedResponse<DashboardPerformanceSummary>(cacheKey);
    if (cached) {
      setData(cached);
      setLoading(false);
      setError('');
      return undefined;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);

    fetchDashboardPerformanceSummary(period, system, selectedCreditors, controller.signal)
      .then((result) => {
        if (!active) return;
        if (result) setCachedResponse(cacheKey, result);
        setData(result);
      })
      .catch((err) => {
        if (!active || (err instanceof DOMException && err.name === 'AbortError')) return;
        setData(null);
        setError(err instanceof Error ? err.message : 'Erro ao carregar resumo de performance.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, period, selectedCreditors, system]);

  return { performanceSummary: data, performanceSummaryLoading: loading, performanceSummaryError: error };
}

function filterDataByPeriod(data: DashboardData, period: string) {
  return {
    baixas: data.baixas.filter((row) => monthKey(row.data) === period),
    acordos: data.acordos.filter((row) => monthKey(row.data) === period),
    acessos: data.acessos.filter((row) => monthKey(row.data) === period),
  };
}

function mergeDashboardData(items: DashboardData[]) {
  return items.reduce<DashboardData>(
    (merged, item) => ({
      baixas: [...merged.baixas, ...item.baixas],
      acordos: [...merged.acordos, ...item.acordos],
      acessos: [...merged.acessos, ...item.acessos],
    }),
    EMPTY_DASHBOARD_DATA
  );
}

export function useActiveBaseData(system: SystemFilter, selectedCreditors: Set<string>, enabled: boolean) {
  const [data, setData] = useState<ActiveBaseReport>(EMPTY_ACTIVE_BASE_REPORT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    if (isDemoMode()) {
      setData(getDemoActiveBase(system, selectedCreditors));
      setError('');
      setLoading(false);
      return;
    }

    let active = true;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();
    setLoading(true);

    async function load() {
      try {
        const result = await fetchActiveBase(system, selectedCreditors, controller.signal);
        if (!active) return;
        setData(result);
        setError('');
        if (result.status === 'empty' || result.status === 'refreshing') {
          retryTimer = setTimeout(load, 30000);
        }
      } catch (err) {
        if (!active) return;
        setData(EMPTY_ACTIVE_BASE_REPORT);
        setError(err instanceof Error ? err.message : 'Erro ao carregar base ativa.');
      } finally {
        if (active) setLoading(false);
      }
    }

    void load();

    return () => {
      active = false;
      controller.abort();
      if (retryTimer) clearTimeout(retryTimer);
    };
  }, [enabled, selectedCreditors, system]);

  return { activeBaseReport: data, activeBaseLoading: loading, activeBaseError: error };
}

export function usePortfolioData(system: SystemFilter, selectedPeriods: Set<string>, selectedCreditors: Set<string>, enabled: boolean) {
  const [data, setData] = useState<PortfolioEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    if (isDemoMode()) {
      setData(getDemoPortfolio(system, selectedPeriods, selectedCreditors));
      setError('');
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(true);

    fetchPortfolio(system, selectedPeriods, selectedCreditors, controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result);
        setError('');
      })
      .catch((err) => {
        if (!active) return;
        setData([]);
        setError(err instanceof Error ? err.message : 'Erro ao carregar carteiras.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, selectedCreditors, selectedPeriods, system]);

  return { portfolioData: data, portfolioLoading: loading, portfolioError: error };
}

export function useBaseSummaryData(system: SystemFilter, selectedPeriods: Set<string>, selectedCreditors: Set<string>, enabled: boolean) {
  const [data, setData] = useState<BaseSummaryReport>(EMPTY_BASE_SUMMARY_REPORT);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!enabled) return;
    if (isDemoMode()) {
      setData(getDemoBaseSummary(system, selectedPeriods, selectedCreditors));
      setError('');
      setLoading(false);
      return;
    }

    const cacheKey = `${responseCacheKey('base-summary', '', system, selectedCreditors)}:periodos:${Array.from(selectedPeriods).sort().join('|')}`;
    const cached = getCachedResponse<BaseSummaryReport>(cacheKey);
    if (cached) {
      setData(cached);
      setError('');
      setLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    setLoading(true);

    fetchBaseSummary(system, selectedPeriods, selectedCreditors, controller.signal)
      .then((result) => {
        if (!active) return;
        const nextData = result ?? EMPTY_BASE_SUMMARY_REPORT;
        setCachedResponse(cacheKey, nextData);
        setData(nextData);
        setError('');
      })
      .catch((err) => {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar resumo das bases.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
      controller.abort();
    };
  }, [enabled, selectedCreditors, selectedPeriods, system]);

  return { baseSummary: data, baseSummaryLoading: loading, baseSummaryError: error };
}

function getAvailablePeriods(data: DashboardData) {
  return Array.from(new Set([...data.baixas, ...data.acordos, ...data.acessos].map((row) => monthKey(row.data)).filter(Boolean)))
    .sort()
    .reverse();
}

function getCurrentPeriodKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
}
