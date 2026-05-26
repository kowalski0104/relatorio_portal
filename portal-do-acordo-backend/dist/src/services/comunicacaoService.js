import { promises as fs } from 'fs';
import path from 'path';
import { buildSqlInFilter, getLivePeriodYearRange, getPeriodoRange, monthKey } from './shared';
import { getLiveClients } from './liveClients';
const DATA_FILE = process.env.WATI_DATA_FILE ?? path.resolve(process.cwd(), 'data', 'custos_wati.json');
const CUSTO_POR_MENSAGEM_BRL = Number(process.env.WATI_MESSAGE_COST_BRL ?? 0.05);
const COMUNICACAO_CACHE_TTL_MS = Number(process.env.COMUNICACAO_CACHE_TTL_MS ?? 30 * 60 * 1000);
const EVENTOS_COBRADOS = new Set((process.env.WATI_BILLABLE_EVENTS ?? 'templateMessageSent_v2,templateMessageSent')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean));
const comunicacaoCache = new Map();
const comunicacaoPending = new Map();
function getComunicacaoCacheKey(filter) {
    const credores = [...(filter.credores ?? [])].map((item) => item.trim()).filter(Boolean).sort();
    return JSON.stringify({
        periodo: filter.periodo ?? '',
        sistema: filter.sistema ?? 'total',
        credores,
    });
}
function emptyStore() {
    return { total_brl: 0, mensagens: 0, dias: [], por_credor: {} };
}
async function readStore() {
    try {
        const raw = await fs.readFile(DATA_FILE, 'utf-8');
        const parsed = JSON.parse(raw);
        return {
            total_brl: Number(parsed.total_brl ?? 0),
            mensagens: Number(parsed.mensagens ?? 0),
            dias: Array.isArray(parsed.dias) ? parsed.dias : [],
            por_credor: parsed.por_credor ?? {},
        };
    }
    catch (error) {
        if (error?.code === 'ENOENT')
            return emptyStore();
        throw error;
    }
}
async function writeStore(store) {
    await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
    await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
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
export async function handleWatiWebhook(payload) {
    const eventType = String(payload?.eventType ?? '');
    const waId = String(payload?.waId ?? '');
    if (!EVENTOS_COBRADOS.has(eventType)) {
        return { status: 'ignorado', evento: eventType };
    }
    let custo = CUSTO_POR_MENSAGEM_BRL;
    const payloadCost = Number(payload?.cost ?? payload?.price);
    if (Number.isFinite(payloadCost) && payloadCost >= 0)
        custo = payloadCost;
    const phone = waId ? normalizePhone(waId) : '';
    let idcredor = null;
    let credor = 'Nao identificado';
    if (phone) {
        for (const { prisma } of getLiveClients('total')) {
            try {
                idcredor = await findCredorByPhone(prisma, phone);
                if (idcredor) {
                    credor = await findCredorName(prisma, idcredor);
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
async function queryEnvios(prisma, filter) {
    const periodo = getPeriodoRange(filter.periodo);
    const params = [periodo.start, periodo.end];
    const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
    const credorFilter = buildSqlInFilter(credorExpr, filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT e.idcredor,
             ${credorExpr} AS credor,
             COUNT(*)::bigint AS qtde_emails,
             0::bigint AS qtde_sms,
             COUNT(*)::bigint AS total_envios
      FROM tb_emails_enviados e
      LEFT JOIN tb_credor c ON c.id = e.idcredor
      WHERE COALESCE(NULLIF(TRIM(c.grupo), ''), NULLIF(TRIM(c.razaosocial), '')) IS NOT NULL
        AND e.data >= $1
        AND e.data < $2
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%MODELO%'
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%SISTH%'
        AND COALESCE(c.razaosocial, '') NOT ILIKE '%CONNECTH%'
        ${credorFilter}
      GROUP BY e.idcredor, ${credorExpr}
      ORDER BY total_envios DESC, credor
    `, ...params);
}
async function queryEnviosMensais(prisma, filter) {
    const range = getLivePeriodYearRange(filter.periodo);
    const params = [range.start, range.end];
    const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
    const credorFilterEmails = buildSqlInFilter(credorExpr, filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT date_trunc('month', e.data)::date AS mes,
             COUNT(*)::bigint AS qtde_emails,
             0::bigint AS qtde_sms,
             COUNT(*)::bigint AS total_envios
      FROM tb_emails_enviados e
      LEFT JOIN tb_credor c ON c.id = e.idcredor
      WHERE e.data >= $1 AND e.data < $2
        ${credorFilterEmails}
      GROUP BY 1
      ORDER BY mes
    `, ...params);
}
async function getComunicacaoUncached(filter) {
    const [enviosResults, enviosMensaisResults, store] = await Promise.all([
        Promise.all(getLiveClients(filter.sistema).map(({ prisma }) => queryEnvios(prisma, filter))),
        Promise.all(getLiveClients(filter.sistema).map(({ prisma }) => queryEnviosMensais(prisma, filter))),
        readStore(),
    ]);
    const porCredor = new Map();
    for (const row of enviosResults.flat()) {
        const credor = String(row.credor ?? row.idcredor);
        const current = porCredor.get(credor) ?? { credor, qtde_emails: 0, qtde_sms: 0, total_envios: 0, mensagens_wati: 0, custo_wati: 0 };
        current.qtde_emails += Number(row.qtde_emails ?? 0);
        current.qtde_sms += Number(row.qtde_sms ?? 0);
        current.total_envios += Number(row.total_envios ?? 0);
        porCredor.set(credor, current);
    }
    for (const wati of Object.values(store.por_credor)) {
        if (!wati.credor || ['None', 'SEM_CREDOR', 'Nao identificado'].includes(wati.credor))
            continue;
        const current = porCredor.get(wati.credor) ?? { credor: wati.credor, qtde_emails: 0, qtde_sms: 0, total_envios: 0, mensagens_wati: 0, custo_wati: 0 };
        current.mensagens_wati += Number(wati.mensagens ?? 0);
        current.custo_wati += Number(wati.custo_brl ?? 0);
        porCredor.set(wati.credor, current);
    }
    const mensal = new Map();
    for (const row of enviosMensaisResults.flat()) {
        const key = row.mes instanceof Date ? monthKey(row.mes) : String(row.mes).slice(0, 7);
        const current = mensal.get(key) ?? { mes: key, qtde_emails: 0, qtde_sms: 0, total_envios: 0, mensagens_wati: 0 };
        current.qtde_emails += Number(row.qtde_emails ?? 0);
        current.qtde_sms += Number(row.qtde_sms ?? 0);
        current.total_envios += Number(row.total_envios ?? 0);
        mensal.set(key, current);
    }
    for (const day of store.dias) {
        const key = day.data.slice(0, 7);
        const current = mensal.get(key) ?? { mes: key, qtde_emails: 0, qtde_sms: 0, total_envios: 0, mensagens_wati: 0 };
        current.mensagens_wati += Number(day.mensagens ?? 0);
        mensal.set(key, current);
    }
    const porCredorList = Array.from(porCredor.values()).sort((a, b) => b.total_envios + b.mensagens_wati - (a.total_envios + a.mensagens_wati));
    const totalEmails = porCredorList.reduce((sum, row) => sum + row.qtde_emails, 0);
    const totalSms = porCredorList.reduce((sum, row) => sum + row.qtde_sms, 0);
    const totalWati = porCredorList.reduce((sum, row) => sum + row.mensagens_wati, 0);
    return {
        data_file: DATA_FILE,
        envios: {
            emails: totalEmails,
            sms: totalSms,
            whatsapp: totalWati,
            total: totalEmails + totalSms + totalWati,
            custo_whatsapp: porCredorList.reduce((sum, row) => sum + row.custo_wati, 0),
        },
        por_credor: porCredorList,
        mensal: Array.from(mensal.values()).sort((a, b) => a.mes.localeCompare(b.mes)),
    };
}
export async function getComunicacao(filter) {
    const key = getComunicacaoCacheKey(filter);
    const cached = comunicacaoCache.get(key);
    if (cached && cached.expiresAt > Date.now())
        return cached.data;
    const pending = comunicacaoPending.get(key);
    if (pending)
        return pending;
    const request = getComunicacaoUncached(filter)
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
//# sourceMappingURL=comunicacaoService.js.map