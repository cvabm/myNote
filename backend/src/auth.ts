import { createMiddleware } from 'hono/factory';
import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'hono';
import { nanoid } from 'nanoid';
import { db } from './db.js';

const rawSecret = process.env.JWT_SECRET || 'mynote-dev-secret-change-me';
const WEAK_SECRETS = new Set([
  'mynote-dev-secret-change-me',
  'please-change-me-to-a-long-random-string',
]);

if (WEAK_SECRETS.has(rawSecret) || rawSecret.length < 16) {
  console.warn(
    '[auth] 警告：JWT_SECRET 仍是默认/过短密钥。公网部署请设置足够长的随机 JWT_SECRET。'
  );
}

const JWT_SECRET = new TextEncoder().encode(rawSecret);

/** 多久更新一次 last_seen，避免每请求写库 */
const TOUCH_INTERVAL_MS = 2 * 60 * 1000;

export type AuthUser = {
  id: string;
  username: string;
  tokenVersion: number;
  /** 无 sid 的旧 token 为 null */
  sessionId: string | null;
};

export type AppVariables = {
  user: AuthUser;
};

export type SessionRow = {
  id: string;
  user_id: string;
  device_label: string;
  user_agent: string;
  ip: string;
  meta_json?: string;
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

/** 仅用于登录限流分桶，不做设备展示、不持久化 */
export function clientIp(c: Context): string {
  const xff = c.req.header('x-forwarded-for')?.split(',')[0]?.trim();
  if (xff) return xff.slice(0, 80);
  const xri = c.req.header('x-real-ip')?.trim();
  if (xri) return xri.slice(0, 80);
  try {
    const env = c.env as { incoming?: { socket?: { remoteAddress?: string } } } | undefined;
    const ra = env?.incoming?.socket?.remoteAddress;
    if (ra) return ra.slice(0, 80);
  } catch {
    /* ignore */
  }
  return 'unknown';
}

export type ParsedDevice = {
  browser: string;
  browserVersion: string;
  os: string;
  osVersion: string;
  deviceType: 'desktop' | 'mobile' | 'tablet' | 'unknown';
  engine: string;
};

/** 客户端上报的补充信息（可伪造，仅作展示） */
export type ClientDeviceInfo = {
  platform?: string;
  language?: string;
  languages?: string[];
  timezone?: string;
  screen?: string;
  colorDepth?: number;
  devicePixelRatio?: number;
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  vendor?: string;
  brands?: string[];
  mobile?: boolean;
};

export type SessionMeta = ParsedDevice & {
  platform?: string;
  language?: string;
  languages?: string[];
  timezone?: string;
  screen?: string;
  colorDepth?: number;
  devicePixelRatio?: number;
  maxTouchPoints?: number;
  hardwareConcurrency?: number;
  deviceMemory?: number;
  vendor?: string;
  brands?: string[];
};

function matchVer(re: RegExp, s: string): string {
  const m = s.match(re);
  return m?.[1] ? m[1] : '';
}

/** 从 User-Agent 解析浏览器 / 系统 / 设备类型 */
export function parseUserAgent(ua: string): ParsedDevice {
  const s = ua || '';
  let os = '未知系统';
  let osVersion = '';

  if (/Windows NT 10\.0/i.test(s)) {
    os = 'Windows';
    osVersion = /Windows NT 10\.0.*rv:1[1-9]|Windows NT 10\.0; Win64; x64/i.test(s)
      ? '10/11'
      : '10';
  } else if (/Windows NT 6\.3/i.test(s)) {
    os = 'Windows';
    osVersion = '8.1';
  } else if (/Windows NT 6\.2/i.test(s)) {
    os = 'Windows';
    osVersion = '8';
  } else if (/Windows NT 6\.1/i.test(s)) {
    os = 'Windows';
    osVersion = '7';
  } else if (/Windows/i.test(s)) {
    os = 'Windows';
  } else if (/Android/i.test(s)) {
    os = 'Android';
    osVersion = matchVer(/Android\s+([\d.]+)/i, s);
  } else if (/iPhone|iPad|iPod/i.test(s)) {
    os = /iPad/i.test(s) ? 'iPadOS' : 'iOS';
    osVersion = matchVer(/OS\s+(\d+[_\d]*)/i, s).replace(/_/g, '.');
  } else if (/Mac OS X|Macintosh/i.test(s)) {
    os = 'macOS';
    osVersion = matchVer(/Mac OS X\s+(\d+[_\d]*)/i, s).replace(/_/g, '.');
  } else if (/CrOS/i.test(s)) {
    os = 'ChromeOS';
  } else if (/Linux/i.test(s)) {
    os = 'Linux';
  }

  let browser = '浏览器';
  let browserVersion = '';
  let engine = '';

  if (/MicroMessenger\/([\d.]+)/i.test(s)) {
    browser = '微信';
    browserVersion = matchVer(/MicroMessenger\/([\d.]+)/i, s);
  } else if (/Edg\/([\d.]+)/i.test(s)) {
    browser = 'Edge';
    browserVersion = matchVer(/Edg\/([\d.]+)/i, s);
    engine = 'Blink';
  } else if (/OPR\/([\d.]+)/i.test(s) || /Opera\/([\d.]+)/i.test(s)) {
    browser = 'Opera';
    browserVersion = matchVer(/OPR\/([\d.]+)/i, s) || matchVer(/Opera\/([\d.]+)/i, s);
    engine = 'Blink';
  } else if (/Firefox\/([\d.]+)/i.test(s)) {
    browser = 'Firefox';
    browserVersion = matchVer(/Firefox\/([\d.]+)/i, s);
    engine = 'Gecko';
  } else if (/Chrome\/([\d.]+)/i.test(s) && !/Edg\//i.test(s)) {
    browser = 'Chrome';
    browserVersion = matchVer(/Chrome\/([\d.]+)/i, s);
    engine = 'Blink';
  } else if (/Safari\/([\d.]+)/i.test(s) && !/Chrome\//i.test(s)) {
    browser = 'Safari';
    browserVersion = matchVer(/Version\/([\d.]+)/i, s) || matchVer(/Safari\/([\d.]+)/i, s);
    engine = 'WebKit';
  }

  let deviceType: ParsedDevice['deviceType'] = 'desktop';
  if (/iPad|Tablet|PlayBook|Silk/i.test(s) || (/Android/i.test(s) && !/Mobile/i.test(s))) {
    deviceType = 'tablet';
  } else if (/Mobi|iPhone|iPod|Android.*Mobile|webOS|BlackBerry|IEMobile/i.test(s)) {
    deviceType = 'mobile';
  } else if (!s) {
    deviceType = 'unknown';
  }

  return { browser, browserVersion, os, osVersion, deviceType, engine };
}

export function deviceLabelFromParsed(p: ParsedDevice, client?: ClientDeviceInfo): string {
  const br = p.browserVersion
    ? `${p.browser} ${p.browserVersion.split('.').slice(0, 2).join('.')}`
    : p.browser;
  const os = p.osVersion ? `${p.os} ${p.osVersion}` : p.os;
  const typeHint =
    client?.mobile === true
      ? '手机'
      : p.deviceType === 'mobile'
        ? '手机'
        : p.deviceType === 'tablet'
          ? '平板'
          : '';
  return typeHint ? `${br} · ${os} · ${typeHint}` : `${br} · ${os}`;
}

export function deviceLabelFromUa(ua: string): string {
  return deviceLabelFromParsed(parseUserAgent(ua));
}

function sanitizeClientInfo(raw: unknown): ClientDeviceInfo | undefined {
  if (!raw || typeof raw !== 'object') return undefined;
  const o = raw as Record<string, unknown>;
  const out: ClientDeviceInfo = {};
  const str = (k: string, max = 80) => {
    if (typeof o[k] === 'string' && o[k]) out[k as keyof ClientDeviceInfo] = String(o[k]).slice(0, max) as never;
  };
  str('platform', 64);
  str('language', 32);
  str('timezone', 64);
  str('screen', 32);
  str('vendor', 64);
  if (Array.isArray(o.languages)) {
    out.languages = o.languages
      .filter((x) => typeof x === 'string')
      .slice(0, 8)
      .map((x) => String(x).slice(0, 24));
  }
  if (Array.isArray(o.brands)) {
    out.brands = o.brands
      .filter((x) => typeof x === 'string')
      .slice(0, 8)
      .map((x) => String(x).slice(0, 40));
  }
  if (typeof o.colorDepth === 'number' && o.colorDepth > 0 && o.colorDepth < 64) {
    out.colorDepth = Math.round(o.colorDepth);
  }
  if (typeof o.devicePixelRatio === 'number' && o.devicePixelRatio > 0 && o.devicePixelRatio < 8) {
    out.devicePixelRatio = Math.round(o.devicePixelRatio * 100) / 100;
  }
  if (typeof o.maxTouchPoints === 'number' && o.maxTouchPoints >= 0 && o.maxTouchPoints < 40) {
    out.maxTouchPoints = Math.round(o.maxTouchPoints);
  }
  if (
    typeof o.hardwareConcurrency === 'number' &&
    o.hardwareConcurrency > 0 &&
    o.hardwareConcurrency <= 256
  ) {
    out.hardwareConcurrency = Math.round(o.hardwareConcurrency);
  }
  if (typeof o.deviceMemory === 'number' && o.deviceMemory > 0 && o.deviceMemory <= 128) {
    out.deviceMemory = Math.round(o.deviceMemory);
  }
  if (typeof o.mobile === 'boolean') out.mobile = o.mobile;
  return out;
}

export function buildSessionMeta(ua: string, clientRaw?: unknown): {
  label: string;
  meta: SessionMeta;
  metaJson: string;
} {
  const parsed = parseUserAgent(ua);
  const client = sanitizeClientInfo(clientRaw);
  // 客户端 mobile 提示可纠正 UA 误判
  if (client?.mobile === true && parsed.deviceType === 'desktop') {
    parsed.deviceType = 'mobile';
  }
  if (client?.brands?.length && parsed.browser === '浏览器') {
    const brand = client.brands.find((b) => !/Not.?A.?Brand/i.test(b)) || client.brands[0];
    if (brand) parsed.browser = brand.replace(/\s+\d.*$/, '') || parsed.browser;
  }
  const meta: SessionMeta = {
    ...parsed,
    platform: client?.platform,
    language: client?.language,
    languages: client?.languages,
    timezone: client?.timezone,
    screen: client?.screen,
    colorDepth: client?.colorDepth,
    devicePixelRatio: client?.devicePixelRatio,
    maxTouchPoints: client?.maxTouchPoints,
    hardwareConcurrency: client?.hardwareConcurrency,
    deviceMemory: client?.deviceMemory,
    vendor: client?.vendor,
    brands: client?.brands,
  };
  return {
    label: deviceLabelFromParsed(parsed, client),
    meta,
    metaJson: JSON.stringify(meta),
  };
}

export function createSession(
  userId: string,
  meta: { userAgent?: string; client?: unknown }
): SessionRow {
  const id = nanoid();
  const ua = (meta.userAgent || '').slice(0, 500);
  const built = buildSessionMeta(ua, meta.client);
  // 不再记录 / 展示客户端 IP
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, device_label, user_agent, ip, meta_json)
     VALUES (?, ?, ?, ?, '', ?)`
  ).run(id, userId, built.label, ua, built.metaJson);
  return db.prepare('SELECT * FROM user_sessions WHERE id = ?').get(id) as SessionRow;
}

export function revokeSession(sessionId: string, userId: string): boolean {
  const r = db
    .prepare(
      `UPDATE user_sessions SET revoked_at = datetime('now')
       WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
    )
    .run(sessionId, userId);
  return r.changes > 0;
}

