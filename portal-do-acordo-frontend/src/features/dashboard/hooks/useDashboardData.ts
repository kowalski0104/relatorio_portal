import { useEffect, useMemo, useState } from 'react';
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
import { fetchActiveBase, fetchBaseSummary, fetchCommunication, fetchCosts, fetchDashboardData, fetchEmailClicks, fetchPeriods, fetchPortfolio } from '../services/dashboardApi';
import type { ActiveBaseReport, BaseSummaryReport, CommunicationData, CostsData, DashboardData, EmailClickData, PortfolioEntry, SystemFilter } from '../types';
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

export function useDashboardData(selectedPeriods: Set<string>, system: SystemFilter, enabled: boolean) {
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
    return basePeriods.length === 1 ? Array.from(new Set([...basePeriods, previousPeriod(basePeriods[0])])) : basePeriods;
  }, [period, selectedPeriods]);

  useEffect(() => {
    if (!enabled || isDemoMode()) {
      setLoading(false);
      return undefined;
    }

    const missingPeriods = requestedPeriods.filter((item) => !cache[item]);
    if (missingPeriods.length === 0) return undefined;

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
  emailClicks?: boolean;
};

export function useDashboardSupplementalData(period: string, system: SystemFilter, selectedCreditors: Set<string>, options: SupplementalOptions = {}) {
  const [costs, setCosts] = useState<CostsData | null>(null);
  const [communication, setCommunication] = useState<CommunicationData | null>(null);
  const [emailClicks, setEmailClicks] = useState<EmailClickData | null>(null);
  const costsEnabled = options.costs ?? true;
  const communicationEnabled = options.communication ?? true;
  const emailClicksEnabled = options.emailClicks ?? true;

  useEffect(() => {
    const hasEnabledRequest = costsEnabled || communicationEnabled || emailClicksEnabled;
    if (!hasEnabledRequest) return;
    if (!period) return;
    if (isDemoMode()) {
      if (costsEnabled) setCosts(getDemoCosts(period, system));
      if (communicationEnabled) setCommunication(getDemoCommunication(period, system, selectedCreditors));
      if (emailClicksEnabled) setEmailClicks(null);
      return;
    }

    let active = true;
    const controller = new AbortController();
    Promise.all([
      costsEnabled ? fetchCosts(period, system, controller.signal).catch(() => null) : Promise.resolve(costs),
      communicationEnabled ? fetchCommunication(period, system, selectedCreditors, controller.signal).catch(() => null) : Promise.resolve(communication),
      emailClicksEnabled ? fetchEmailClicks(period, system, selectedCreditors, controller.signal).catch(() => null) : Promise.resolve(emailClicks),
    ])
      .then(([costsResult, communicationResult, emailClicksResult]) => {
        if (!active) return;
        if (costsEnabled) setCosts(costsResult);
        if (communicationEnabled) setCommunication(communicationResult);
        if (emailClicksEnabled) setEmailClicks(emailClicksResult);
      })

    return () => {
      active = false;
      controller.abort();
    };
  }, [communicationEnabled, costsEnabled, emailClicksEnabled, period, selectedCreditors, system]);

  return { costs, communication, emailClicks };
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

    let active = true;
    const controller = new AbortController();
    setLoading(true);

    fetchBaseSummary(system, selectedPeriods, selectedCreditors, controller.signal)
      .then((result) => {
        if (!active) return;
        setData(result ?? EMPTY_BASE_SUMMARY_REPORT);
        setError('');
      })
      .catch((err) => {
        if (!active) return;
        setData(EMPTY_BASE_SUMMARY_REPORT);
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
