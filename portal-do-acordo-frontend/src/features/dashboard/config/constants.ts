import type { SystemFilter } from '../types';

export const COLORS: Record<SystemFilter | 'gold' | 'rust' | 'green' | 'sky', string> = {
  consulth: '#231f20',
  sisth: '#5a8bc4',
  total: '#1d3f6e',
  gold: '#a8853a',
  rust: '#c2553f',
  green: '#4caf7d',
  sky: '#7da7d9',
};

export const CHART_PALETTE = [COLORS.sisth, COLORS.gold, COLORS.rust, COLORS.green, COLORS.sky, '#7c6fd8', '#d6729a', '#4fb6a8'];

export const FIXED_EMAIL_COST = 932;
