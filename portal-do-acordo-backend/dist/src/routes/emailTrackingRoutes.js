"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.clickRouter = void 0;
exports.getEmailClickReport = getEmailClickReport;
const express_1 = require("express");
const mssql_1 = __importDefault(require("mssql"));
const schemas_1 = require("./schemas");
const reportFilters_1 = require("../utils/reportFilters");
exports.clickRouter = (0, express_1.Router)();
const webhookRouter = (0, express_1.Router)();
const EMAIL_TRACKING_DEBUG = process.env.EMAIL_TRACKING_DEBUG === 'true';
const BRASILIA_TIME_ZONE = 'America/Sao_Paulo';
// Pool de conexão reutilizável
let pool = null;
let poolPromise = null;
function debugLog(...args) {
    if (EMAIL_TRACKING_DEBUG)
        console.log(...args);
}
function nowInBrasiliaAsSqlDateTime() {
    const now = new Date();
    const parts = new Intl.DateTimeFormat('en-US', {
        timeZone: BRASILIA_TIME_ZONE,
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        hourCycle: 'h23',
    }).formatToParts(now);
    const valueByType = new Map(parts.map((part) => [part.type, part.value]));
    return new Date(Date.UTC(Number(valueByType.get('year')), Number(valueByType.get('month')) - 1, Number(valueByType.get('day')), Number(valueByType.get('hour')), Number(valueByType.get('minute')), Number(valueByType.get('second')), now.getMilliseconds()));
}
async function getConnection() {
    if (pool && pool.connected) {
        return pool;
    }
    if (poolPromise)
        return poolPromise;
    const config = {
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
    const nextPool = new mssql_1.default.ConnectionPool(config);
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
function toIso(value) {
    if (!value)
        return null;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? String(value) : date.toISOString();
}
function addGrupoInputs(request, grupos) {
    const values = Array.from(new Set(grupos?.map((item) => item.trim()).filter(Boolean) ?? []));
    values.forEach((grupo, index) => request.input(`grupo${index}`, mssql_1.default.NVarChar(150), grupo));
    return values.length ? `AND grupo IN (${values.map((_, index) => `@grupo${index}`).join(', ')})` : '';
}
function createEmailClickBaseSql() {
    return `
    WITH cliques AS (
      SELECT
        COALESCE(
          NULLIF(LTRIM(RTRIM(c.grupo)), ''),
          NULLIF(LTRIM(RTRIM(e.grupo)), ''),
          'OUTROS'
        ) AS grupo,
        c.id AS id,
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
function getEmailClickRange(filter) {
    const range = (0, reportFilters_1.getPeriodRange)(filter.periodo);
    if (!filter.dataFim)
        return range;
    const filteredEnd = new Date(`${filter.dataFim}T00:00:00Z`);
    filteredEnd.setUTCDate(filteredEnd.getUTCDate() + 1);
    return {
        start: range.start,
        end: filteredEnd < range.end ? filteredEnd : range.end,
    };
}
async function getEmailClickReport(filter) {
    const range = getEmailClickRange(filter);
    const connection = await getConnection();
    const summaryRequest = connection
        .request()
        .input('start', mssql_1.default.DateTime2, range.start)
        .input('end', mssql_1.default.DateTime2, range.end);
    const summaryGrupoFilter = addGrupoInputs(summaryRequest, filter.credores);
    const summaryResult = await summaryRequest.query(`
    ${createEmailClickBaseSql()}
    SELECT
      grupo,
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
      ${summaryGrupoFilter}
    GROUP BY grupo
    ORDER BY cliques DESC, grupo
  `);
    const recentRequest = connection
        .request()
        .input('start', mssql_1.default.DateTime2, range.start)
        .input('end', mssql_1.default.DateTime2, range.end);
    const recentGrupoFilter = addGrupoInputs(recentRequest, filter.credores);
    const recentResult = await recentRequest.query(`
    ${createEmailClickBaseSql()}
    SELECT TOP 25
      id,
      token,
      processo,
      email_destinatario,
      grupo,
      campanha,
      template,
      ip,
      user_agent,
      data_clique
    FROM cliques
    WHERE 1 = 1
      ${recentGrupoFilter}
    ORDER BY data_clique DESC
  `);
    const porGrupo = summaryResult.recordset.map((row) => ({
        grupo: row.grupo || 'OUTROS',
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
            cliques: porGrupo.reduce((sum, row) => sum + row.cliques, 0),
            links_unicos: porGrupo.reduce((sum, row) => sum + row.links_unicos, 0),
            processos: porGrupo.reduce((sum, row) => sum + row.processos, 0),
            destinatarios: porGrupo.reduce((sum, row) => sum + row.destinatarios, 0),
        },
        por_grupo: porGrupo,
        recentes: recentResult.recordset.map((row) => ({
            id: row.id,
            token: row.token,
            processo: row.processo,
            email_destinatario: row.email_destinatario,
            grupo: row.grupo || 'OUTROS',
            campanha: row.campanha,
            template: row.template,
            data_clique: toIso(row.data_clique),
            ip: row.ip,
            user_agent: row.user_agent,
        })),
    };
}
// TESTE DE CONEXÃO
exports.clickRouter.get('/test/connection', async (req, res) => {
    try {
        debugLog('Testando conexão ao Azure SQL...');
        const pool = await getConnection();
        const result = await pool.request().query('SELECT TOP 1 * FROM email_envios');
        res.json({
            success: true,
            message: 'Conexão OK',
            recordsFound: result.recordset.length
        });
    }
    catch (error) {
        console.error('Erro na conexão:', error.message);
        res.status(500).json({
            success: false,
            error: error.message,
            code: error.code
        });
    }
});
webhookRouter.get('/cliques', async (req, res) => {
    const parseResult = schemas_1.emailClicksQuerySchema.safeParse(req.query);
    if (!parseResult.success) {
        return res.status(400).json({ error: 'Query inválida', issues: parseResult.error.format() });
    }
    const report = await getEmailClickReport(parseResult.data);
    res.set('Cache-Control', 'no-store');
    res.json({ data: report });
});
// ROTA DE CLIQUE
exports.clickRouter.get('/:token', async (req, res) => {
    try {
        const token = req.params.token;
        debugLog('Clique recebido - Token:', token);
        const pool = await getConnection();
        // Buscar envio
        const result = await pool
            .request()
            .input('token', mssql_1.default.VarChar(100), token)
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
            .input('token', mssql_1.default.VarChar(100), token)
            .input('processo', mssql_1.default.VarChar(100), envio.processo)
            .input('email_destinatario', mssql_1.default.VarChar(255), envio.email_destinatario)
            .input('credor', mssql_1.default.VarChar(150), envio.credor)
            .input('grupo', mssql_1.default.VarChar(150), envio.grupo)
            .input('campanha', mssql_1.default.VarChar(150), envio.campanha)
            .input('template', mssql_1.default.VarChar(150), envio.template)
            .input('ip', mssql_1.default.VarChar(100), req.ip || 'unknown')
            .input('user_agent', mssql_1.default.NVarChar(mssql_1.default.MAX), req.headers['user-agent'] || '')
            .input('data_clique', mssql_1.default.DateTime2, nowInBrasiliaAsSqlDateTime())
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
          user_agent,
          data_clique
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
          @user_agent,
          @data_clique
        )
      `);
        debugLog('Clique salvo com sucesso. Rows affected:', insertResult.rowsAffected);
        // Redirecionar
        return res.redirect(envio.url_destino);
    }
    catch (error) {
        console.error('❌ Erro ao processar clique:');
        console.error('Tipo de erro:', error.code);
        console.error('Mensagem:', error.message);
        console.error('Stack:', error.stack);
        res.status(500).send(`Erro: ${error.message}`);
    }
});
// ROTA DO WEBHOOK
webhookRouter.post('/webhook', async (req, res) => {
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
        if (evento.status === 0)
            tipoEvento = 'hardbounce';
        if (evento.status === 1)
            tipoEvento = 'entregue';
        if (evento.status === 2)
            tipoEvento = 'softbounce';
        const pool = await getConnection();
        await pool
            .request()
            .input('msgid', mssql_1.default.VarChar(255), evento.msgid || null)
            .input('status', mssql_1.default.Int, evento.status || null)
            .input('tipo_evento', mssql_1.default.VarChar(50), tipoEvento)
            .input('email_de', mssql_1.default.VarChar(255), evento.email_de || null)
            .input('email_para', mssql_1.default.VarChar(255), evento.email_para || null)
            .input('mensagem', mssql_1.default.NVarChar(mssql_1.default.MAX), evento.mensagem || null)
            .input('data_envio', mssql_1.default.DateTime, evento.data_envio || null)
            .input('data_entrega', mssql_1.default.DateTime, evento.data_entrega || null)
            .input('sender_ip', mssql_1.default.VarChar(100), evento.sender_ip || null)
            .input('delivery_ip', mssql_1.default.VarChar(100), evento.delivery_ip || null)
            .input('delivery_host', mssql_1.default.VarChar(255), evento.delivery_host || null)
            .input('payload_json', mssql_1.default.NVarChar(mssql_1.default.MAX), JSON.stringify(evento))
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
    }
    catch (error) {
        console.error('❌ Erro no webhook:', error);
        res.status(500).json({ error: 'Erro ao processar webhook' });
    }
});
exports.default = webhookRouter;
//# sourceMappingURL=emailTrackingRoutes.js.map