"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.getDashboardCommunicationSummary = getDashboardCommunicationSummary;
const fs_1 = require("fs");
const path_1 = __importDefault(require("path"));
const mssql_1 = __importDefault(require("mssql"));
const prismaClients_1 = require("../db/prismaClients");
const emailTrackingRoutes_1 = require("../routes/emailTrackingRoutes");
const reportFilters_1 = require("../utils/reportFilters");
const cache_1 = require("../utils/cache");
const DATA_FILE = process.env.WATI_DATA_FILE ?? path_1.default.resolve(process.cwd(), 'data', 'custos_wati.json');
let pool = null;
let poolPromise = null;
function previousPeriod(periodo) {
    const range = (0, reportFilters_1.getPeriodRange)(periodo);
    const date = new Date(range.start);
    date.setUTCMonth(date.getUTCMonth() - 1);
    return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}
function rate(part, total) {
    return total > 0 ? (part / total) * 100 : 0;
}
function dayKey(value) {
    return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}
function samePeriod(date, periodo) {
    return periodo ? date.slice(0, 7) === periodo : true;
}
function acceptsCredor(credor, filter) {
    return !filter.credores.length || filter.credores.includes(credor);
}
async function readWatiStore() {
    try {
        return JSON.parse(await fs_1.promises.readFile(DATA_FILE, 'utf-8'));
    }
    catch (error) {
        if (error instanceof Error && 'code' in error && error.code === 'ENOENT')
            return {};
        throw error;
    }
}
function addCredorInputs(request, credores) {
    const values = Array.from(new Set(credores?.map((item) => item.trim()).filter(Boolean) ?? []));
    values.forEach((credor, index) => request.input(`credor${index}`, mssql_1.default.NVarChar(150), credor));
    return values.length
        ? `AND COALESCE(NULLIF(LTRIM(RTRIM(e.grupo)), ''), NULLIF(LTRIM(RTRIM(e.credor)), ''), 'OUTROS') IN (${values.map((_, index) => `@credor${index}`).join(', ')})`
        : '';
}
async function getSqlConnection() {
    if (pool?.connected)
        return pool;
    if (poolPromise)
        return poolPromise;
    if (!process.env.AZURE_SQL_SERVER || !process.env.AZURE_SQL_DATABASE || !process.env.AZURE_SQL_USER || !process.env.AZURE_SQL_PASSWORD) {
        return null;
    }
    const nextPool = new mssql_1.default.ConnectionPool({
        server: process.env.AZURE_SQL_SERVER,
        database: process.env.AZURE_SQL_DATABASE,
        user: process.env.AZURE_SQL_USER,
        password: process.env.AZURE_SQL_PASSWORD,
        pool: { max: 10, min: 0, idleTimeoutMillis: 30000 },
        options: { encrypt: true, trustServerCertificate: false, connectTimeout: 30000 },
    });
    nextPool.on('error', () => {
        pool = null;
        poolPromise = null;
    });
    poolPromise = nextPool.connect()
        .then((connectedPool) => {
        pool = connectedPool;
        return connectedPool;
    })
        .finally(() => {
        poolPromise = null;
    });
    return poolPromise;
}
async function queryEmailSendsByCreditor(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)(credorExpr, filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT ${credorExpr} AS credor,
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
      GROUP BY ${credorExpr}
    `, ...params);
}
async function queryEmailSendsByDay(prisma, empresaId, filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const params = [empresaId, range.start, range.end];
    const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
    const credorFilter = (0, reportFilters_1.buildSqlInFilter)(credorExpr, filter.credores, params);
    return prisma.$queryRawUnsafe(`
      SELECT e.data::date AS dia,
             COUNT(*)::bigint AS qtde_emails
      FROM tb_emails_enviados e
      LEFT JOIN tb_credor c ON c.id = e.idcredor
      WHERE e.idempresa = $1
        AND e.data >= $2
        AND e.data < $3
        ${credorFilter}
      GROUP BY e.data::date
      ORDER BY dia
    `, ...params);
}
async function queryEmailEvents(filter) {
    const connection = await getSqlConnection();
    if (!connection)
        return { entregues: 0, bounces: 0, abertos: 0 };
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const request = connection
        .request()
        .input('start', mssql_1.default.DateTime2, range.start)
        .input('end', mssql_1.default.DateTime2, range.end);
    const credorFilter = addCredorInputs(request, filter.credores);
    const result = await request.query(`
    SELECT
      SUM(CASE WHEN ev.tipo_evento = 'entregue' THEN 1 ELSE 0 END) AS entregues,
      SUM(CASE WHEN ev.tipo_evento IN ('hardbounce', 'softbounce') THEN 1 ELSE 0 END) AS bounces
    FROM email_eventos_mailgrid ev
    LEFT JOIN email_envios e ON e.msgid = ev.msgid
    WHERE COALESCE(ev.data_envio, ev.data_entrega, ev.criado_em) >= @start
      AND COALESCE(ev.data_envio, ev.data_entrega, ev.criado_em) < @end
      ${credorFilter}
  `);
    const row = result.recordset[0];
    return {
        entregues: Number(row?.entregues ?? 0),
        bounces: Number(row?.bounces ?? 0),
        abertos: 0,
    };
}
async function queryEmailClickDaily(filter) {
    const connection = await getSqlConnection();
    if (!connection)
        return [];
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    const request = connection
        .request()
        .input('start', mssql_1.default.DateTime2, range.start)
        .input('end', mssql_1.default.DateTime2, range.end);
    const credorFilter = addCredorInputs(request, filter.credores);
    const result = await request.query(`
    SELECT CONVERT(date, c.data_clique) AS dia,
           COUNT(*) AS cliques
    FROM email_cliques c
    LEFT JOIN email_envios e ON e.token = c.token
    WHERE c.data_clique >= @start
      AND c.data_clique < @end
      ${credorFilter}
    GROUP BY CONVERT(date, c.data_clique)
    ORDER BY dia
  `);
    return result.recordset;
}
async function getCommunicationSnapshot(filter) {
    const [emailByCreditorResults, emailByDayResults, store] = await Promise.all([
        Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryEmailSendsByCreditor(prisma, empresaId, filter)))),
        Promise.all((0, prismaClients_1.getLiveClients)(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryEmailSendsByDay(prisma, empresaId, filter)))),
        readWatiStore(),
    ]);
    const porCredor = new Map();
    emailByCreditorResults.flat().forEach((row) => {
        const credor = String(row.credor ?? 'OUTROS');
        const current = porCredor.get(credor) ?? { credor, qtde_emails: 0, mensagens_wati: 0, custo_wati: 0 };
        current.qtde_emails += Number(row.qtde_emails ?? 0);
        porCredor.set(credor, current);
    });
    Object.values(store.por_credor ?? {}).forEach((wati) => {
        if (!wati.credor || ['None', 'SEM_CREDOR', 'Nao identificado'].includes(wati.credor))
            return;
        if (!acceptsCredor(wati.credor, filter))
            return;
        const current = porCredor.get(wati.credor) ?? { credor: wati.credor, qtde_emails: 0, mensagens_wati: 0, custo_wati: 0 };
        current.mensagens_wati += Number(wati.mensagens ?? 0);
        current.custo_wati += Number(wati.custo_brl ?? 0);
        porCredor.set(wati.credor, current);
    });
    const diario = new Map();
    emailByDayResults.flat().forEach((row) => {
        const key = dayKey(row.dia);
        const current = diario.get(key) ?? { data: key, qtde_emails: 0, mensagens_wati: 0 };
        current.qtde_emails += Number(row.qtde_emails ?? 0);
        diario.set(key, current);
    });
    (store.dias ?? []).filter((day) => samePeriod(day.data, filter.periodo)).forEach((day) => {
        const current = diario.get(day.data) ?? { data: day.data, qtde_emails: 0, mensagens_wati: 0 };
        current.mensagens_wati += Number(day.mensagens ?? 0);
        diario.set(day.data, current);
    });
    const rows = Array.from(porCredor.values());
    return {
        envios: {
            emails: rows.reduce((sum, row) => sum + row.qtde_emails, 0),
            whatsapp: rows.reduce((sum, row) => sum + row.mensagens_wati, 0),
            custo_whatsapp: rows.reduce((sum, row) => sum + row.custo_wati, 0),
        },
        por_credor: rows.sort((a, b) => b.qtde_emails + b.mensagens_wati - (a.qtde_emails + a.mensagens_wati)),
        diario: Array.from(diario.values()).sort((a, b) => a.data.localeCompare(b.data)),
    };
}
function buildCommunicationPayload(current, clicks, clickDailyRows, events, previous, previousClicks, filter) {
    const porCredor = new Map();
    const touch = (credor) => {
        const currentRow = porCredor.get(credor) ?? { credor, enviados: 0, cliques: 0, taxaClique: 0 };
        porCredor.set(credor, currentRow);
        return currentRow;
    };
    current.por_credor.forEach((row) => {
        const item = touch(row.credor);
        item.enviados += row.qtde_emails + row.mensagens_wati;
    });
    clicks.por_credor.forEach((row) => {
        touch(row.credor).cliques += row.cliques;
    });
    const daily = new Map();
    current.diario.forEach((row) => {
        const item = daily.get(row.data) ?? { dia: row.data, enviados: 0, cliques: 0 };
        item.enviados += row.qtde_emails + row.mensagens_wati;
        daily.set(row.data, item);
    });
    clickDailyRows.forEach((row) => {
        const key = dayKey(row.dia);
        const item = daily.get(key) ?? { dia: key, enviados: 0, cliques: 0 };
        item.cliques += Number(row.cliques ?? 0);
        daily.set(key, item);
    });
    const emailEnviados = current.envios.emails;
    const whatsappEnviados = current.envios.whatsapp;
    const emailCliques = clicks.total.cliques;
    const previousEnviados = previous.envios.emails + previous.envios.whatsapp;
    const previousTotalCliques = previousClicks.total.cliques;
    return {
        data: {
            periodo: filter.periodo ?? null,
            whatsapp: {
                enviados: whatsappEnviados,
                entregues: 0,
                lidos: 0,
                cliques: 0,
                taxaEntrega: 0,
                taxaLeitura: 0,
                taxaClique: 0,
            },
            email: {
                enviados: emailEnviados,
                entregues: events.entregues,
                abertos: events.abertos,
                cliques: emailCliques,
                bounces: events.bounces,
                taxaEntrega: rate(events.entregues, emailEnviados),
                taxaAbertura: rate(events.abertos, events.entregues || emailEnviados),
                taxaClique: rate(emailCliques, emailEnviados),
            },
            porCredor: Array.from(porCredor.values())
                .map((row) => ({ ...row, taxaClique: rate(row.cliques, row.enviados) }))
                .sort((a, b) => b.cliques - a.cliques || b.enviados - a.enviados || a.credor.localeCompare(b.credor)),
            evolucaoDiaria: Array.from(daily.values()).sort((a, b) => a.dia.localeCompare(b.dia)),
            anterior: {
                enviados: previousEnviados,
                cliques: previousTotalCliques,
                taxaClique: rate(previousTotalCliques, previousEnviados),
            },
            disponibilidade: {
                whatsappTracking: false,
                emailAbertura: false,
                observacao: 'WhatsApp entregue/lido/clique e abertura de e-mail nao existem nas fontes atuais do backend.',
            },
        },
    };
}
async function buildDashboardCommunicationSummary(filter) {
    const previousFilter = { ...filter, periodo: previousPeriod(filter.periodo) };
    const [currentCommunication, emailClicks, emailClickDaily, emailEvents, previousCommunication, previousEmailClicks] = await Promise.all([
        getCommunicationSnapshot(filter),
        (0, emailTrackingRoutes_1.getEmailClickReport)(filter),
        queryEmailClickDaily(filter),
        queryEmailEvents(filter),
        getCommunicationSnapshot(previousFilter),
        (0, emailTrackingRoutes_1.getEmailClickReport)(previousFilter),
    ]);
    return buildCommunicationPayload(currentCommunication, emailClicks, emailClickDaily, emailEvents, previousCommunication, previousEmailClicks, filter);
}
async function getDashboardCommunicationSummary(filter) {
    return (0, cache_1.getCached)((0, cache_1.cacheKey)('dashboard-communication-summary', filter), cache_1.CACHE_TTL.COMMUNICATION, () => buildDashboardCommunicationSummary(filter));
}
//# sourceMappingURL=dashboardCommunicationService.js.map