export function revokeAllSessions(userId: string, exceptSessionId?: string | null) {
  if (exceptSessionId) {
    db.prepare(
      `UPDATE user_sessions SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL AND id != ?`
    ).run(userId, exceptSessionId);
  } else {
    db.prepare(
      `UPDATE user_sessions SET revoked_at = datetime('now')
       WHERE user_id = ? AND revoked_at IS NULL`
    ).run(userId);
  }
}

export function touchSession(sessionId: string) {
  db.prepare(
    `UPDATE user_sessions SET last_seen_at = datetime('now')
     WHERE id = ? AND revoked_at IS NULL`
  ).run(sessionId);
}

export function listActiveSessions(userId: string): SessionRow[] {
  return db
    .prepare(
      `SELECT * FROM user_sessions
       WHERE user_id = ? AND revoked_at IS NULL
       ORDER BY datetime(last_seen_at) DESC`
    )
    .all(userId) as SessionRow[];
}

export async function signToken(user: AuthUser): Promise<string> {
  const payload: Record<string, unknown> = {
    username: user.username,
    tv: user.tokenVersion,
  };
  if (user.sessionId) payload.sid = user.sessionId;

  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(user.id)
    .setIssuedAt()
    .setExpirationTime('30d')
    .sign(JWT_SECRET);
}

