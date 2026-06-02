import { promises as fs } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import sql from 'mssql';
import { getLiveClients } from '../db/prismaClients';
import { getEmailClickReport } from '../routes/emailTrackingRoutes';
import type { DashboardResultGraphsQuery } from '../routes/schemas';
import { buildSqlInFilter, getPeriodRange } from '../utils/reportFilters';
import { CACHE_TTL, cacheKey, getCached } from '../utils/cache';

type EmailSendCreditorRow = {
  credor: string | null;
  qtde_emails: number | string | null;
};

type EmailSendDayRow = {
  dia: Date | string;
  qtde_emails: number | string | null;
};

type EmailEventSummary = {
  entregues: number;
  bounces: number;
  abertos: number;
};

type EmailClickDailyRow = {
  dia: Date | string;
  cliques: number | string | null;
};

type WatiStore = {
  dias?: Array<{ data: string; mensagens: number; custo_brl?: number }>;
  por_credor?: Record<string, { credor: string; mensagens: number; custo_brl?: number }>;
};

type CommunicationSnapshot = {
  envios: { emails: number; whatsapp: number; custo_whatsapp: number };
  por_credor: Array<{ credor: string; qtde_emails: number; mensagens_wati: number; custo_wati: number }>;
  diario: Array<{ data: string; qtde_emails: number; mensagens_wati: number }>;
};

const DATA_FILE = process.env.WATI_DATA_FILE ?? path.resolve(process.cwd(), 'data', 'custos_wati.json');

let pool: sql.ConnectionPool | null = null;
let poolPromise: Promise<sql.ConnectionPool> | null = null;

