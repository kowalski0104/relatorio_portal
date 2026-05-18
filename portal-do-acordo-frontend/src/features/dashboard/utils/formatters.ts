import type { SystemFilter } from '../types';

export const money = (value: number, decimals = 2) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: decimals, maximumFractionDigits: decimals });

export const compactMoney = (value: number) =>
  value.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

export const number = (value: number) => value.toLocaleString('pt-BR');

export const percent = (part: number, total: number) => (total > 0 ? `${((part / total) * 100).toFixed(1)}%` : '0.0%');

export const safeNumber = (value: number | null | undefined) => Number(value || 0);

export const systemLabel = (system: SystemFilter) => (system === 'total' ? 'Total (Ambos)' : system === 'consulth' ? 'Consulth' : 'Sisth');

export const dateTime = (value: string | null | undefined) =>
  value
    ? new Date(value).toLocaleString('pt-BR', {
        day: '2-digit',
        month: '2-digit',
        year: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      })
    : 'Ainda não gerado';
