import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { requireAuth, getUser, type AppVariables } from '../auth.js';

type NotebookRow = {
  id: string;
  user_id: string;
  parent_id: string | null;
  name: string;
  color: string;
  icon: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  note_count?: number;
};

export const notebookRoutes = new Hono<{ Variables: AppVariables }>();
notebookRoutes.use('*', requireAuth);

function mapNotebook(row: NotebookRow) {
  return {
    id: row.id,
    parentId: row.parent_id,
    name: row.name,
    color: row.color,
    icon: row.icon,
    sortOrder: row.sort_order,
    noteCount: row.note_count ?? 0,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

notebookRoutes.get('/', (c) => {
  const user = getUser(c);
  const rows = db
    .prepare(
      `SELECT n.*,
        (SELECT COUNT(*) FROM notes nt
          WHERE nt.notebook_id = n.id AND nt.user_id = n.user_id AND nt.deleted_at IS NULL
        ) AS note_count
       FROM notebooks n
       WHERE n.user_id = ?
       ORDER BY n.sort_order ASC, n.created_at ASC`
    )
    .all(user.id) as NotebookRow[];

  return c.json(rows.map(mapNotebook));
});

notebookRoutes.post('/', async (c) => {
  const user = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const name = String(body.name || '').trim() || '新建笔记本';
  const parentId = body.parentId ? String(body.parentId) : null;
  const color = String(body.color || '#6366f1');
  const icon = String(body.icon || 'folder');

  if (parentId) {
    const parent = db
      .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
      .get(parentId, user.id);
    if (!parent) return c.json({ error: '父笔记本不存在' }, 400);
  }

  const maxSort = db
    .prepare(
      `SELECT COALESCE(MAX(sort_order), -1) AS m FROM notebooks
       WHERE user_id = ? AND ${parentId ? 'parent_id = ?' : 'parent_id IS NULL'}`
    )
    .get(...(parentId ? [user.id, parentId] : [user.id])) as { m: number };

  const id = nanoid();
  db.prepare(
    `INSERT INTO notebooks (id, user_id, parent_id, name, color, icon, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(id, user.id, parentId, name, color, icon, maxSort.m + 1);

  const row = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as NotebookRow;
  return c.json(mapNotebook({ ...row, note_count: 0 }), 201);
});

notebookRoutes.patch('/:id', async (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT * FROM notebooks WHERE id = ? AND user_id = ?')
    .get(id, user.id) as NotebookRow | undefined;
  if (!existing) return c.json({ error: '笔记本不存在' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const name = body.name !== undefined ? String(body.name).trim() || existing.name : existing.name;
  const color = body.color !== undefined ? String(body.color) : existing.color;
  const icon = body.icon !== undefined ? String(body.icon) : existing.icon;
  let parentId = existing.parent_id;
  if (body.parentId !== undefined) {
    parentId = body.parentId ? String(body.parentId) : null;
    if (parentId === id) return c.json({ error: '不能将笔记本设为自己的子节点' }, 400);
    if (parentId) {
      const parent = db
        .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
        .get(parentId, user.id);
      if (!parent) return c.json({ error: '父笔记本不存在' }, 400);
    }
  }
  const sortOrder =
    body.sortOrder !== undefined ? Number(body.sortOrder) : existing.sort_order;

  db.prepare(
    `UPDATE notebooks
     SET name = ?, color = ?, icon = ?, parent_id = ?, sort_order = ?,
         updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(name, color, icon, parentId, sortOrder, id, user.id);

  const row = db.prepare('SELECT * FROM notebooks WHERE id = ?').get(id) as NotebookRow;
  return c.json(mapNotebook(row));
});

notebookRoutes.delete('/:id', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
    .get(id, user.id);
  if (!existing) return c.json({ error: '笔记本不存在' }, 404);

  // 将本笔记本及其子树中的笔记移入回收站，并删除笔记本树
  const collectIds = (parentId: string): string[] => {
    const children = db
      .prepare('SELECT id FROM notebooks WHERE parent_id = ? AND user_id = ?')
      .all(parentId, user.id) as { id: string }[];
    return [parentId, ...children.flatMap((ch) => collectIds(ch.id))];
  };
  const ids = collectIds(id);
  const placeholders = ids.map(() => '?').join(',');

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE notes SET deleted_at = datetime('now'), updated_at = datetime('now')
       WHERE user_id = ? AND notebook_id IN (${placeholders}) AND deleted_at IS NULL`
    ).run(user.id, ...ids);

    for (const nbId of ids.reverse()) {
      db.prepare('DELETE FROM notebooks WHERE id = ? AND user_id = ?').run(nbId, user.id);
    }
  });
  tx();

  return c.json({ ok: true });
});