export async function verifyToken(token: string): Promise<AuthUser | null> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    if (!payload.sub || typeof payload.username !== 'string') return null;
    const tv = typeof payload.tv === 'number' ? payload.tv : 0;
    const sid = typeof payload.sid === 'string' ? payload.sid : null;

    const row = db
      .prepare('SELECT username, token_version FROM users WHERE id = ?')
      .get(payload.sub) as { username: string; token_version: number } | undefined;
    if (!row) return null;
    if ((row.token_version ?? 0) !== tv) return null;

    // 带 sid 的 token 必须对应未吊销会话
    if (sid) {
      const sess = db
        .prepare(
          `SELECT id, last_seen_at, revoked_at FROM user_sessions
           WHERE id = ? AND user_id = ?`
        )
        .get(sid, payload.sub) as
        | { id: string; last_seen_at: string; revoked_at: string | null }
        | undefined;
      if (!sess || sess.revoked_at) return null;

      const last = Date.parse(String(sess.last_seen_at).replace(' ', 'T') + 'Z');
      if (!Number.isFinite(last) || Date.now() - last > TOUCH_INTERVAL_MS) {
        touchSession(sid);
      }
    }

    return {
      id: payload.sub,
      username: row.username,
      tokenVersion: row.token_version ?? 0,
      sessionId: sid,
    };
  } catch {
    return null;
  }
}

export function bumpTokenVersion(userId: string): number {
  db.prepare(
    `UPDATE users SET token_version = COALESCE(token_version, 0) + 1 WHERE id = ?`
  ).run(userId);
  const row = db
    .prepare('SELECT token_version FROM users WHERE id = ?')
    .get(userId) as { token_version: number };
  return row.token_version;
}

export const requireAuth = createMiddleware<{ Variables: AppVariables }>(async (c, next) => {
  const header = c.req.header('Authorization');
  const token = header?.startsWith('Bearer ') ? header.slice(7) : null;
  if (!token) {
    return c.json({ error: '未登录' }, 401);
  }
  const user = await verifyToken(token);
  if (!user) {
    return c.json({ error: '登录已失效' }, 401);
  }
  c.set('user', user);
  await next();
});

export function getUser(c: Context<{ Variables: AppVariables }>): AuthUser {
  return c.get('user');
}
