import { Router, Request, Response } from 'express';
import sql from 'mssql';

export const clickRouter = Router();
const webhookRouter = Router();

// Pool de conexão reutilizável
let pool: sql.ConnectionPool | null = null;

async function getConnection(): Promise<sql.ConnectionPool> {
  if (!pool) {
    pool = new sql.ConnectionPool({
      server: process.env.AZURE_SQL_SERVER || '',
      database: process.env.AZURE_SQL_DATABASE || '',
      authentication: {
        type: 'default',
        options: {
          userName: process.env.AZURE_SQL_USER || '',
          password: process.env.AZURE_SQL_PASSWORD || '',
        },
      },
      options: {
        encrypt: true,
        trustServerCertificate: false,
        connectTimeout: 30000,
        requestTimeout: 30000,
      },
    });

    await pool.connect();
    console.log('✅ Conectado ao Azure SQL');
  }

  return pool;
}

// ROTA DE CLIQUE
clickRouter.get('/:token', async (req: Request, res: Response) => {
  try {
    const token = req.params.token;
    console.log('📧 Clique recebido - Token:', token);

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

    console.log('✅ Envio encontrado:', envio.url_destino);

    // Salvar clique
    await pool
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

    console.log('💾 Clique salvo no banco');

    // Redirecionar
    return res.redirect(envio.url_destino);
  } catch (error) {
    console.error('❌ Erro ao processar clique:', error);
    res.status(500).send('Erro ao processar clique');
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

    console.log(`✅ Evento ${tipoEvento} salvo:`, evento.email_para);
    return res.status(200).json({ success: true });
  } catch (error) {
    console.error('❌ Erro no webhook:', error);
    res.status(500).json({ error: 'Erro ao processar webhook' });
  }
});

export default webhookRouter;
