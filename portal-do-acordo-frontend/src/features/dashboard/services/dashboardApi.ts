import type { Access, ActiveBaseReport, Agreement, CommunicationData, CostsData, DashboardData, EmailClickData, Payment, PortfolioEntry, SystemFilter } from '../types';

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

export async function fetchDataset<T>(url: string): Promise<T[]> {
  const response = await fetch(apiUrl(url));
  if (!response.ok) throw new Error(`Falha ao carregar ${url}: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

export async function fetchDashboardData(periodo?: string): Promise<DashboardData> {
  const query = periodo ? `?${new URLSearchParams({ periodo }).toString()}` : '';
  const [baixas, acordos, acessos] = await Promise.all([
    fetchDataset<Payment>(`/api/baixas${query}`),
    fetchDataset<Agreement>(`/api/acordos${query}`),
    fetchDataset<Access>(`/api/acessos${query}`),
  ]);

  return { baixas, acordos, acessos };
}

export async function fetchCosts(periodo: string, sistema: SystemFilter): Promise<CostsData | null> {
  const params = new URLSearchParams({ periodo, sistema });
  const response = await fetch(apiUrl(`/api/custos?${params.toString()}`));
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchCommunication(periodo: string, sistema: SystemFilter, credores: Set<string>): Promise<CommunicationData | null> {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/comunicacao?${params.toString()}`));
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchEmailClicks(periodo: string, sistema: SystemFilter, credores: Set<string>): Promise<EmailClickData | null> {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/mailgrid/cliques?${params.toString()}`));
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchActiveBase(sistema: SystemFilter, credores: Set<string>): Promise<ActiveBaseReport> {
  const params = new URLSearchParams({ sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/base-ativa?${params.toString()}`));
  if (!response.ok) throw new Error(`Falha ao carregar /api/base-ativa: ${response.status}`);
  const payload = await response.json();
  return payload.data ?? { updated_at: null, aging_updated_at: null, status: 'empty', total_processos: 0, total_credores: 0, aging_complete: false, by_credor: [], aging: [] };
}

export async function fetchPortfolio(sistema: SystemFilter, periodos: Set<string>, credores: Set<string>): Promise<PortfolioEntry[]> {
  const params = new URLSearchParams({ sistema });
  if (periodos.size > 0) params.set('periodos', Array.from(periodos).join(','));
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(apiUrl(`/api/carteiras?${params.toString()}`));
  if (!response.ok) throw new Error(`Falha ao carregar /api/carteiras: ${response.status}`);
  const payload = await response.json();
  return Array.isArray(payload.data) ? payload.data : [];
}

export function sendPresenceHeartbeat(payload: PresenceHeartbeatPayload) {
  return fetch(apiUrl('/api/presenca/heartbeat'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => undefined);
}

function apiUrl(path: string) {
  const configuredBaseUrl = import.meta.env.VITE_API_BASE_URL?.trim().replace(/\/$/, '') ?? '';
  const baseUrl = configuredBaseUrl && !/^https?:\/\//i.test(configuredBaseUrl)
    ? `https://${configuredBaseUrl}`
    : configuredBaseUrl;

  return `${baseUrl}${path}`;
}
