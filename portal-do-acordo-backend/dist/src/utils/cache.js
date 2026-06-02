"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CACHE_TTL = void 0;
exports.getCached = getCached;
exports.cacheKey = cacheKey;
exports.clearCache = clearCache;
const cacheStore = new Map();
const pendingStore = new Map();
exports.CACHE_TTL = {
    RESULTS: 10 * 60 * 1000,
    PERFORMANCE: 10 * 60 * 1000,
    COSTS: 10 * 60 * 1000,
    COMMUNICATION: 15 * 60 * 1000,
    BASES: 10 * 60 * 1000,
    PERIODS: 30 * 60 * 1000,
    CREDITORS: 30 * 60 * 1000,
    PORTFOLIO: 10 * 60 * 1000,
};
async function getCached(key, ttlMs, producer) {
    const now = Date.now();
    const current = cacheStore.get(key);
    if (current && current.expiresAt > now)
        return current.value;
    const pending = pendingStore.get(key);
    if (pending)
        return pending;
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
function cacheKey(prefix, input) {
    return `${prefix}:${JSON.stringify(input)}`;
}
function clearCache() {
    const size = cacheStore.size;
    cacheStore.clear();
    pendingStore.clear();
    return size;
}
//# sourceMappingURL=cache.js.map