import { createMiddleware } from 'hono/factory';
import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'hono';
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

export type AuthUser = {
  id: string;
  username: string;
  tokenVersion: number;
};

export type AppVariables = {
  user: AuthUser;
};

export async function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({
    username: user.username,
    tv: user.tokenVersion,
  })
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

    const row = db
      .prepare('SELECT username, token_version FROM users WHERE id = ?')
      .get(payload.sub) as { username: string; token_version: number } | undefined;
    if (!row) return null;
    // 改密 / 退出全部后 version 不一致 → 旧 token 失效
    if ((row.token_version ?? 0) !== tv) return null;

    return {
      id: payload.sub,
      username: row.username,
      tokenVersion: row.token_version ?? 0,
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
