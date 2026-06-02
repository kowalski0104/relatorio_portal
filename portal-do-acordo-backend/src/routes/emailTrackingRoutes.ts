import { Router, Request, Response } from 'express';
import sql from 'mssql';
import { emailClicksQuerySchema } from './schemas';
import { getPeriodRange, ReportFilter } from '../utils/reportFilters';

export const clickRouter = Router();
const webhookRouter = Router();
const EMAIL_TRACKING_DEBUG = process.env.EMAIL_TRACKING_DEBUG === 'true';

type EmailClickSummaryRow = {
  credor: string | null;
  cliques: number | string | null;
  links_unicos: number | string | null;
  processos: number | string | null;
  destinatarios: number | string | null;
  campanhas: number | string | null;
  templates: number | string | null;
  ips: number | string | null;
  user_agents: number | string | null;
  primeiro_clique: Date | string | null;
  ultimo_clique: Date | string | null;
};

type EmailClickRecentRow = {
  token: string | null;
  processo: string | null;
  email_destinatario: string | null;
  credor: string | null;
  campanha: string | null;
  template: string | null;
  ip: string | null;
  user_agent: string | null;
  data_clique: Date | string | null;
};

// Pool de conexão reutilizável
let pool: sql.ConnectionPool | null = null;
let poolPromise: Promise<sql.ConnectionPool> | null = null;

function debugLog(...args: unknown[]) {
  if (EMAIL_TRACKING_DEBUG) console.log(...args);
}

async function getConnection(): Promise<sql.ConnectionPool> {
  if (pool && pool.connected) {
    return pool;
  }
  if (poolPromise) return poolPromise;

  const config: sql.config = {
    server: process.env.AZURE_SQL_SERVER || '',
    database: process.env.AZURE_SQL_DATABASE || '',
    user: process.env.AZURE_SQL_USER || '',
    password: process.env.AZURE_SQL_PASSWORD || '',
    pool: {
      max: 10,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options: {
      encrypt: true,
      trustServerCertificate: false,
      connectTimeout: 30000,
    },
  };

  debugLog('Criando nova pool de conexão...');
  const nextPool = new sql.ConnectionPool(config);

  nextPool.on('error', (err) => {
    console.error('Erro na pool:', err);
    pool = null;
    poolPromise = null;
  });

  poolPromise = nextPool.connect()
    .then((connectedPool) => {
      pool = connectedPool;
      debugLog('Pool conectada com sucesso');
      return connectedPool;
    })
    .catch((err) => {
      console.error('Erro ao conectar:', err);
      pool = null;
      throw err;
    })
    .finally(() => {
      poolPromise = null;
    });

  return poolPromise;
  /*
    console.error('❌ Erro ao conectar:', err);
}

  */
}

function toIso(value: Date | string | null) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}

function addCredorInputs(request: sql.Request, credores?: string[]) {
  const values = Array.from(new Set(credores?.map((item) => item.trim()).filter(Boolean) ?? []));
  values.forEach((credor, index) => request.input(`credor${index}`, sql.NVarChar(150), credor));
  return values.length ? `AND credor IN (${values.map((_, index) => `@credor${index}`).join(', ')})` : '';
}

function createEmailClickBaseSql() {
  return `
    WITH cliques AS (
      SELECT
        COALESCE(
          NULLIF(LTRIM(RTRIM(c.grupo)), ''),
          NULLIF(LTRIM(RTRIM(c.credor)), ''),
          NULLIF(LTRIM(RTRIM(e.grupo)), ''),
          NULLIF(LTRIM(RTRIM(e.credor)), ''),
          'OUTROS'
        ) AS credor,
        NULLIF(NULLIF(LTRIM(RTRIM(c.token)), ''), 'null') AS token,
        COALESCE(
          NULLIF(NULLIF(LTRIM(RTRIM(c.processo)), ''), 'null'),
          NULLIF(NULLIF(LTRIM(RTRIM(e.processo)), ''), 'null')
        ) AS processo,
        COALESCE(
          NULLIF(NULLIF(LTRIM(RTRIM(c.email_destinatario)), ''), 'null'),
          NULLIF(NULLIF(LTRIM(RTRIM(e.email_destinatario)), ''), 'null')
        ) AS email_destinatario,
        COALESCE(
          NULLIF(NULLIF(LTRIM(RTRIM(c.campanha)), ''), 'null'),
          NULLIF(NULLIF(LTRIM(RTRIM(e.campanha)), ''), 'null')
        ) AS campanha,
        COALESCE(
          NULLIF(NULLIF(LTRIM(RTRIM(c.template)), ''), 'null'),
          NULLIF(NULLIF(LTRIM(RTRIM(e.template)), ''), 'null')
        ) AS template,
        NULLIF(NULLIF(LTRIM(RTRIM(c.ip)), ''), 'null') AS ip,
        NULLIF(NULLIF(LTRIM(RTRIM(CONVERT(NVARCHAR(4000), c.user_agent))), ''), 'null') AS user_agent,
        c.data_clique
      FROM email_cliques c
      LEFT JOIN email_envios e ON e.token = c.token
      WHERE c.data_clique >= @start
        AND c.data_clique < @end
    )
  `;
}

