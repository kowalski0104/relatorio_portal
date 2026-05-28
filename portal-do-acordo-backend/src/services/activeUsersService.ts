import { createHash, randomUUID } from 'crypto';
import { Request } from 'express';

type HeartbeatBody = {
  sessionId?: unknown;
  path?: unknown;
  tab?: unknown;
  period?: unknown;
  system?: unknown;
  referrer?: unknown;
  timezone?: unknown;
  language?: unknown;
  visibility?: unknown;
  viewport?: {
    width?: unknown;
    height?: unknown;
  };
  screen?: {
    width?: unknown;
    height?: unknown;
  };
};

type ActiveUserSession = {
  session_id: string;
  first_seen: string;
  last_seen: string;
  seconds_online: number;
  path: string;
  tab: string;
  period: string;
  system: string;
  referrer: string;
  timezone: string;
  language: string;
  visibility: string;
  viewport: { width: number | null; height: number | null };
  screen: { width: number | null; height: number | null };
  ip_hash: string;
  browser: string;
  os: string;
  device: string;
};

type StoredSession = Omit<ActiveUserSession, 'first_seen' | 'last_seen' | 'seconds_online'> & {
  firstSeen: number;
  lastSeen: number;
};

const sessions = new Map<string, StoredSession>();

function ttlMs() {
  const value = Number(process.env.ACTIVE_USERS_TTL_MS ?? 2 * 60 * 1000);
  return Number.isFinite(value) && value >= 30_000 ? value : 2 * 60 * 1000;
}

function maxSessions() {
  const value = Number(process.env.ACTIVE_USERS_MAX_SESSIONS ?? 1000);
  return Number.isFinite(value) && value > 0 ? value : 1000;
}

function stringValue(value: unknown, fallback = '', maxLength = 250) {
  if (typeof value !== 'string') return fallback;
  return value.trim().slice(0, maxLength) || fallback;
}

function numberValue(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.round(parsed) : null;
}

function clientIp(req: Request) {
  const forwarded = req.headers['x-forwarded-for'];
  const firstForwarded = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  return (firstForwarded || req.ip || req.socket.remoteAddress || 'unknown').trim();
}

function hashIp(ip: string) {
  const salt = process.env.ACTIVE_USERS_HASH_SALT || process.env.ACTIVE_USERS_ADMIN_TOKEN || process.env.ADMIN_TOKEN || 'portal-do-acordo';
  return createHash('sha256').update(`${salt}:${ip}`).digest('hex').slice(0, 18);
}

function parseUserAgent(userAgent: string) {
  const ua = userAgent.toLowerCase();
  const browser = ua.includes('edg/')
    ? 'Edge'
    : ua.includes('chrome/')
      ? 'Chrome'
      : ua.includes('safari/') && !ua.includes('chrome/')
        ? 'Safari'
        : ua.includes('firefox/')
          ? 'Firefox'
          : 'Outro';
  const os = ua.includes('windows')
    ? 'Windows'
    : ua.includes('mac os')
      ? 'macOS'
      : ua.includes('android')
        ? 'Android'
        : ua.includes('iphone') || ua.includes('ipad')
          ? 'iOS'
          : ua.includes('linux')
            ? 'Linux'
            : 'Outro';
  const device = ua.includes('ipad') || ua.includes('tablet')
    ? 'Tablet'
    : ua.includes('mobi') || ua.includes('android') || ua.includes('iphone')
      ? 'Mobile'
      : 'Desktop';

  return { browser, os, device };
}

function purgeExpired(now = Date.now()) {
  const expiresBefore = now - ttlMs();
  for (const [sessionId, session] of sessions) {
    if (session.lastSeen < expiresBefore) sessions.delete(sessionId);
  }

  if (sessions.size <= maxSessions()) return;
  const ordered = [...sessions.entries()].sort((a, b) => a[1].lastSeen - b[1].lastSeen);
  ordered.slice(0, sessions.size - maxSessions()).forEach(([sessionId]) => sessions.delete(sessionId));
}

export function recordActiveUserHeartbeat(req: Request) {
  const body = (req.body ?? {}) as HeartbeatBody;
  const now = Date.now();
  const rawSessionId = stringValue(body.sessionId, '', 120);
  const sessionId = rawSessionId || randomUUID();
  const existing = sessions.get(sessionId);
  const userAgent = String(req.headers['user-agent'] ?? '');
  const parsedAgent = parseUserAgent(userAgent);

  sessions.set(sessionId, {
    session_id: sessionId,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
    path: stringValue(body.path, '/', 300),
    tab: stringValue(body.tab, 'desconhecida', 80),
    period: stringValue(body.period, '', 20),
    system: stringValue(body.system, '', 20),
    referrer: stringValue(body.referrer, '', 300),
    timezone: stringValue(body.timezone, '', 80),
    language: stringValue(body.language, '', 40),
    visibility: stringValue(body.visibility, '', 30),
    viewport: {
      width: numberValue(body.viewport?.width),
      height: numberValue(body.viewport?.height),
    },
    screen: {
      width: numberValue(body.screen?.width),
      height: numberValue(body.screen?.height),
    },
    ip_hash: hashIp(clientIp(req)),
    browser: parsedAgent.browser,
    os: parsedAgent.os,
    device: parsedAgent.device,
  });

  purgeExpired(now);
  return { session_id: sessionId };
}

export function getActiveUsersReport() {
  const now = Date.now();
  purgeExpired(now);

  const active = [...sessions.values()]
    .sort((a, b) => b.lastSeen - a.lastSeen)
    .map<ActiveUserSession>((session) => ({
      ...session,
      first_seen: new Date(session.firstSeen).toISOString(),
      last_seen: new Date(session.lastSeen).toISOString(),
      seconds_online: Math.max(0, Math.round((now - session.firstSeen) / 1000)),
    }));

  return {
    generated_at: new Date(now).toISOString(),
    active_window_seconds: Math.round(ttlMs() / 1000),
    total_active: active.length,
    by_tab: countBy(active, (session) => session.tab),
    by_device: countBy(active, (session) => session.device),
    by_browser: countBy(active, (session) => session.browser),
    sessions: active,
  };
}

function countBy(rows: ActiveUserSession[], getKey: (row: ActiveUserSession) => string) {
  const counts = new Map<string, number>();
  rows.forEach((row) => {
    const key = getKey(row) || 'desconhecido';
    counts.set(key, (counts.get(key) ?? 0) + 1);
  });
  return [...counts.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((a, b) => b.value - a.value || a.name.localeCompare(b.name));
}
