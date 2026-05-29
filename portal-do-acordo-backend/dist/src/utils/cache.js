"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.getCached = getCached;
exports.cacheKey = cacheKey;
const cacheStore = new Map();
async function getCached(key, ttlMs, producer) {
    const now = Date.now();
    const current = cacheStore.get(key);
    if (current && current.expiresAt > now)
        return current.value;
    const value = await producer();
    cacheStore.set(key, { value, expiresAt: now + ttlMs });
    return value;
}
function cacheKey(prefix, input) {
    return `${prefix}:${JSON.stringify(input)}`;
}
//# sourceMappingURL=cache.js.map