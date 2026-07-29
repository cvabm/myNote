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
  created_at: string;
  last_seen_at: string;
  revoked_at: string | null;
};

export function clientIp(c: {
  req: { header: (n: string) => string | undefined };
}): string {
  return (
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown'
  );
}

/** 从 UA 生成可读设备名 */
export function deviceLabelFromUa(ua: string): string {
  const s = ua || '';
  let os = '未知系统';
  if (/Windows/i.test(s)) os = 'Windows';
  else if (/Android/i.test(s)) os = 'Android';
  else if (/iPhone|iPad|iPod/i.test(s)) os = 'iOS';
  else if (/Mac OS X|Macintosh/i.test(s)) os = 'macOS';
  else if (/Linux/i.test(s)) os = 'Linux';

  let browser = '浏览器';
  if (/Edg\//i.test(s)) browser = 'Edge';
  else if (/Chrome\//i.test(s) && !/Edg\//i.test(s)) browser = 'Chrome';
  else if (/Firefox\//i.test(s)) browser = 'Firefox';
  else if (/Safari\//i.test(s) && !/Chrome\//i.test(s)) browser = 'Safari';
  else if (/MicroMessenger/i.test(s)) browser = '微信';

  return `${browser} · ${os}`;
}

export function createSession(
  userId: string,
  meta: { userAgent?: string; ip?: string }
): SessionRow {
  const id = nanoid();
  const ua = (meta.userAgent || '').slice(0, 500);
  const ip = (meta.ip || '').slice(0, 80);
  const label = deviceLabelFromUa(ua);
  db.prepare(
    `INSERT INTO user_sessions (id, user_id, device_label, user_agent, ip)
     VALUES (?, ?, ?, ?, ?)`
  ).run(id, userId, label, ua, ip);
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

      // 节流更新 last_seen
      const last = Date.parse(sess.last_seen_at.replace(' ', 'T') + 'Z');
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