type EmailClickFilter = ReportFilter & {
  dataFim?: string;
};

function getEmailClickRange(filter: EmailClickFilter) {
  const range = getPeriodRange(filter.periodo);
  if (!filter.dataFim) return range;

  const filteredEnd = new Date(`${filter.dataFim}T00:00:00Z`);
  filteredEnd.setUTCDate(filteredEnd.getUTCDate() + 1);
  return {
    start: range.start,
    end: filteredEnd < range.end ? filteredEnd : range.end,
  };
}

export async function getEmailClickReport(filter: EmailClickFilter) {
  const range = getEmailClickRange(filter);
  const connection = await getConnection();

  const summaryRequest = connection
    .request()
    .input('start', sql.DateTime2, range.start)
    .input('end', sql.DateTime2, range.end);
  const summaryCredorFilter = addCredorInputs(summaryRequest, filter.credores);
  const summaryResult = await summaryRequest.query<EmailClickSummaryRow[]>(`
    ${createEmailClickBaseSql()}
    SELECT
      credor,
      COUNT(*) AS cliques,
      COUNT(DISTINCT token) AS links_unicos,
      COUNT(DISTINCT processo) AS processos,
      COUNT(DISTINCT email_destinatario) AS destinatarios,
      COUNT(DISTINCT campanha) AS campanhas,
      COUNT(DISTINCT template) AS templates,
      COUNT(DISTINCT ip) AS ips,
      COUNT(DISTINCT user_agent) AS user_agents,
      MIN(data_clique) AS primeiro_clique,
      MAX(data_clique) AS ultimo_clique
    FROM cliques
    WHERE 1 = 1
      ${summaryCredorFilter}
    GROUP BY credor
    ORDER BY cliques DESC, credor
  `);

  const recentRequest = connection
    .request()
    .input('start', sql.DateTime2, range.start)
    .input('end', sql.DateTime2, range.end);
  const recentCredorFilter = addCredorInputs(recentRequest, filter.credores);
  const recentResult = await recentRequest.query<EmailClickRecentRow[]>(`
    ${createEmailClickBaseSql()}
    SELECT TOP 25
      token,
      processo,
      email_destinatario,
      credor,
      campanha,
      template,
      ip,
      user_agent,
      data_clique
    FROM cliques
    WHERE 1 = 1
      ${recentCredorFilter}
    ORDER BY data_clique DESC
  `);

  const porCredor = summaryResult.recordset.map((row) => ({
    credor: row.credor || 'OUTROS',
    cliques: Number(row.cliques ?? 0),
    links_unicos: Number(row.links_unicos ?? 0),
    processos: Number(row.processos ?? 0),
    destinatarios: Number(row.destinatarios ?? 0),
    campanhas: Number(row.campanhas ?? 0),
    templates: Number(row.templates ?? 0),
    ips: Number(row.ips ?? 0),
    user_agents: Number(row.user_agents ?? 0),
    primeiro_clique: toIso(row.primeiro_clique),
    ultimo_clique: toIso(row.ultimo_clique),
  }));

  return {
    total: {
      cliques: porCredor.reduce((sum, row) => sum + row.cliques, 0),
      links_unicos: porCredor.reduce((sum, row) => sum + row.links_unicos, 0),
      processos: porCredor.reduce((sum, row) => sum + row.processos, 0),
      destinatarios: porCredor.reduce((sum, row) => sum + row.destinatarios, 0),
    },
    por_credor: porCredor,
    recentes: recentResult.recordset.map((row) => ({
      token: row.token,
      processo: row.processo,
      email_destinatario: row.email_destinatario,
      credor: row.credor || 'OUTROS',
      campanha: row.campanha,
      template: row.template,
      ip: row.ip,
      user_agent: row.user_agent,
      data_clique: toIso(row.data_clique),
    })),
  };
}

// TESTE DE CONEXÃO
clickRouter.get('/test/connection', async (req: Request, res: Response) => {
  try {
    debugLog('Testando conexão ao Azure SQL...');
    
    const pool = await getConnection();
    
    const result = await pool.request().query('SELECT TOP 1 * FROM email_envios');
    
    res.json({ 
      success: true, 
      message: 'Conexão OK', 
      recordsFound: result.recordset.length 
    });
  } catch (error: any) {
    console.error('Erro na conexão:', error.message);
    res.status(500).json({ 
      success: false, 
      error: error.message,
      code: error.code 
    });
  }
});

