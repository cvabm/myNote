import { Hono, type Context } from 'hono';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import {
  requireAuth,
  signToken,
  getUser,
  bumpTokenVersion,
  createSession,
  revokeSession,
  revokeAllSessions,
  listActiveSessions,
  clientIp,
  type AppVariables,
  type SessionRow,
} from '../auth.js';

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
  token_version: number;
};

export const authRoutes = new Hono<{ Variables: AppVariables }>();

/** 简单内存限流：按 IP + 用户名，防撞库 */
const loginAttempts = new Map<string, { count: number; resetAt: number }>();
const LOGIN_WINDOW_MS = 15 * 60 * 1000;
const LOGIN_MAX_ATTEMPTS = 10;

function clientKey(c: Context, username: string) {
  return `${clientIp(c)}|${username.toLowerCase()}`;
}

function checkLoginRate(key: string): { ok: true } | { ok: false; retryAfterSec: number } {
  const now = Date.now();
  const cur = loginAttempts.get(key);
  if (!cur || now >= cur.resetAt) {
    loginAttempts.set(key, { count: 0, resetAt: now + LOGIN_WINDOW_MS });
    return { ok: true };
  }
  if (cur.count >= LOGIN_MAX_ATTEMPTS) {
    return { ok: false, retryAfterSec: Math.ceil((cur.resetAt - now) / 1000) };
  }
  return { ok: true };
}

function recordLoginFailure(key: string) {
  const now = Date.now();
  const cur = loginAttempts.get(key);
  if (!cur || now >= cur.resetAt) {
    loginAttempts.set(key, { count: 1, resetAt: now + LOGIN_WINDOW_MS });
    return;
  }
  cur.count += 1;
}

function clearLoginFailures(key: string) {
  loginAttempts.delete(key);
}

setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (now >= v.resetAt) loginAttempts.delete(k);
  }
}, 60_000).unref?.();

function parseMeta(row: SessionRow) {
  try {
    return JSON.parse(row.meta_json || '{}') as Record<string, unknown>;
  } catch {
    return {};
  }
}

function mapSession(row: SessionRow, currentSessionId: string | null) {
  const m = parseMeta(row);
  const str = (k: string) => (typeof m[k] === 'string' ? (m[k] as string) : '');
  const num = (k: string) => (typeof m[k] === 'number' ? (m[k] as number) : null);
  return {
    id: row.id,
    deviceLabel: row.device_label || '未知设备',
    userAgent: row.user_agent || '',
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
    current: !!currentSessionId && row.id === currentSessionId,
    browser: str('browser'),
    browserVersion: str('browserVersion'),
    os: str('os'),
    osVersion: str('osVersion'),
    deviceType: str('deviceType') || 'unknown',
    engine: str('engine'),
    platform: str('platform'),
    language: str('language'),
    timezone: str('timezone'),
    screen: str('screen'),
    colorDepth: num('colorDepth'),
    devicePixelRatio: num('devicePixelRatio'),
    maxTouchPoints: num('maxTouchPoints'),
    hardwareConcurrency: num('hardwareConcurrency'),
    deviceMemory: num('deviceMemory'),
  };
}

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    return c.json({ error: '请输入用户名和密码' }, 400);
  }

  const key = clientKey(c, username);
  const rate = checkLoginRate(key);
  if (!rate.ok) {
    return c.json(
      { error: `尝试过多，请 ${Math.ceil(rate.retryAfterSec / 60)} 分钟后再试` },
      429
    );
  }

  const user = db
    .prepare(
      `SELECT id, username, password_hash, display_name,
              COALESCE(token_version, 0) AS token_version
       FROM users WHERE username = ?`
    )
    .get(username) as UserRow | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    recordLoginFailure(key);
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  clearLoginFailures(key);

  const session = createSession(user.id, {
    userAgent: c.req.header('user-agent') || '',
    client: body.device,
  });

  const token = await signToken({
    id: user.id,
    username: user.username,
    tokenVersion: user.token_version ?? 0,
    sessionId: session.id,
  });
  return c.json({
    token,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.display_name,
    },
  });
});

