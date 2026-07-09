import { createMiddleware } from 'hono/factory';
import { SignJWT, jwtVerify } from 'jose';
import type { Context } from 'hono';

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || 'mynote-dev-secret-change-me'
);

export type AuthUser = {
  id: string;
  username: string;
};

export type AppVariables = {
  user: AuthUser;
};

export async function signToken(user: AuthUser): Promise<string> {
  return new SignJWT({ username: user.username })
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
    return { id: payload.sub, username: payload.username };
  } catch {
    return null;
  }
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
