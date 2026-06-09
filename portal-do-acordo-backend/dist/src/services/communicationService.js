"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.handleWhatsAppWebhook = handleWhatsAppWebhook;
exports.getCommunication = getCommunication;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const reportFilters_1 = require("../utils/reportFilters");
const prismaClients_1 = require("../db/prismaClients");
const emailMonthlyAggregateClient_1 = require("../db/emailMonthlyAggregateClient");
const reportFilters_2 = require("../utils/reportFilters");
const DATA_FILE = process.env.WATI_DATA_FILE ?? path_1.default.resolve(process.cwd(), 'data', 'custos_wati.json');
const CUSTO_POR_MENSAGEM_BRL = Number(process.env.WATI_MESSAGE_COST_BRL ?? 0.05);
const COMUNICACAO_CACHE_TTL_MS = Number(process.env.COMUNICACAO_CACHE_TTL_MS ?? 30 * 60 * 1000);
const EVENTOS_COBRADOS = new Set((process.env.WATI_BILLABLE_EVENTS ?? 'templateMessageSent_v2,templateMessageSent')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
const comunicacaoCache = new Map();
const comunicacaoPending = new Map();
const emailQueryCache = new Map();
const emailQueryPending = new Map();
function normalizedCredores(filter) {
    return [...(filter.credores ?? [])].map((item) => item.trim()).filter(Boolean).sort();
}
function useEmailMonthlyAggregate(filter) {
    return process.env.USE_EMAIL_MONTHLY_AGGREGATE === 'true' && filter.diario === false && (0, emailMonthlyAggregateClient_1.hasEmailMonthlyAggregateDatabaseConfig)();
}
function getCommunicationCacheKey(filter) {
    const diario = filter.diario !== false;
    return JSON.stringify({
        periodo: filter.periodo ?? '',
        sistema: filter.sistema ?? 'total',
        credores: normalizedCredores(filter),
        diario,
        emailSource: useEmailMonthlyAggregate(filter) ? 'monthly-aggregate' : 'source',
    });
}
function getEmailQueryCacheKey(scope, filter) {
    const periodo = scope === 'mensal' ? (filter.periodo ?? '').slice(0, 4) : filter.periodo ?? '';
    return JSON.stringify({
        scope,
        periodo,
        sistema: filter.sistema ?? 'total',
        credores: normalizedCredores(filter),
        emailSource: useEmailMonthlyAggregate(filter) ? 'monthly-aggregate' : 'source',
    });
}
function getCachedEmailQuery(key, producer) {
    const cached = emailQueryCache.get(key);
    if (cached && cached.expiresAt > Date.now())
        return Promise.resolve(cached.data);
    const pending = emailQueryPending.get(key);
    if (pending)
        return pending;
    const request = producer()
        .then((data) => {
        emailQueryCache.set(key, { data, expiresAt: Date.now() + COMUNICACAO_CACHE_TTL_MS });
        return data;
    })
        .finally(() => {
        emailQueryPending.delete(key);
    });
    emailQueryPending.set(key, request);
    return request;
}
function emptyStore() {
    return { total_brl: 0, mensagens: 0, dias: [], por_credor: {} };
}
async function readStore() {
    try {
        const raw = await fs_1.promises.readFile(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            total_brl: Number(parsed.total_brl ?? 0),
            mensagens: Number(parsed.mensagens ?? 0),
            dias: Array.isArray(parsed.dias) ? parsed.dias : [],
            por_credor: parsed.por_credor ?? {},
        };
    }
    catch (error) {
        if (isNodeError(error) && error.code === 'ENOENT')
            return emptyStore();
        throw error;
    }
}
async function writeStore(store) {
    await fs_1.promises.mkdir(path_1.default.dirname(DATA_FILE), { recursive: true });
    await fs_1.promises.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}
function normalizePhone(waId) {
    let phone = waId.trim();
    if (phone.startsWith('55') && phone.length > 11)
        phone = phone.slice(2);
    return phone;
}
async function findCredorByPhone(prisma, phone) {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT d.idcredor
      FROM tb_devedor_fones f
      JOIN tb_devedor d ON d.id = f.iddevedor
      WHERE f.fone = $1 AND d.idcredor IS NOT NULL
      ORDER BY CASE WHEN f.status = 'ATIVO' THEN 0 ELSE 1 END
      LIMIT 1
    `, phone);
    return rows[0]?.idcredor ? String(rows[0].idcredor) : null;
}
async function findCredorName(prisma, idcredor) {
    const rows = await prisma.$queryRawUnsafe(`
      SELECT TRIM(grupo) AS grupo, TRIM(razaosocial) AS razaosocial
      FROM tb_credor
      WHERE id = $1
      LIMIT 1
    `, Number(idcredor));
    const row = rows[0];
    return row?.grupo || row?.razaosocial || idcredor;
}
async function handleWhatsAppWebhook(payload) {
    const eventType = String(payload.eventType ?? '');
    const waId = String(payload.waId ?? '');
    if (!EVENTOS_COBRADOS.has(eventType)) {
        return { status: 'ignorado', evento: eventType };
    }
    let custo = CUSTO_POR_MENSAGEM_BRL;
    const payloadCost = Number(payload.cost ?? payload.price);
    if (Number.isFinite(payloadCost) && payloadCost >= 0)
        custo = payloadCost;
    const phone = waId ? normalizePhone(waId) : '';
    let idcredor = null;
    let credor = 'Nao identificado';
    if (phone) {
        for (const { query } of (0, prismaClients_1.getLiveClients)('total')) {
            try {
                const match = await query(async (prisma) => {
                    const foundCredorId = await findCredorByPhone(prisma, phone);
                    if (!foundCredorId)
                        return null;
                    return {
                        idcredor: foundCredorId,
                        credor: await findCredorName(prisma, foundCredorId),
                    };
                });
                if (match) {
                    idcredor = match.idcredor;
                    credor = match.credor;
                    break;
                }
            }
            catch (error) {
                console.warn('Falha ao buscar credor Wati:', error);
            }
        }
    }
    const today = new Date().toISOString().slice(0, 10);
    const store = await readStore();
    store.mensagens += 1;
    store.total_brl += custo;
    let day = store.dias.find((item) => item.data === today);
    if (!day) {
        day = { data: today, mensagens: 0, custo_brl: 0 };
        store.dias.push(day);
    }
    day.mensagens += 1;
    day.custo_brl += custo;
    const key = idcredor ?? 'SEM_CREDOR';
    if (!store.por_credor[key]) {
        store.por_credor[key] = { idcredor: key, credor, mensagens: 0, custo_brl: 0 };
    }
    store.por_credor[key].mensagens += 1;
    store.por_credor[key].custo_brl += custo;
    await writeStore(store);
    comunicacaoCache.clear();
    return { status: 'ok', credor };
}
function isNodeError(error) {
    return error instanceof Error && 'code' in error;
}
async function queryEnvios(prisma, empresaId, filter) {
    const periodo = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, periodo.start, periodo.end];
    const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)(credorExpr, filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT e.idcredor,
             ${credorExpr} AS credor,
             COUNT(*)::bigint AS qtde_emails
      FROM tb_emails_enviados e
      LEFT JOIN tb_credor c ON c.id = e.idcredor
      WHERE e.idempresa = $1
        AND COALESCE(NULLIF(TRIM(c.grupo), ''), NULLIF(TRIM(c.razaosocial), '')) IS NOT NULL
        AND e.data >= $2
        AND e.data < $3
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%MODELO%'
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%SISTH%'
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%CONNECTH%'
        ${credorFilter}
      GROUP BY e.idcredor, ${credorExpr}
      ORDER BY qtde_emails DESC, credor
    `, ...params);
}
async function queryEnviosMensais(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getLivePeriodYearRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
    const credorFilterEmails = (0, reportFilters_1.buildSqlInFilter)(credorExpr, filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT date_trunc('month', e.data)::date AS mes,
             COUNT(*)::bigint AS qtde_emails
      FROM tb_emails_enviados e
      LEFT JOIN tb_credor c ON c.id = e.idcredor
      WHERE e.idempresa = $1
        AND COALESCE(NULLIF(TRIM(c.grupo), ''), NULLIF(TRIM(c.razaosocial), '')) IS NOT NULL
        AND e.data >= $2 AND e.data < $3
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%MODELO%'
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%SISTH%'
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%CONNECTH%'
        ${credorFilterEmails}
      GROUP BY 1
      ORDER BY mes
    `, ...params);
}
async function queryEnviosFromMonthlyAggregate(empresaId, filter) {
    const prisma = (0, emailMonthlyAggregateClient_1.getEmailMonthlyAggregateClient)();
    const periodo = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, periodo.start, periodo.end];
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)('m.credor', filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT m.idcredor,
             m.credor,
             SUM(m.qtde_emails)::bigint AS qtde_emails
      FROM portal_email_envios_dashboard m
      WHERE m.idempresa = $1
        AND m.mes >= $2::date
        AND m.mes < $3::date
        ${credorFilter}
      GROUP BY m.idcredor, m.credor
      ORDER BY qtde_emails DESC, credor
    `, ...params);
}
async function queryEnviosMensaisFromMonthlyAggregate(empresaId, filter) {
    const prisma = (0, emailMonthlyAggregateClient_1.getEmailMonthlyAggregateClient)();
    const range = (0, reportFilters_1.getLivePeriodYearRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const credorFilterEmails = (0, reportFilters_1.buildSqlInFilter)('m.credor', filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT m.mes,
             SUM(m.qtde_emails)::bigint AS qtde_emails
      FROM portal_email_envios_dashboard m
      WHERE m.idempresa = $1
        AND m.mes >= $2::date
        AND m.mes < $3::date
        ${credorFilterEmails}
      GROUP BY m.mes
      ORDER BY m.mes
    `, ...params);
}
async function queryEnviosDiarios(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
    const credorFilterEmails = (0, reportFilters_1.buildSqlInFilter)(credorExpr, filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT e.data::date AS data,
             COUNT(*)::bigint AS qtde_emails
      FROM tb_emails_enviados e
      LEFT JOIN tb_credor c ON c.id = e.idcredor
      WHERE e.idempresa = $1
        AND COALESCE(NULLIF(TRIM(c.grupo), ''), NULLIF(TRIM(c.razaosocial), '')) IS NOT NULL
        AND e.data >= $2 AND e.data < $3
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%MODELO%'
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%SISTH%'
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%CONNECTH%'
        ${credorFilterEmails}
      GROUP BY 1
      ORDER BY data
    `, ...params);
}
async function getCommunicationUncached(filter) {
    const clients = (0, prismaClients_1.getLiveClients)(filter.sistema);
    const companyIds = (0, reportFilters_2.getSystemCompanyIds)(filter.sistema);
    const includeDaily = filter.diario !== false;
    const useAggregate = useEmailMonthlyAggregate(filter);
    const [enviosResults, enviosMensaisResults, enviosDiariosResults, store] = await Promise.all([
        getCachedEmailQuery(getEmailQueryCacheKey('credor', filter), () => useAggregate
            ? Promise.all(companyIds.map((empresaId) => queryEnviosFromMonthlyAggregate(empresaId, filter)))
            : Promise.all(clients.map(({ empresaId, query }) => query((prisma) => queryEnvios(prisma, empresaId, filter))))),
        getCachedEmailQuery(getEmailQueryCacheKey('mensal', filter), () => useAggregate
            ? Promise.all(companyIds.map((empresaId) => queryEnviosMensaisFromMonthlyAggregate(empresaId, filter)))
            : Promise.all(clients.map(({ empresaId, query }) => query((prisma) => queryEnviosMensais(prisma, empresaId, filter))))),
        includeDaily
            ? getCachedEmailQuery(getEmailQueryCacheKey('diario', filter), () => Promise.all(clients.map(({ empresaId, query }) => query((prisma) => queryEnviosDiarios(prisma, empresaId, filter)))))
            : Promise.resolve([]),
        readStore(),
    ]);
    const porCredor = new Map();
    for (const row of enviosResults.flat()) {
        const credor = String(row.credor ?? row.idcredor);
        const current = porCredor.get(credor) ?? { credor, qtde_emails: 0, mensagens_wati: 0, custo_wati: 0 };
        current.qtde_emails += Number(row.qtde_emails ?? 0);
        porCredor.set(credor, current);
    }
    for (const wati of Object.values(store.por_credor)) {
        if (!wati.credor || ['None', 'SEM_CREDOR', 'Nao identificado'].includes(wati.credor))
            continue;
        const current = porCredor.get(wati.credor) ?? { credor: wati.credor, qtde_emails: 0, mensagens_wati: 0, custo_wati: 0 };
        current.mensagens_wati += Number(wati.mensagens ?? 0);
        current.custo_wati += Number(wati.custo_brl ?? 0);
        porCredor.set(wati.credor, current);
    }
    const mensal = new Map();
    for (const row of enviosMensaisResults.flat()) {
        const key = row.mes instanceof Date ? (0, reportFilters_1.monthKey)(row.mes) : String(row.mes).slice(0, 7);
        const current = mensal.get(key) ?? { mes: key, qtde_emails: 0, mensagens_wati: 0 };
        current.qtde_emails += Number(row.qtde_emails ?? 0);
        mensal.set(key, current);
    }
    for (const day of store.dias) {
        const key = day.data.slice(0, 7);
        const current = mensal.get(key) ?? { mes: key, qtde_emails: 0, mensagens_wati: 0 };
        current.mensagens_wati += Number(day.mensagens ?? 0);
        mensal.set(key, current);
    }
    const diario = new Map();
    for (const row of enviosDiariosResults.flat()) {
        const key = row.data instanceof Date ? row.data.toISOString().slice(0, 10) : String(row.data).slice(0, 10);
        const current = diario.get(key) ?? { data: key, qtde_emails: 0, mensagens_wati: 0 };
        current.qtde_emails += Number(row.qtde_emails ?? 0);
        diario.set(key, current);
    }
    if (includeDaily) {
        for (const day of store.dias) {
            const current = diario.get(day.data) ?? { data: day.data, qtde_emails: 0, mensagens_wati: 0 };
            current.mensagens_wati += Number(day.mensagens ?? 0);
            diario.set(day.data, current);
        }
    }
    const porCredorList = Array.from(porCredor.values()).sort((a, b) => b.qtde_emails + b.mensagens_wati - (a.qtde_emails + a.mensagens_wati));
    const totalEmails = porCredorList.reduce((sum, row) => sum + row.qtde_emails, 0);
    const totalWati = porCredorList.reduce((sum, row) => sum + row.mensagens_wati, 0);
    return {
        data_file: DATA_FILE,
        envios: {
            emails: totalEmails,
            whatsapp: totalWati,
            custo_whatsapp: porCredorList.reduce((sum, row) => sum + row.custo_wati, 0),
        },
        por_credor: porCredorList,
        mensal: Array.from(mensal.values()).sort((a, b) => a.mes.localeCompare(b.mes)),
        diario: Array.from(diario.values()).sort((a, b) => a.data.localeCompare(b.data)),
    };
}
async function getCommunication(filter) {
    const key = getCommunicationCacheKey(filter);
    const cached = comunicacaoCache.get(key);
    if (cached && cached.expiresAt > Date.now())
        return cached.data;
    const pending = comunicacaoPending.get(key);
    if (pending)
        return pending;
    const request = getCommunicationUncached(filter)
        .then((data) => {
        comunicacaoCache.set(key, { data, expiresAt: Date.now() + COMUNICACAO_CACHE_TTL_MS });
        return data;
    })
        .finally(() => {
        comunicacaoPending.delete(key);
    });
    comunicacaoPending.set(key, request);
    return request;
}
//# sourceMappingURL=communicationService.js.map