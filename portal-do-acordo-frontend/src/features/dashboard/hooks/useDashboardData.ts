import { useEffect, useMemo, useState } from 'react';
import {
  DEMO_DASHBOARD_DATA,
  DEMO_PRIMARY_PERIOD,
  getDemoActiveBase,
  getDemoCommunication,
  getDemoCosts,
  getDemoPortfolio,
  isDemoMode,
} from '../data/demoDashboardData';
import { fetchActiveBase, fetchCommunication, fetchCosts, fetchDashboardData, fetchEmailClicks, fetchPortfolio } from '../services/dashboardApi';
import type { ActiveBaseReport, CommunicationData, CostsData, DashboardData, EmailClickData, PortfolioEntry, SystemFilter } from '../types';
import { monthKey } from '../utils/dates';

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
};

export function useDashboardData() {
  const [data, setData] = useState<DashboardData>(EMPTY_DASHBOARD_DATA);
  const [loading, setLoading] = useState(!isDemoMode());
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(() => isDemoMode() ? DEMO_PRIMARY_PERIOD : getCurrentPeriodKey());

  useEffect(() => {
    if (isDemoMode()) {
      setData(DEMO_DASHBOARD_DATA);
      setPeriod(DEMO_PRIMARY_PERIOD);
      setError('');
      setLoading(false);
      return undefined;
    }

    let active = true;

    async function load() {
      try {
        setLoading(true);
        const initialPeriod = getCurrentPeriodKey();
        const currentMonthData = await fetchDashboardData(initialPeriod);
        if (!active) return;
        setData(currentMonthData);
        setPeriod((current) => current || initialPeriod);
        setError('');
      } catch (err) {
        if (!active) return;
        setError(err instanceof Error ? err.message : 'Erro ao carregar dados.');
      } finally {
        if (active) setLoading(false);
      }

      fetchDashboardData()
        .then((allData) => {
          if (!active) return;
          setData(allData);
          setPeriod((current) => current || getAvailablePeriods(allData)[0] || getCurrentPeriodKey());
        })
        .catch(() => undefined);
    }

    load();
    return () => {
      active = false;
    };
  }, []);

  const periods = useMemo(() => {
    const availablePeriods = getAvailablePeriods(data);
    return period && !availablePeriods.includes(period) ? [period, ...availablePeriods] : availablePeriods;
  }, [data, period]);

  return { data, loading, error, period, setPeriod, periods };
}

export function useDashboardSupplementalData(period: string, system: SystemFilter, selectedCreditors: Set<string>) {
  const [costs, setCosts] = useState<CostsData | null>(null);
  const [communication, setCommunication] = useState<CommunicationData | null>(null);
  const [emailClicks, setEmailClicks] = useState<EmailClickData | null>(null);

  useEffect(() => {
    if (!period) return;
    if (isDemoMode()) {
      setCosts(getDemoCosts(period, system));
      setCommunication(getDemoCommunication(period, system, selectedCreditors));
      setEmailClicks(null);
      return;
    }

    let active = true;
    Promise.all([
      fetchCosts(period, system).catch(() => null),
      fetchCommunication(period, system, selectedCreditors).catch(() => null),
      fetchEmailClicks(period, system, selectedCreditors).catch(() => null),
    ])
      .then(([costsResult, communicationResult, emailClicksResult]) => {
        if (!active) return;
        setCosts(costsResult);
        setCommunication(communicationResult);
        setEmailClicks(emailClicksResult);
      })

    return () => {
      active = false;
    };
  }, [period, selectedCreditors, system]);

  return { costs, communication, emailClicks };
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
    setLoading(true);

    async function load() {
      try {
        const result = await fetchActiveBase(system, selectedCreditors);
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
    setLoading(true);

    fetchPortfolio(system, selectedPeriods, selectedCreditors)
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
    };
  }, [enabled, selectedCreditors, selectedPeriods, system]);

  return { portfolioData: data, portfolioLoading: loading, portfolioError: error };
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
