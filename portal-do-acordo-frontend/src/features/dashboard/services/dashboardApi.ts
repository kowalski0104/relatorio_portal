import type { Access, Agreement, CommunicationData, CostsData, DashboardData, Payment, SystemFilter } from '../types';

export async function fetchDataset<T>(url: string): Promise<T[]> {
  const response = await fetch(url);
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
  const response = await fetch(`/api/custos?${params.toString()}`);
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}

export async function fetchCommunication(periodo: string, sistema: SystemFilter, credores: Set<string>): Promise<CommunicationData | null> {
  const params = new URLSearchParams({ periodo, sistema });
  if (credores.size > 0) params.set('credores', Array.from(credores).join(','));
  const response = await fetch(`/api/comunicacao?${params.toString()}`);
  if (!response.ok) return null;
  const payload = await response.json();
  return payload.data ?? null;
}
