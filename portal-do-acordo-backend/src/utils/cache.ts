type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cacheStore = new Map<string, CacheEntry<unknown>>();

export const CACHE_TTL = {
  RESULTS: 10 * 60 * 1000,
  PERFORMANCE: 10 * 60 * 1000,
  COSTS: 10 * 60 * 1000,
  COMMUNICATION: 15 * 60 * 1000,
  BASES: 10 * 60 * 1000,
  PERIODS: 30 * 60 * 1000,
  CREDITORS: 30 * 60 * 1000,
  PORTFOLIO: 10 * 60 * 1000,
};

export async function getCached<T>(key: string, ttlMs: number, producer: () => Promise<T>) {
  const now = Date.now();
  const current = cacheStore.get(key) as CacheEntry<T> | undefined;
  if (current && current.expiresAt > now) return current.value;

  const value = await producer();
  cacheStore.set(key, { value, expiresAt: now + ttlMs });
  return value;
}

export function cacheKey(prefix: string, input: unknown) {
  return `${prefix}:${JSON.stringify(input)}`;
}

export function clearCache() {
  const size = cacheStore.size;
  cacheStore.clear();
  return size;
}
