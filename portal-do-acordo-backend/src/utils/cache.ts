type CacheEntry<T> = {
  expiresAt: number;
  value: T;
};

const cacheStore = new Map<string, CacheEntry<unknown>>();

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
