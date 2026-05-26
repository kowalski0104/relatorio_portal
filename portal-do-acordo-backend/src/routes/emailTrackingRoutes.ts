import { Router } from 'express';

const router = Router();

// Por enquanto, vamos apenas logar para verificar se a rota está sendo chamada
console.log('✅ emailTrackingRoutes carregado!');

// ============================================================
// ROTA DE CLIQUE - versão simples para testar
// ============================================================
export const clickRouter = Router();

clickRouter.get('/:token', (req, res) => {
  const token = req.params.token;
  console.log(`📧 CLIQUE RECEBIDO - Token: ${token}`);
  res.json({ 
    success: true, 
    message: 'Clique recebido', 
    token 
  });
});

// ============================================================
// ROTA DO WEBHOOK DA MAILGRID - versão simples
// ============================================================
router.post('/webhook', (req, res) => {
  const authHeader = req.headers['authorization'];
  const expectedToken = `Bearer ${process.env.MAILGRID_WEBHOOK_TOKEN}`;

  console.log(`🔔 Webhook MailGrid recebido`);
  console.log(`   Auth header: ${authHeader}`);
  console.log(`   Expected: ${expectedToken}`);

  if (authHeader !== expectedToken) {
    console.warn(`❌ Token inválido`);
    return res.status(401).json({ error: 'Não autorizado' });
  }

  console.log(`✅ Webhook autorizado, evento recebido:`, req.body);
  return res.status(200).json({ success: true });
});

export default router;
