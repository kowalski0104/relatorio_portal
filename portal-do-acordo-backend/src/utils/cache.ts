type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cacheStore = new Map<string, CacheEntry<unknown>>();
const pendingStore = new Map<string, Promise<unknown>>();

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

  const pending = pendingStore.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const request = Promise.resolve()
    .then(producer)
    .then((value) => {
      cacheStore.set(key, { value, expiresAt: Date.now() + ttlMs });
      return value;
    })
    .finally(() => {
      pendingStore.delete(key);
    });

  pendingStore.set(key, request);
  return request;
}

export function cacheKey(prefix: string, input: unknown) {
  return `${prefix}:${JSON.stringify(input)}`;
}

export function clearCache() {
  const size = cacheStore.size;
  cacheStore.clear();
  pendingStore.clear();
  return size;
}
