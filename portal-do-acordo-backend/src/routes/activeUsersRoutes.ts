import { Router, Request } from 'express';
import { getActiveUsersReport, recordActiveUserHeartbeat } from '../services/activeUsersService';

const presenceRouter = Router();
export const activeUsersAdminRouter = Router();

presenceRouter.post('/heartbeat', (req, res) => {
  const result = recordActiveUserHeartbeat(req);
  res.json({ ok: true, session_id: result.session_id });
});

activeUsersAdminRouter.get('/active-users', (req, res) => {
  if (!isAdminRequest(req)) {
    return res.status(404).json({ error: 'Not found' });
  }

  res.json({ data: getActiveUsersReport() });
});

function isAdminRequest(req: Request) {
  const expectedToken = process.env.ACTIVE_USERS_ADMIN_TOKEN || process.env.ADMIN_TOKEN;
  if (!expectedToken) return false;

  const headerToken = req.headers['x-admin-token'];
  const authorization = req.headers.authorization ?? '';
  const bearerToken = authorization.toLowerCase().startsWith('bearer ') ? authorization.slice(7).trim() : '';
  const queryToken = typeof req.query.token === 'string' ? req.query.token : '';

  return [headerToken, bearerToken, queryToken].some((token) => token === expectedToken);
}

export default presenceRouter;
