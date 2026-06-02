import { promises as fs } from 'fs';
import path from 'path';
import { PrismaClient } from '@prisma/client';
import { buildSqlInFilter, getLivePeriodYearRange, getPeriodRange, monthKey, ReportFilter } from '../utils/reportFilters';
import { getLiveClients } from '../db/prismaClients';
import { getEmailMonthlyAggregateClient } from '../db/emailMonthlyAggregateClient';
import { getSystemCompanyIds } from '../utils/reportFilters';

type EnvioRow = {
  idcredor: number | string;
  credor: string | null;
  qtde_emails: number | string | null;
};

type EnvioMensalRow = {
  mes: Date | string;
  qtde_emails: number | string | null;
};

type EnvioDiarioRow = {
  data: Date | string;
  qtde_emails: number | string | null;
};

type WatiDia = {
  data: string;
  mensagens: number;
  custo_brl: number;
};

type WatiCredor = {
  idcredor: string;
  credor: string;
  mensagens: number;
  custo_brl: number;
};

type WatiStore = {
  total_brl: number;
  mensagens: number;
  dias: WatiDia[];
  por_credor: Record<string, WatiCredor>;
};

type WhatsAppWebhookPayload = {
  eventType?: unknown;
  waId?: unknown;
  cost?: unknown;
  price?: unknown;
};

const DATA_FILE = process.env.WATI_DATA_FILE ?? path.resolve(process.cwd(), 'data', 'custos_wati.json');
const CUSTO_POR_MENSAGEM_BRL = Number(process.env.WATI_MESSAGE_COST_BRL ?? 0.05);
const COMUNICACAO_CACHE_TTL_MS = Number(process.env.COMUNICACAO_CACHE_TTL_MS ?? 30 * 60 * 1000);
const EVENTOS_COBRADOS = new Set(
  (process.env.WATI_BILLABLE_EVENTS ?? 'templateMessageSent_v2,templateMessageSent')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
);

type ComunicacaoResult = {
  data_file: string;
  envios: {
    emails: number;
    whatsapp: number;
    custo_whatsapp: number;
  };
  por_credor: Array<{ credor: string; qtde_emails: number; mensagens_wati: number; custo_wati: number }>;
  mensal: Array<{ mes: string; qtde_emails: number; mensagens_wati: number }>;
  diario: Array<{ data: string; qtde_emails: number; mensagens_wati: number }>;
};

type CommunicationFilter = ReportFilter & {
  diario?: boolean;
};

const comunicacaoCache = new Map<string, { expiresAt: number; data: ComunicacaoResult }>();
const comunicacaoPending = new Map<string, Promise<ComunicacaoResult>>();
const emailQueryCache = new Map<string, { expiresAt: number; data: unknown }>();
const emailQueryPending = new Map<string, Promise<unknown>>();

function normalizedCredores(filter: ReportFilter) {
  return [...(filter.credores ?? [])].map((item) => item.trim()).filter(Boolean).sort();
}

function useEmailMonthlyAggregate(filter: CommunicationFilter) {
  return process.env.USE_EMAIL_MONTHLY_AGGREGATE === 'true' && filter.diario === false;
}

function getCommunicationCacheKey(filter: CommunicationFilter) {
  const diario = filter.diario !== false;
  return JSON.stringify({
    periodo: filter.periodo ?? '',
    sistema: filter.sistema ?? 'total',
    credores: normalizedCredores(filter),
    diario,
    emailSource: useEmailMonthlyAggregate(filter) ? 'monthly-aggregate' : 'source',
  });
}

function getEmailQueryCacheKey(scope: 'credor' | 'mensal' | 'diario', filter: CommunicationFilter) {
  const periodo = scope === 'mensal' ? (filter.periodo ?? '').slice(0, 4) : filter.periodo ?? '';
  return JSON.stringify({
    scope,
    periodo,
    sistema: filter.sistema ?? 'total',
    credores: normalizedCredores(filter),
    emailSource: useEmailMonthlyAggregate(filter) ? 'monthly-aggregate' : 'source',
  });
}

function getCachedEmailQuery<T>(key: string, producer: () => Promise<T>) {
  const cached = emailQueryCache.get(key) as { expiresAt: number; data: T } | undefined;
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.data);

  const pending = emailQueryPending.get(key) as Promise<T> | undefined;
  if (pending) return pending;

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

