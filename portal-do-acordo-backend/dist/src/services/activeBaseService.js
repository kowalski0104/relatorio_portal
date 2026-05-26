"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refreshActiveBaseCache = refreshActiveBaseCache;
exports.getActiveBase = getActiveBase;
exports.startActiveBaseCacheScheduler = startActiveBaseCacheScheduler;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const prismaClients_1 = require("../db/prismaClients");
const CACHE_FILE = process.env.ACTIVE_BASE_CACHE_FILE ?? path_1.default.resolve(process.cwd(), 'data', 'base_ativa_cache.json');
const REFRESH_HOUR = Number(process.env.ACTIVE_BASE_REFRESH_HOUR ?? 5);
const SUMMARY_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_SUMMARY_TIMEOUT_MS ?? 60000);
const AGING_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_AGING_TIMEOUT_MS ?? 180000);
const AGING_CREDITOR_TIMEOUT_MS = Number(process.env.ACTIVE_BASE_AGING_CREDITOR_TIMEOUT_MS ?? 900000);
const AGING_BATCH_SIZE = Number(process.env.ACTIVE_BASE_AGING_BATCH_SIZE ?? 1000);
const REFRESHING_STALE_MS = Number(process.env.ACTIVE_BASE_REFRESHING_STALE_MS ?? 5 * 60 * 1000);
const AUTO_REFRESH_ON_START = process.env.ACTIVE_BASE_AUTO_REFRESH_ON_START === 'true';
let refreshPromise = null;
let schedulerStarted = false;
function emptyCache() {
    return {
        updated_at: null,
        aging_updated_at: null,
        status: 'empty',
        by_credor: [],
        aging: [],
    };
}
function creditorKey(row) {
    return `${row.sistema}::${row.credor}`;
}
function hasCompleteAging(creditors, aging) {
    if (creditors.length === 0)
        return false;
    const agingKeys = new Set(aging.map(creditorKey));
    return creditors.every((row) => agingKeys.has(creditorKey(row)));
}
function pendingAgingCreditors(creditors, aging) {
    const agingKeys = new Set(aging.map(creditorKey));
    return creditors.filter((row) => !agingKeys.has(creditorKey(row)));
}
async function readCache() {
    try {
        const raw = await fs_1.promises.readFile(CACHE_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        const cache = {
            updated_at: parsed.updated_at ?? null,
            aging_updated_at: parsed.aging_updated_at ?? null,
            status: parsed.status ?? 'empty',
            error: parsed.error,
            by_credor: Array.isArray(parsed.by_credor) ? parsed.by_credor : [],
            aging: Array.isArray(parsed.aging) ? parsed.aging : Array.isArray(parsed.rows) ? parsed.rows : [],
        };
        if (cache.status === 'refreshing' && cache.updated_at && Date.now() - new Date(cache.updated_at).getTime() > REFRESHING_STALE_MS) {
            const hasCreditorData = cache.by_credor.length > 0;
            const completeAging = hasCompleteAging(cache.by_credor, cache.aging);
            return {
                ...cache,
                status: completeAging ? 'ready' : hasCreditorData ? 'partial' : 'error',
                error: completeAging || hasCreditorData ? undefined : cache.error ?? 'Nao foi possivel atualizar as Bases.',
            };
        }
        return cache;
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT')
            return emptyCache();
        throw error;
    }
}
async function writeCache(cache) {
    await fs_1.promises.mkdir(path_1.default.dirname(CACHE_FILE), { recursive: true });
    await fs_1.promises.writeFile(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf-8');
}
async function withStatementTimeout(prisma, timeoutMs, query) {
    return prisma.$transaction(async (tx) => {
        await tx.$executeRawUnsafe(`SET LOCAL statement_timeout = ${Math.max(timeoutMs, 1000)}`);
        return query(tx);
    }, { timeout: timeoutMs + 5000, maxWait: 10000 });
}
async function withHardTimeout(promise, timeoutMs, label) {
    let timer;
    const guardedPromise = promise.catch((error) => {
        throw error;
    });
    guardedPromise.catch(() => undefined);
    try {
        return await Promise.race([
            guardedPromise,
            new Promise((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error(`${label} excedeu ${Math.round(timeoutMs / 1000)}s.`)), timeoutMs);
            }),
        ]);
    }
    finally {
        if (timer)
            clearTimeout(timer);
    }
}
function companyFilter(empresaId) {
    return empresaId === 1007 ? 'AND c.id != 31084' : '';
}
function systemName(empresaId) {
    return empresaId === 401 ? 'consulth' : 'sisth';
}
async function queryActiveBaseByCreditor(prisma, empresaId) {
    const rows = await withStatementTimeout(prisma, SUMMARY_TIMEOUT_MS, (tx) => tx.$queryRawUnsafe(`
        SELECT
            TRIM(c.grupo) AS credor,
            COUNT(*)::bigint AS processos
        FROM tb_devedor d
        JOIN tb_credor c ON c.id = d.idcredor
        LEFT JOIN tb_processo p ON p.processo = d.processo
        WHERE d.idempresa = $1
          ${companyFilter(empresaId)}
          AND c.status = 'ATIVO'
          AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUCAO','BAIXADO','QUITADO'))
          AND c.grupo IS NOT NULL
          AND TRIM(c.grupo) <> ''
        GROUP BY TRIM(c.grupo)
        ORDER BY processos DESC, credor
      `, empresaId));
    const sistema = systemName(empresaId);
    return rows.map((row) => ({
        sistema,
        credor: String(row.credor),
        processos: Number(row.processos ?? 0),
    }));
}
async function queryActiveBaseAgingForCreditor(prisma, empresaId, credor) {
    const countRows = await withStatementTimeout(prisma, SUMMARY_TIMEOUT_MS, (tx) => tx.$queryRawUnsafe(`
        SELECT COUNT(*)::bigint AS total
        FROM (
          SELECT DISTINCT d.processo
          FROM tb_devedor d
          JOIN tb_credor c ON c.id = d.idcredor
          LEFT JOIN tb_processo p ON p.processo = d.processo
          WHERE d.idempresa = $1
            AND TRIM(c.grupo) = $2
            ${companyFilter(empresaId)}
            AND c.status = 'ATIVO'
            AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUCAO','BAIXADO','QUITADO'))
            AND c.grupo IS NOT NULL
            AND TRIM(c.grupo) <> ''
        ) base
      `, empresaId, credor));
    const sistema = systemName(empresaId);
    const total = Number(countRows[0]?.total ?? 0);
    const totals = new Map();
    for (let offset = 0; offset < total; offset += AGING_BATCH_SIZE) {
        const batchRows = await queryActiveBaseAgingBatch(prisma, empresaId, credor, AGING_BATCH_SIZE, offset);
        for (const row of batchRows) {
            totals.set(row.faixa, (totals.get(row.faixa) ?? 0) + Number(row.processos ?? 0));
        }
    }
    return Array.from(totals.entries()).map(([faixa, processos]) => ({
        sistema,
        credor,
        faixa,
        processos,
    }));
}
async function queryActiveBaseAgingBatch(prisma, empresaId, credor, limit, offset) {
    return withStatementTimeout(prisma, AGING_TIMEOUT_MS, (tx) => tx.$queryRawUnsafe(`
        WITH active_processes AS (
          SELECT processo, credor
          FROM (
            SELECT DISTINCT
                d.processo,
                TRIM(c.grupo) AS credor
            FROM tb_devedor d
            JOIN tb_credor c ON c.id = d.idcredor
            LEFT JOIN tb_processo p ON p.processo = d.processo
            WHERE d.idempresa = $1
              AND TRIM(c.grupo) = $2
              ${companyFilter(empresaId)}
              AND c.status = 'ATIVO'
              AND (p.status_desc IS NULL OR p.status_desc NOT IN ('DEVOLUCAO','BAIXADO','QUITADO'))
              AND c.grupo IS NOT NULL
              AND TRIM(c.grupo) <> ''
            ORDER BY d.processo
            LIMIT $3 OFFSET $4
          ) base
        ),
        process_due_dates AS (
          SELECT
              ap.processo,
              ap.credor,
              (
                SELECT MIN(t.vencimento)::date
                FROM tb_titulos t
                WHERE t.processo = ap.processo
                  AND t.vencimento IS NOT NULL
              ) AS vencimento_min
          FROM active_processes ap
        )
        SELECT
            credor,
            CASE
              WHEN vencimento_min IS NULL THEN 'SEM VENCIMENTO'
              WHEN CURRENT_DATE - vencimento_min <= 90 THEN '0-90'
              WHEN CURRENT_DATE - vencimento_min <= 180 THEN '91-180'
              WHEN CURRENT_DATE - vencimento_min <= 360 THEN '181-360'
              ELSE '361+'
            END AS faixa,
            COUNT(*)::bigint AS processos
        FROM process_due_dates
        GROUP BY credor, faixa
        ORDER BY credor, faixa
      `, empresaId, credor, limit, offset));
}
function mergeAgingRows(currentRows, newRows) {
    const newKeys = new Set(newRows.map(creditorKey));
    return [...currentRows.filter((row) => !newKeys.has(creditorKey(row))), ...newRows];
}
async function queryActiveBaseAgingByCreditor(creditors, onProgress) {
    const clientBySystem = new Map((0, prismaClients_1.getLiveClients)('total').map(({ empresaId, query }) => [systemName(empresaId), { empresaId, query }]));
    const rows = [];
    const errors = [];
    for (const creditor of creditors) {
        const client = clientBySystem.get(creditor.sistema);
        if (!client)
            continue;
        try {
            rows.push(...(await withHardTimeout(client.query((prisma) => queryActiveBaseAgingForCreditor(prisma, client.empresaId, creditor.credor)), AGING_CREDITOR_TIMEOUT_MS + 15000, `vencimentos ${creditor.sistema} ${creditor.credor}`)));
            if (onProgress)
                await onProgress(rows);
        }
        catch (error) {
            errors.push(`vencimentos ${creditor.sistema} ${creditor.credor}: ${formatError(error)}`);
        }
    }
    return { rows, errors };
}
async function refreshActiveBaseCache() {
    if (refreshPromise)
        return refreshPromise;
    refreshPromise = (async () => {
        const current = await readCache();
        await writeCache({ ...current, status: 'refreshing', error: undefined });
        const errors = [];
        const creditorResults = await Promise.all((0, prismaClients_1.getLiveClients)('total').map(async ({ empresaId, query }) => {
            try {
                return { rows: await withHardTimeout(query((prisma) => queryActiveBaseByCreditor(prisma, empresaId)), SUMMARY_TIMEOUT_MS + 15000, `base ativa ${systemName(empresaId)}`) };
            }
            catch (error) {
                return { rows: [], error: `${systemName(empresaId)}: ${formatError(error)}` };
            }
        }));
        const byCreditor = creditorResults.flatMap((result) => result.rows);
        errors.push(...creditorResults.flatMap((result) => (result.error ? [result.error] : [])));
        if (byCreditor.length === 0) {
            const cache = {
                ...current,
                status: current.by_credor.length > 0 ? 'partial' : 'error',
                error: errors.join(' | ') || 'Nao foi possivel atualizar as Bases.',
            };
            await writeCache(cache);
            refreshPromise = null;
            return cache;
        }
        const partialCache = {
            ...current,
            updated_at: new Date().toISOString(),
            status: 'refreshing',
            error: errors.length > 0 ? errors.join(' | ') : undefined,
            by_credor: byCreditor,
        };
        await writeCache(partialCache);
        const validCreditorKeys = new Set(byCreditor.map(creditorKey));
        const existingAging = partialCache.aging.filter((row) => validCreditorKeys.has(creditorKey(row)));
        const pendingBeforeRefresh = pendingAgingCreditors(byCreditor, existingAging).sort((a, b) => a.processos - b.processos);
        const creditorsToRefresh = pendingBeforeRefresh.length > 0 ? pendingBeforeRefresh : [...byCreditor].sort((a, b) => a.processos - b.processos);
        const agingResult = await queryActiveBaseAgingByCreditor(creditorsToRefresh, async (progressRows) => {
            const progressAging = mergeAgingRows(existingAging, progressRows);
            await writeCache({
                ...partialCache,
                status: hasCompleteAging(byCreditor, progressAging) ? 'ready' : 'partial',
                aging_updated_at: new Date().toISOString(),
                aging: progressAging,
            });
        });
        const aging = mergeAgingRows(existingAging, agingResult.rows);
        errors.push(...agingResult.errors);
        const completeAging = hasCompleteAging(byCreditor, aging);
        const pending = pendingAgingCreditors(byCreditor, aging);
        const cache = {
            ...partialCache,
            aging_updated_at: aging.length > 0 ? new Date().toISOString() : partialCache.aging_updated_at,
            status: completeAging ? 'ready' : 'partial',
            error: errors.length > 0 ? errors.join(' | ') : pending.length > 0 ? `Vencimentos pendentes: ${pending.map((row) => `${row.sistema}/${row.credor}`).join(', ')}` : undefined,
            aging: aging.length > 0 ? aging : partialCache.aging,
        };
        await writeCache(cache);
        refreshPromise = null;
        return cache;
    })();
    return refreshPromise;
}
async function getActiveBase(filter) {
    const cache = await readCache();
    if (cache.status === 'empty' || (cache.status === 'error' && cache.by_credor.length === 0)) {
        void refreshActiveBaseCache();
    }
    const selectedSystems = filter.sistema === 'total' ? new Set(['consulth', 'sisth']) : new Set([filter.sistema]);
    const selectedCreditors = new Set((filter.credores ?? []).map((creditor) => creditor.trim()).filter(Boolean));
    const creditorRows = cache.by_credor.filter((row) => selectedSystems.has(row.sistema) && (selectedCreditors.size === 0 || selectedCreditors.has(row.credor)));
    const agingRows = cache.aging.filter((row) => selectedSystems.has(row.sistema) && (selectedCreditors.size === 0 || selectedCreditors.has(row.credor)));
    const agingComplete = hasCompleteAging(creditorRows, agingRows);
    const pending = pendingAgingCreditors(creditorRows, agingRows);
    const byCreditor = new Map();
    const aging = new Map([
        ['0-90', 0],
        ['91-180', 0],
        ['181-360', 0],
        ['361+', 0],
        ['SEM VENCIMENTO', 0],
    ]);
    for (const row of creditorRows) {
        byCreditor.set(row.credor, (byCreditor.get(row.credor) ?? 0) + row.processos);
    }
    for (const row of agingRows) {
        aging.set(row.faixa, (aging.get(row.faixa) ?? 0) + row.processos);
    }
    return {
        data: {
            updated_at: cache.updated_at,
            aging_updated_at: cache.aging_updated_at,
            status: agingComplete ? 'ready' : cache.status === 'ready' ? 'partial' : cache.status,
            error: agingComplete ? undefined : pending.length > 0 ? `Vencimentos pendentes: ${pending.map((row) => `${row.sistema}/${row.credor}`).join(', ')}` : cache.error,
            total_processos: creditorRows.reduce((sum, row) => sum + row.processos, 0),
            total_credores: byCreditor.size,
            aging_complete: agingComplete,
            by_credor: Array.from(byCreditor.entries())
                .map(([credor, processos]) => ({ credor, processos }))
                .sort((a, b) => b.processos - a.processos || a.credor.localeCompare(b.credor, 'pt-BR')),
            aging: Array.from(aging.entries()).map(([faixa, processos]) => ({ faixa, processos })),
        },
    };
}
function startActiveBaseCacheScheduler() {
    if (schedulerStarted)
        return;
    schedulerStarted = true;
    if (AUTO_REFRESH_ON_START)
        void readCache().then((cache) => {
            if (cache.status === 'empty' || (cache.status === 'error' && cache.by_credor.length === 0))
                void refreshActiveBaseCache();
        });
    setInterval(() => {
        const now = new Date();
        if (now.getHours() === REFRESH_HOUR && now.getMinutes() < 10) {
            void refreshActiveBaseCache();
        }
    }, 10 * 60 * 1000);
}
function formatError(error) {
    return error instanceof Error ? error.message : 'erro desconhecido';
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
//# sourceMappingURL=activeBaseService.js.map