webhookRouter.get('/cliques', async (req: Request, res: Response) => {
  const parseResult = emailClicksQuerySchema.safeParse(req.query);
  if (!parseResult.success) {
    return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
  }

  const report = await getEmailClickReport(parseResult.data);
  res.json({ data: report });
});

// ROTA DE CLIQUE
clickRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    debugLog('Clique recebido - Token:', token);

    const pool = await getConnection();

    // Buscar envio
    const result = await pool
      .request()
      .input('token', sql.VarChar(100), token)
      .query('SELECT TOP 1 * FROM email_envios WHERE token = @token');

    const envio = result.recordset[0];

    if (!envio) {
      console.warn('⚠️ Token não encontrado:', token);
      return res.status(404).send('Link não encontrado.');
    }

    debugLog('Envio encontrado:', envio.url_destino);

    // Salvar clique
    debugLog('Tentando salvar clique com dados:', {
      token,
      processo: envio.processo,
      email_destinatario: envio.email_destinatario,
      credor: envio.credor,
      grupo: envio.grupo,
    });

    const insertResult = await pool
      .request()
      .input('token', sql.VarChar(100), token)
      .input('processo', sql.VarChar(100), envio.processo)
      .input('email_destinatario', sql.VarChar(255), envio.email_destinatario)
      .input('credor', sql.VarChar(150), envio.credor)
      .input('grupo', sql.VarChar(150), envio.grupo)
      .input('campanha', sql.VarChar(150), envio.campanha)
      .input('template', sql.VarChar(150), envio.template)
      .input('ip', sql.VarChar(100), req.ip || 'unknown')
      .input('user_agent', sql.NVarChar(sql.MAX), req.headers['user-agent'] || '')
      .query(`
        INSERT INTO email_cliques (
          token,
          processo,
          email_destinatario,
          credor,
          grupo,
          campanha,
          template,
          ip,
          user_agent
        )
        VALUES (
          @token,
          @processo,
          @email_destinatario,
          @credor,
          @grupo,
          @campanha,
          @template,
          @ip,
          @user_agent
        )
      `);

    debugLog('Clique salvo com sucesso. Rows affected:', insertResult.rowsAffected);

    // Redirecionar
    return res.redirect(envio.url_destino);
  } catch (error: any) {
    console.error('❌ Erro ao processar clique:');
    console.error('Tipo de erro:', error.code);
    console.error('Mensagem:', error.message);
    console.error('Stack:', error.stack);
    res.status(500).send(`Erro: ${error.message}`);
  }
});

// ROTA DO WEBHOOK
webhookRouter.post('/webhook', async (req: Request, res: Response) => {
  try {
    const authHeader = req.headers['authorization'];
    const expectedToken = `Bearer ${process.env.MAILGRID_WEBHOOK_TOKEN}`;

    if (authHeader !== expectedToken) {
      console.warn('❌ Webhook não autorizado');
      return res.status(401).json({ error: 'Não autorizado' });
    }

    const evento = req.body;

    // Mapear status
    let tipoEvento = 'desconhecido';
    if (evento.status === 0) tipoEvento = 'hardbounce';
    if (evento.status === 1) tipoEvento = 'entregue';
    if (evento.status === 2) tipoEvento = 'softbounce';

    const pool = await getConnection();

    await pool
      .request()
      .input('msgid', sql.VarChar(255), evento.msgid || null)
      .input('status', sql.Int, evento.status || null)
      .input('tipo_evento', sql.VarChar(50), tipoEvento)
      .input('email_de', sql.VarChar(255), evento.email_de || null)
      .input('email_para', sql.VarChar(255), evento.email_para || null)
      .input('mensagem', sql.NVarChar(sql.MAX), evento.mensagem || null)
      .input('data_envio', sql.DateTime, evento.data_envio || null)
      .input('data_entrega', sql.DateTime, evento.data_entrega || null)
      .input('sender_ip', sql.VarChar(100), evento.sender_ip || null)
      .input('delivery_ip', sql.VarChar(100), evento.delivery_ip || null)
      .input('delivery_host', sql.VarChar(255), evento.delivery_host || null)
      .input('payload_json', sql.NVarChar(sql.MAX), JSON.stringify(evento))
      .query(`
        INSERT INTO email_eventos_mailgrid (
          msgid,
          status,
          tipo_evento,
          email_de,
          email_para,
          mensagem,
          data_envio,
          data_entrega,
          sender_ip,
          delivery_ip,
          delivery_host,
          payload_json
        )
        VALUES (
          @msgid,
          @status,
          @tipo_evento,
          @email_de,
          @email_para,
          @mensagem,
          @data_envio,
          @data_entrega,
          @sender_ip,
          @delivery_ip,
          @delivery_host,
          @payload_json
        )
      `);

    debugLog(`Evento ${tipoEvento} salvo:`, evento.email_para);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

export default webhookRouter;