function emptyStore(): WatiStore {
  return { total_brl: 0, mensagens: 0, dias: [], por_credor: {} };
}

async function readStore(): Promise<WatiStore> {
  try {
    const raw = await fs.readFile(DATA_FILE, 'utf-8');
    const parsed = JSON.parse(raw) as Partial<WatiStore>;
    return {
      total_brl: Number(parsed.total_brl ?? 0),
      mensagens: Number(parsed.mensagens ?? 0),
      dias: Array.isArray(parsed.dias) ? parsed.dias : [],
      por_credor: parsed.por_credor ?? {},
    };
  } catch (error) {
    if (isNodeError(error) && error.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

async function writeStore(store: WatiStore) {
  await fs.mkdir(path.dirname(DATA_FILE), { recursive: true });
  await fs.writeFile(DATA_FILE, JSON.stringify(store, null, 2), 'utf-8');
}

function normalizePhone(waId: string) {
  let phone = waId.trim();
  if (phone.startsWith('55') && phone.length > 11) phone = phone.slice(2);
  return phone;
}

async function findCredorByPhone(prisma: PrismaClient, phone: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ idcredor: number | string }>>(
    `
      SELECT d.idcredor
      FROM tb_devedor_fones f
      JOIN tb_devedor d ON d.id = f.iddevedor
      WHERE f.fone = $1 AND d.idcredor IS NOT NULL
      ORDER BY CASE WHEN f.status = 'ATIVO' THEN 0 ELSE 1 END
      LIMIT 1
    `,
    phone
  );
  return rows[0]?.idcredor ? String(rows[0].idcredor) : null;
}

async function findCredorName(prisma: PrismaClient, idcredor: string) {
  const rows = await prisma.$queryRawUnsafe<Array<{ grupo: string | null; razaosocial: string | null }>>(
    `
      SELECT TRIM(grupo) AS grupo, TRIM(razaosocial) AS razaosocial
      FROM tb_credor
      WHERE id = $1
      LIMIT 1
    `,
    Number(idcredor)
  );
  const row = rows[0];
  return row?.grupo || row?.razaosocial || idcredor;
}

export async function handleWhatsAppWebhook(payload: WhatsAppWebhookPayload) {
  const eventType = String(payload.eventType ?? '');
  const waId = String(payload.waId ?? '');

  if (!EVENTOS_COBRADOS.has(eventType)) {
    return { status: 'ignorado', evento: eventType };
  }

  let custo = CUSTO_POR_MENSAGEM_BRL;
  const payloadCost = Number(payload.cost ?? payload.price);
  if (Number.isFinite(payloadCost) && payloadCost >= 0) custo = payloadCost;

  const phone = waId ? normalizePhone(waId) : '';
  let idcredor: string | null = null;
  let credor = 'Nao identificado';

  if (phone) {
    for (const { query } of getLiveClients('total')) {
      try {
        const match = await query(async (prisma) => {
          const foundCredorId = await findCredorByPhone(prisma, phone);
          if (!foundCredorId) return null;
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
      } catch (error) {
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && 'code' in error;
}

async function queryEnvios(prisma: PrismaClient, empresaId: number, filter: ReportFilter) {
  const periodo = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, periodo.start, periodo.end];
  const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
  const credorFilter = buildSqlInFilter(credorExpr, filter.credores, params);

  return prisma.$queryRawUnsafe<EnvioRow[]>(
    `
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
    `,
    ...params
  );
}

async function queryEnviosMensais(prisma: PrismaClient, empresaId: number, filter: ReportFilter) {
  const range = getLivePeriodYearRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
  const credorFilterEmails = buildSqlInFilter(credorExpr, filter.credores, params);

  return prisma.$queryRawUnsafe<EnvioMensalRow[]>(
    `
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
    `,
    ...params
  );
}

async function queryEnviosFromMonthlyAggregate(empresaId: number, filter: ReportFilter) {
  const prisma = getEmailMonthlyAggregateClient();
  const periodo = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, periodo.start, periodo.end];
  const credorFilter = buildSqlInFilter('m.credor', filter.credores, params);

  return prisma.$queryRawUnsafe<EnvioRow[]>(
    `
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
    `,
    ...params
  );
}

async function queryEnviosMensaisFromMonthlyAggregate(empresaId: number, filter: ReportFilter) {
  const prisma = getEmailMonthlyAggregateClient();
  const range = getLivePeriodYearRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const credorFilterEmails = buildSqlInFilter('m.credor', filter.credores, params);

  return prisma.$queryRawUnsafe<EnvioMensalRow[]>(
    `
      SELECT m.mes,
             SUM(m.qtde_emails)::bigint AS qtde_emails
      FROM portal_email_envios_dashboard m
      WHERE m.idempresa = $1
        AND m.mes >= $2::date
        AND m.mes < $3::date
        ${credorFilterEmails}
      GROUP BY m.mes
      ORDER BY m.mes
    `,
    ...params
  );
}

async function queryEnviosDiarios(prisma: PrismaClient, empresaId: number, filter: ReportFilter) {
  const range = getPeriodRange(filter.periodo);
  const params: unknown[] = [empresaId, range.start, range.end];
  const credorExpr = "COALESCE(NULLIF(TRIM(c.grupo), ''), TRIM(c.razaosocial), 'OUTROS')";
  const credorFilterEmails = buildSqlInFilter(credorExpr, filter.credores, params);

  return prisma.$queryRawUnsafe<EnvioDiarioRow[]>(
    `
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
    `,
    ...params
  );
}

async function getCommunicationUncached(filter: CommunicationFilter): Promise<ComunicacaoResult> {
  const clients = getLiveClients(filter.sistema);
  const companyIds = getSystemCompanyIds(filter.sistema);
  const includeDaily = filter.diario !== false;
  const useAggregate = useEmailMonthlyAggregate(filter);
  const [enviosResults, enviosMensaisResults, enviosDiariosResults, store] = await Promise.all([
    getCachedEmailQuery(getEmailQueryCacheKey('credor', filter), () =>
      useAggregate
        ? Promise.all(companyIds.map((empresaId) => queryEnviosFromMonthlyAggregate(empresaId, filter)))
        : Promise.all(clients.map(({ empresaId, query }) => query((prisma) => queryEnvios(prisma, empresaId, filter))))
    ),
    getCachedEmailQuery(getEmailQueryCacheKey('mensal', filter), () =>
      useAggregate
        ? Promise.all(companyIds.map((empresaId) => queryEnviosMensaisFromMonthlyAggregate(empresaId, filter)))
        : Promise.all(clients.map(({ empresaId, query }) => query((prisma) => queryEnviosMensais(prisma, empresaId, filter))))
    ),
    includeDaily
      ? getCachedEmailQuery(getEmailQueryCacheKey('diario', filter), () =>
          Promise.all(clients.map(({ empresaId, query }) => query((prisma) => queryEnviosDiarios(prisma, empresaId, filter))))
        )
      : Promise.resolve([] as EnvioDiarioRow[][]),
    readStore(),
  ]);

  const porCredor = new Map<string, { credor: string; qtde_emails: number; mensagens_wati: number; custo_wati: number }>();
  for (const row of enviosResults.flat()) {
    const credor = String(row.credor ?? row.idcredor);
    const current = porCredor.get(credor) ?? { credor, qtde_emails: 0, mensagens_wati: 0, custo_wati: 0 };
    current.qtde_emails += Number(row.qtde_emails ?? 0);
    porCredor.set(credor, current);
  }

  for (const wati of Object.values(store.por_credor)) {
    if (!wati.credor || ['None', 'SEM_CREDOR', 'Nao identificado'].includes(wati.credor)) continue;
    const current = porCredor.get(wati.credor) ?? { credor: wati.credor, qtde_emails: 0, mensagens_wati: 0, custo_wati: 0 };
    current.mensagens_wati += Number(wati.mensagens ?? 0);
    current.custo_wati += Number(wati.custo_brl ?? 0);
    porCredor.set(wati.credor, current);
  }

  const mensal = new Map<string, { mes: string; qtde_emails: number; mensagens_wati: number }>();
  for (const row of enviosMensaisResults.flat()) {
    const key = row.mes instanceof Date ? monthKey(row.mes) : String(row.mes).slice(0, 7);
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

  const diario = new Map<string, { data: string; qtde_emails: number; mensagens_wati: number }>();
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

export async function getCommunication(filter: CommunicationFilter) {
  const key = getCommunicationCacheKey(filter);
  const cached = comunicacaoCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  const pending = comunicacaoPending.get(key);
  if (pending) return pending;

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