function previousPeriod(periodo?: string) {
  const range = getPeriodRange(periodo);
  const date = new Date(range.start);
  date.setUTCMonth(date.getUTCMonth() - 1);
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function rate(part: number, total: number) {
  return total > 0 ? (part / total) * 100 : 0;
}

function dayKey(value: string | Date) {
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function samePeriod(date: string, periodo?: string) {
  return periodo ? date.slice(0, 7) === periodo : true;
}

function acceptsCredor(credor: string, filter: DashboardResultGraphsQuery) {
  return !filter.credores.length || filter.credores.includes(credor);
}

async function readWatiStore(): Promise<WatiStore> {
  try {
    return JSON.parse(await fs.readFile(DATA_FILE, 'utf-8')) as WatiStore;
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ENOENT') return {};
    throw error;
  }
}

function addCredorInputs(request: sql.Request, credores?: string[]) {
  const values = Array.from(new Set(credores?.map((item) => item.trim()).filter(Boolean) ?? []));
  values.forEach((credor, index) => request.input(`credor${index}`, sql.NVarChar(150), credor));
  return values.length
    ? `AND COALESCE(NULLIF(LTRIM(RTRIM(e.grupo)), ''), NULLIF(LTRIM(RTRIM(e.credor)), ''), 'OUTROS') IN (${values.map((_, index) => `@credor${index}`).join(', ')})`
    : '';
}

async function getSqlConnection() {
  if (pool?.connected) return pool;
  if (poolPromise) return poolPromise;

  if (!process.env.AZURE_SQL_SERVER || !process.env.AZURE_SQL_DATABASE || !process.env.AZURE_SQL_USER || !process.env.AZURE_SQL_PASSWORD) {
    return null;
  }

  const nextPool = new sql.ConnectionPool({
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

async function queryEmailSendsByCreditor(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
  const credorFilter = buildSqlInFilter(credorExpr, filter.credores, params);

  return prisma.$queryRawUnsafe<EmailSendCreditorRow[]>(
    `
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
    `,
    ...params
  );
}

async function queryEmailSendsByDay(prisma: PrismaClient, empresaId: number, filter: DashboardResultGraphsQuery) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
  const credorFilter = buildSqlInFilter(credorExpr, filter.credores, params);

  return prisma.$queryRawUnsafe<EmailSendDayRow[]>(
    `
      SELECT e.data::date AS dia,
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
      GROUP BY e.data::date
      ORDER BY dia
    `,
    ...params
  );
}

async function queryEmailEvents(filter: DashboardResultGraphsQuery): Promise<EmailEventSummary> {
  const connection = await getSqlConnection();
  if (!connection) return { entregues: 0, bounces: 0, abertos: 0 };

  const range = getPeriodRange(filter.periodo);
  const request = connection
    .request()
    .input('start', sql.DateTime2, range.start)
    .input('end', sql.DateTime2, range.end);
  const credorFilter = addCredorInputs(request, filter.credores);

  const result = await request.query<Array<{ entregues: number | string | null; bounces: number | string | null }>>(`
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

async function queryEmailClickDaily(filter: DashboardResultGraphsQuery): Promise<EmailClickDailyRow[]> {
  const connection = await getSqlConnection();
  if (!connection) return [];

  const range = getPeriodRange(filter.periodo);
  const request = connection
    .request()
    .input('start', sql.DateTime2, range.start)
    .input('end', sql.DateTime2, range.end);
  const credorFilter = addCredorInputs(request, filter.credores);

  const result = await request.query<EmailClickDailyRow[]>(`
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

async function getCommunicationSnapshot(filter: DashboardResultGraphsQuery): Promise<CommunicationSnapshot> {
  const [emailByCreditorResults, emailByDayResults, store] = await Promise.all([
    Promise.all(getLiveClients(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryEmailSendsByCreditor(prisma, empresaId, filter)))),
    Promise.all(getLiveClients(filter.sistema).map(({ empresaId, query }) => query((prisma) => queryEmailSendsByDay(prisma, empresaId, filter)))),
    readWatiStore(),
  ]);

  const porCredor = new Map<string, { credor: string; qtde_emails: number; mensagens_wati: number; custo_wati: number }>();
  emailByCreditorResults.flat().forEach((row) => {
    const credor = String(row.credor ?? 'OUTROS');
    const current = porCredor.get(credor) ?? { credor, qtde_emails: 0, mensagens_wati: 0, custo_wati: 0 };
    current.qtde_emails += Number(row.qtde_emails ?? 0);
    porCredor.set(credor, current);
  });

  Object.values(store.por_credor ?? {}).forEach((wati) => {
    if (!wati.credor || ['None', 'SEM_CREDOR', 'Nao identificado'].includes(wati.credor)) return;
    if (!acceptsCredor(wati.credor, filter)) return;
    const current = porCredor.get(wati.credor) ?? { credor: wati.credor, qtde_emails: 0, mensagens_wati: 0, custo_wati: 0 };
    current.mensagens_wati += Number(wati.mensagens ?? 0);
    current.custo_wati += Number(wati.custo_brl ?? 0);
    porCredor.set(wati.credor, current);
  });

  const diario = new Map<string, { data: string; qtde_emails: number; mensagens_wati: number }>();
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

function buildCommunicationPayload(current: CommunicationSnapshot, clicks: Awaited<ReturnType<typeof getEmailClickReport>>, clickDailyRows: EmailClickDailyRow[], events: EmailEventSummary, previous: CommunicationSnapshot, previousClicks: Awaited<ReturnType<typeof getEmailClickReport>>, filter: DashboardResultGraphsQuery) {
  const porCredor = new Map<string, { credor: string; enviados: number; cliques: number; taxaClique: number }>();
  const touch = (credor: string) => {
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

  const daily = new Map<string, { dia: string; enviados: number; cliques: number }>();
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

async function buildDashboardCommunicationSummary(filter: DashboardResultGraphsQuery) {
  const previousFilter = { ...filter, periodo: previousPeriod(filter.periodo) };
  const [currentCommunication, emailClicks, emailClickDaily, emailEvents, previousCommunication, previousEmailClicks] = await Promise.all([
    getCommunicationSnapshot(filter),
    getEmailClickReport(filter),
    queryEmailClickDaily(filter),
    queryEmailEvents(filter),
    getCommunicationSnapshot(previousFilter),
    getEmailClickReport(previousFilter),
  ]);

  return buildCommunicationPayload(currentCommunication, emailClicks, emailClickDaily, emailEvents, previousCommunication, previousEmailClicks, filter);
}

export async function getDashboardCommunicationSummary(filter: DashboardResultGraphsQuery) {
  return getCached(cacheKey('dashboard-communication-summary', filter), CACHE_TTL.COMMUNICATION, () => buildDashboardCommunicationSummary(filter));
}
