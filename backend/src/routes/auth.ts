import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import {
  requireAuth,
  signToken,
  getUser,
  bumpTokenVersion,
  type AppVariables,
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

function clientKey(c: { req: { header: (n: string) => string | undefined } }, username: string) {
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ||
    c.req.header('x-real-ip') ||
    'unknown';
  return `${ip}|${username.toLowerCase()}`;
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

// 偶尔清理过期项，避免 Map 无限涨
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of loginAttempts) {
    if (now >= v.resetAt) loginAttempts.delete(k);
  }
}, 60_000).unref?.();

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
  const token = await signToken({
    id: user.id,
    username: user.username,
    tokenVersion: user.token_version ?? 0,
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
  });
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
  const tx = db.transaction(() => {
    db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, auth.id);
    return bumpTokenVersion(auth.id);
  });
  const tokenVersion = tx();

  // 当前设备拿新 token；其它设备旧 JWT 全部失效
  const token = await signToken({
    id: auth.id,
    username: auth.username,
    tokenVersion,
  });
  return c.json({ ok: true, token });
});

/** 退出全部登录：递增 token_version，当前设备可选择拿新 token 或本地清空 */
authRoutes.post('/logout-all', requireAuth, async (c) => {
  const auth = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  // keepCurrent=true：本机换新 token；false：本机也下线（只 bump，不发新 token）
  const keepCurrent = body.keepCurrent !== false;

  const tokenVersion = bumpTokenVersion(auth.id);

  if (!keepCurrent) {
    return c.json({ ok: true, token: null as string | null });
  }

  const token = await signToken({
    id: auth.id,
    username: auth.username,
    tokenVersion,
  });
  return c.json({ ok: true, token });
});
