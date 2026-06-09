import type { Access, ActiveBaseReport, ActiveUsersReport, Agreement, BaseSummaryReport, CommunicationData, CostsData, DashboardData, DashboardPerformanceSummary, DashboardResultGraphs, DashboardResultSummary, EmailClickData, Payment, PortfolioEntry, SystemFilter } from '../types';

export type PresenceHeartbeatPayload = {
  sessionId: string;
  path: string;
  tab: string;
  period: string;
  system: string;
  referrer: string;
  timezone: string;
  language: string;
  visibility: string;
  viewport: { width: number; height: number };
  screen: { width: number; height: number };
};

export async function fetchDataset<T>(url: string, signal?: AbortSignal): Promise<T[]> {
  const response = await fetch(apiUrl(url), { signal });
  if (!response.ok) throw new Error(`Falha ao carregar ${url}: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function fetchDashboardData(periodo?: string, signal?: AbortSignal): Promise<DashboardData> {
  const query = periodo ? `?${new URLSearchParams({ periodo }).toString()}` : '';
  const [baixas, acordos, acessos] = await Promise.all([
    fetchDataset<Payment>(`/api/baixas${query}`, signal),
    fetchDataset<Agreement>(`/api/acordos${query}`, signal),
    fetchDataset<Access>(`/api/acessos${query}`, signal),
  ]);

  return { baixas, acordos, acessos };
}

export function fetchMonthlyFinancialPayments(periodo: string, sistema: SystemFilter, credores: Set<string>, signal?: AbortSignal) {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  return fetchDataset<Payment>(`/api/baixas/financeiro-mensal?${params.toString()}`, signal);
}

export async function fetchPeriods(sistema: SystemFilter, signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(apiUrl(`/api/periodos?${new URLSearchParams({ sistema }).toString()}`), { signal });
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function fetchCreditors(periodo: string, sistema: SystemFilter, signal?: AbortSignal): Promise<string[]> {
  const params = new URLSearchParams({ sistema });
  if (periodo) params.set('periodo', periodo);
  const response = await fetch(apiUrl(`/api/credores?${params.toString()}`), { signal });
  if (!response.ok) return [];
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function fetchDashboardResultSummary(periodo: string, sistema: SystemFilter, credores: Set<string>, signal?: AbortSignal): Promise<DashboardResultSummary | null> {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/dashboard/resultados/resumo?${params.toString()}`), { signal });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchDashboardResultGraphs(periodo: string, sistema: SystemFilter, credores: Set<string>, signal?: AbortSignal): Promise<DashboardResultGraphs | null> {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/dashboard/resultados/graficos?${params.toString()}`), { signal });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchDashboardPerformanceSummary(periodo: string, sistema: SystemFilter, credores: Set<string>, signal?: AbortSignal): Promise<DashboardPerformanceSummary | null> {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/dashboard/performance/resumo?${params.toString()}`), { signal });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchCosts(periodo: string, sistema: SystemFilter, signal?: AbortSignal): Promise<CostsData | null> {
  const params = new URLSearchParams({ periodo, sistema });
  const response = await fetch(apiUrl(`/api/custos?${params.toString()}`), { signal });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchCommunication(periodo: string, sistema: SystemFilter, credores: Set<string>, signal?: AbortSignal, includeDaily = false): Promise<CommunicationData | null> {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  params.set('diario', includeDaily ? '1' : '0');
  const response = await fetch(apiUrl(`/api/comunicacao?${params.toString()}`), { signal });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchEmailClicks(periodo: string, sistema: SystemFilter, credores: Set<string>, dataFim: string | null = null, signal?: AbortSignal): Promise<EmailClickData | null> {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  if (dataFim) params.set('dataFim', dataFim);
  const response = await fetch(apiUrl(`/api/mailgrid/cliques?${params.toString()}`), { signal, cache: 'no-store' });
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchActiveBase(sistema: SystemFilter, credores: Set<string>, signal?: AbortSignal): Promise<ActiveBaseReport> {
  const params = new URLSearchParams({ sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/base-ativa?${params.toString()}`), { signal });
  if (!response.ok) throw new Error(`Falha ao carregar /api/base-ativa: ${response.status}`);
  const payload = await response.json();
  return payload.data ?? { updated_at: null, aging_updated_at: null, status: 'empty', total_processos: 0, total_credores: 0, aging_complete: false, by_credor: [], aging: [], aging_by_credor: [] };
}

export async function fetchPortfolio(sistema: SystemFilter, periodos: Set<string>, credores: Set<string>, signal?: AbortSignal): Promise<PortfolioEntry[]> {
  const params = new URLSearchParams({ sistema });
  if (periodos.size > 0) params.set('periodos', Array.from(periodos).join(','));
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/carteiras?${params.toString()}`), { signal });
  if (!response.ok) throw new Error(`Falha ao carregar /api/carteiras: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function fetchBaseSummary(sistema: SystemFilter, periodos: Set<string>, credores: Set<string>, signal?: AbortSignal): Promise<BaseSummaryReport> {
  const params = new URLSearchParams({ sistema });
  if (periodos.size > 0) params.set('periodos', Array.from(periodos).join(','));
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/bases/resumo?${params.toString()}`), { signal });
  if (!response.ok) throw new Error(`Falha ao carregar /api/bases/resumo: ${response.status}`);
  const payload = await response.json();
  return payload.data;
}

export function sendPresenceHeartbeat(payload: PresenceHeartbeatPayload) {
  return fetch(apiUrl('/api/presenca/heartbeat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

export async function fetchActiveUsers(token: string): Promise<ActiveUsersReport> {
  const response = await fetch(apiUrl('/api/admin/active-users'), {
    headers: { 'x-admin-token': token },
  });
  if (!response.ok) throw new Error(`Falha ao carregar pessoas ativas: ${response.status}`);
  const payload = await response.json();
  return payload.data;
}

function apiUrl(path: string) {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';
  const baseUrl = configuredBaseUrl && !/^https?:\/\//i.test(configuredBaseUrl)
    ? `https://${configuredBaseUrl}`
    : configuredBaseUrl;

  return `${baseUrl}${path}`;
}
