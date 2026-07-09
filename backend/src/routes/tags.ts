import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { requireAuth, getUser, type AppVariables } from '../auth.js';

export const tagRoutes = new Hono<{ Variables: AppVariables }>();
tagRoutes.use('*', requireAuth);

tagRoutes.get('/', (c) => {
  const user = getUser(c);
  const rows = db
    .prepare(
      `SELECT t.id, t.name, t.color, t.created_at,
        (SELECT COUNT(*) FROM note_tags nt
          INNER JOIN notes n ON n.id = nt.note_id
          WHERE nt.tag_id = t.id AND n.deleted_at IS NULL
        ) AS note_count
       FROM tags t
       WHERE t.user_id = ?
       ORDER BY t.name ASC`
    )
    .all(user.id) as {
    id: string;
    name: string;
    color: string;
    created_at: string;
    note_count: number;
  }[];

  return c.json(
    rows.map((r) => ({
      id: r.id,
      name: r.name,
      color: r.color,
      noteCount: r.note_count,
      createdAt: r.created_at,
    }))
  );
});

tagRoutes.post('/', async (c) => {
  const user = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim();
  const color = String(body.color || '#64748b');
  if (!name) return c.json({ error: '标签名不能为空' }, 400);

  const exists = db
    .prepare('SELECT id FROM tags WHERE user_id = ? AND name = ?')
    .get(user.id, name);
  if (exists) return c.json({ error: '标签已存在' }, 409);

  const id = nanoid();
  db.prepare('INSERT INTO tags (id, user_id, name, color) VALUES (?, ?, ?, ?)').run(
    id,
    user.id,
    name,
    color
  );
  return c.json({ id, name, color, noteCount: 0 }, 201);
});

tagRoutes.patch('/:id', async (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT id, name, color FROM tags WHERE id = ? AND user_id = ?')
    .get(id, user.id) as { id: string; name: string; color: string } | undefined;
  if (!existing) return c.json({ error: '标签不存在' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const name = body.name !== undefined ? String(body.name).trim() : existing.name;
  const color = body.color !== undefined ? String(body.color) : existing.color;
  if (!name) return c.json({ error: '标签名不能为空' }, 400);

  db.prepare('UPDATE tags SET name = ?, color = ? WHERE id = ? AND user_id = ?').run(
    name,
    color,
    id,
    user.id
  );
  return c.json({ id, name, color });
});

tagRoutes.delete('/:id', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const result = db.prepare('DELETE FROM tags WHERE id = ? AND user_id = ?').run(id, user.id);
  if (result.changes === 0) return c.json({ error: '标签不存在' }, 404);
  return c.json({ ok: true });
});
