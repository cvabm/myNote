import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { requireAuth, getUser, type AppVariables } from '../auth.js';

type BookRow = {
  id: string;
  user_id: string;
  name: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  note_count?: number;
};

export const bookRoutes = new Hono<{ Variables: AppVariables }>();
bookRoutes.use('*', requireAuth);

function mapBook(row: BookRow) {
  return {
    id: row.id,
    name: row.name,
    sortOrder: row.sort_order,
    noteCount: row.note_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

bookRoutes.get('/', (c) => {
  const user = getUser(c);
  const rows = db
    .prepare(
      `SELECT b.*,
        (SELECT COUNT(*) FROM notes n
          WHERE n.book_id = b.id AND n.user_id = b.user_id AND n.deleted_at IS NULL
        ) AS note_count
       FROM books b
       WHERE b.user_id = ?
       ORDER BY b.sort_order ASC, b.created_at ASC`
    )
    .all(user.id) as BookRow[];
  return c.json(rows.map(mapBook));
});

bookRoutes.post('/', async (c) => {
  const user = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim() || '新笔记本';
  const maxSort = db
    .prepare('SELECT COALESCE(MAX(sort_order), -1) AS m FROM books WHERE user_id = ?')
    .get(user.id) as { m: number };
  const id = nanoid();
  db.prepare(`INSERT INTO books (id, user_id, name, sort_order) VALUES (?, ?, ?, ?)`).run(
    id,
    user.id,
    name,
    maxSort.m + 1
  );
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow;
  return c.json(mapBook({ ...row, note_count: 0 }), 201);
});

bookRoutes.patch('/:id', async (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT * FROM books WHERE id = ? AND user_id = ?')
    .get(id, user.id) as BookRow | undefined;
  if (!existing) return c.json({ error: '笔记本不存在' }, 404);
  const body = await c.req.json().catch(() => ({}));
  const name = body.name !== undefined ? String(body.name).trim() || existing.name : existing.name;
  db.prepare(`UPDATE books SET name = ?, updated_at = datetime('now') WHERE id = ? AND user_id = ?`).run(
    name,
    id,
    user.id
  );
  const row = db.prepare('SELECT * FROM books WHERE id = ?').get(id) as BookRow;
  const count = db
    .prepare(
      `SELECT COUNT(*) AS c FROM notes WHERE book_id = ? AND user_id = ? AND deleted_at IS NULL`
    )
    .get(id, user.id) as { c: number };
  return c.json(mapBook({ ...row, note_count: count.c }));
});

bookRoutes.delete('/:id', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT id FROM books WHERE id = ? AND user_id = ?')
    .get(id, user.id);
  if (!existing) return c.json({ error: '笔记本不存在' }, 404);
  const count = db.prepare('SELECT COUNT(*) AS c FROM books WHERE user_id = ?').get(user.id) as {
    c: number;
  };
  if (count.c <= 1) return c.json({ error: '至少保留一个笔记本' }, 400);

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE notes SET deleted_at = datetime('now'), updated_at = datetime('now')
       WHERE user_id = ? AND book_id = ? AND deleted_at IS NULL`
    ).run(user.id, id);
    for (let guard = 0; guard < 1000; guard += 1) {
      const row = db
        .prepare(
          `SELECT id FROM notebooks
           WHERE user_id = ? AND book_id = ?
             AND id NOT IN (
               SELECT parent_id FROM notebooks
               WHERE user_id = ? AND book_id = ? AND parent_id IS NOT NULL
             )
           LIMIT 1`
        )
        .get(user.id, id, user.id, id) as { id: string } | undefined;
      if (!row) break;
      db.prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?').run(row.id, user.id);
    }
    db.prepare('DELETE FROM books WHERE id = ? AND user_id = ?').run(id, user.id);
  });
  tx();
  return c.json({ ok: true });
});
