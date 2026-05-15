import { useEffect, useMemo, useState } from 'react';
import { fetchCommunication, fetchCosts, fetchDashboardData } from '../services/dashboardApi';
import type { CommunicationData, CostsData, DashboardData, SystemFilter } from '../types';
import { monthKey } from '../utils/dates';

const EMPTY_DASHBOARD_DATA: DashboardData = { baixas: [], acordos: [], acessos: [] };

export function useDashboardData() {
  const [data, setData] = useState<DashboardData>(EMPTY_DASHBOARD_DATA);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [period, setPeriod] = useState(getCurrentPeriodKey);

  useEffect(() => {
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

  useEffect(() => {
    if (!period) return;

    let active = true;
    Promise.all([
      fetchCosts(period, system),
      fetchCommunication(period, system, selectedCreditors),
    ])
      .then(([costsResult, communicationResult]) => {
        if (!active) return;
        setCosts(costsResult);
        setCommunication(communicationResult);
      })
      .catch(() => {
        if (!active) return;
        setCosts(null);
        setCommunication(null);
      });

    return () => {
      active = false;
    };
  }, [period, selectedCreditors, system]);

  return { costs, communication };
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
