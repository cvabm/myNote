import { Hono } from 'hono';
import bcrypt from 'bcryptjs';
import { db } from '../db.js';
import { requireAuth, signToken, getUser, type AppVariables } from '../auth.js';

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  display_name: string;
};

export const authRoutes = new Hono<{ Variables: AppVariables }>();

authRoutes.post('/login', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const username = String(body.username || '').trim();
  const password = String(body.password || '');

  if (!username || !password) {
    return c.json({ error: '请输入用户名和密码' }, 400);
  }

  const user = db
    .prepare('SELECT id, username, password_hash, display_name FROM users WHERE username = ?')
    .get(username) as UserRow | undefined;

  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  const token = await signToken({ id: user.id, username: user.username });
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
    .prepare('SELECT password_hash FROM users WHERE id = ?')
    .get(auth.id) as { password_hash: string } | undefined;

  if (!user || !bcrypt.compareSync(oldPassword, user.password_hash)) {
    return c.json({ error: '原密码错误' }, 400);
  }

  const hash = bcrypt.hashSync(newPassword, 10);
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hash, auth.id);
  return c.json({ ok: true });
});