authRoutes.get('/me', requireAuth, (c) => {
  const auth = getUser(c);
  const user = db
    .prepare('SELECT id, username, display_name FROM users WHERE id = ?')
    .get(auth.id) as { id: string; username: string; display_name: string } | undefined;

  if (!user) return c.json({ error: '用户不存在' }, 404);

  return c.json({
    id: user.id,
    username: user.username,
    displayName: user.display_name,
    sessionId: auth.sessionId,
  });
});

/** 当前用户的活跃设备列表 */
authRoutes.get('/sessions', requireAuth, (c) => {
  const auth = getUser(c);
  const rows = listActiveSessions(auth.id);
  return c.json({
    items: rows.map((r) => mapSession(r, auth.sessionId)),
  });
});

/** 踢掉某一台设备 */
authRoutes.delete('/sessions/:id', requireAuth, (c) => {
  const auth = getUser(c);
  const id = c.req.param('id');
  if (auth.sessionId && id === auth.sessionId) {
    return c.json({ error: '不能踢掉当前设备，请使用退出登录' }, 400);
  }
  const ok = revokeSession(id, auth.id);
  if (!ok) return c.json({ error: '会话不存在或已失效' }, 404);
  return c.json({ ok: true });
});

authRoutes.post('/change-password', requireAuth, async (c) => {
  const auth = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const oldPassword = String(body.oldPassword || '');
  const newPassword = String(body.newPassword || '');

  if (newPassword.length < 6) {
    return c.json({ error: '新密码至少 6 位' }, 400);
  }

  const user = db
    .prepare(
      `SELECT password_hash, COALESCE(token_version, 0) AS token_version
       FROM users WHERE id = ?`
    )
    .get(auth.id) as { password_hash: string; token_version: number } | undefined;

  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
    return c.json({ error: '原密码错误' }, 400);
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  const result = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, auth.id);
    const tokenVersion = bumpTokenVersion(auth.id);
    // 其它会话全部吊销；当前会话若存在则保留，否则新建
    revokeAllSessions(auth.id, auth.sessionId);
    let sessionId = auth.sessionId;
    if (sessionId) {
      const still = db
        .prepare(
          `SELECT id FROM user_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL`
        )
        .get(sessionId, auth.id);
      if (!still) sessionId = null;
    }
    if (!sessionId) {
      sessionId = createSession(auth.id, {
        userAgent: c.req.header('user-agent') || '',
        client: body.device,
      }).id;
    }
    return { tokenVersion, sessionId };
  })();

  const token = await signToken({
    id: auth.id,
    username: auth.username,
    tokenVersion: result.tokenVersion,
    sessionId: result.sessionId,
  });
  return c.json({ ok: true, token });
});

/** 退出其它/全部登录 */
authRoutes.post('/logout-all', requireAuth, async (c) => {
  const auth = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const keepCurrent = body.keepCurrent !== false;

  const result = db.transaction(() => {
    const tokenVersion = bumpTokenVersion(auth.id);
    if (keepCurrent) {
      revokeAllSessions(auth.id, auth.sessionId);
      let sessionId = auth.sessionId;
      if (!sessionId) {
        sessionId = createSession(auth.id, {
          userAgent: c.req.header('user-agent') || '',
          client: body.device,
        }).id;
      }
      return { tokenVersion, sessionId, keep: true as const };
    }
    revokeAllSessions(auth.id);
    return { tokenVersion, sessionId: null as string | null, keep: false as const };
  })();

  if (!result.keep) {
    return c.json({ ok: true, token: null as string | null });
  }

  const token = await signToken({
    id: auth.id,
    username: auth.username,
    tokenVersion: result.tokenVersion,
    sessionId: result.sessionId,
  });
  return c.json({ ok: true, token });
});
