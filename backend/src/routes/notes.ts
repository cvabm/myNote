import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { db, removeNoteFts, syncNoteFts } from '../db.js';
import { requireAuth, getUser, type AppVariables } from '../auth.js';

type NoteRow = {
  id: string;
  user_id: string;
  notebook_id: string | null;
  title: string;
  content: string;
  content_html: string;
  is_favorite: number;
  is_locked: number;
  deleted_at: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export const noteRoutes = new Hono<{ Variables: AppVariables }>();
noteRoutes.use('*', requireAuth);

/** 在正文中截取关键字附近片段，便于列表即时预览 */
function snippetAround(text: string, query: string, radius = 55): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (!flat) return '';
  const terms = query
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
  const lower = flat.toLowerCase();
  let best = -1;
  let matchLen = 0;
  for (const t of terms) {
    const i = lower.indexOf(t.toLowerCase());
    if (i !== -1 && (best === -1 || i < best)) {
      best = i;
      matchLen = t.length;
    }
  }
  if (best === -1) {
    return flat.slice(0, 160);
  }
  const start = Math.max(0, best - radius);
  const end = Math.min(flat.length, best + matchLen + radius);
  let snip = flat.slice(start, end);
  if (start > 0) snip = `…${snip}`;
  if (end < flat.length) snip = `${snip}…`;
  return snip;
}

function mapNote(row: NoteRow, withContent = true, searchQuery = '') {
  const base = {
    id: row.id,
    notebookId: row.notebook_id,
    title: row.title,
    isFavorite: !!row.is_favorite,
    deletedAt: row.deleted_at,
    sortOrder: row.sort_order,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
  if (!withContent) {
    const q = searchQuery.trim();
    const body = row.content || '';
    let preview: string;
    if (q) {
      const lowerBody = body.toLowerCase();
      const hitBody = q
        .split(/\s+/)
        .filter(Boolean)
        .some((t) => lowerBody.includes(t.toLowerCase()));
      preview = hitBody
        ? snippetAround(body, q)
        : snippetAround(`${row.title} ${body}`, q);
    } else {
      preview = body.slice(0, 160).replace(/\s+/g, ' ').trim();
    }
    return { ...base, preview };
  }
  return {
    ...base,
    content: row.content,
    contentHtml: row.content_html,
  };
}

noteRoutes.get('/', (c) => {
  const user = getUser(c);
  const notebookId = c.req.query('notebookId');
  const favorite = c.req.query('favorite');
  const trash = c.req.query('trash');
  const q = (c.req.query('q') || '').trim();
  // 分页：默认 30，最多 100；取 limit+1 判断 hasMore
  const limitRaw = Number(c.req.query('limit') || 30);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 30));
  const offsetRaw = Number(c.req.query('offset') || 0);
  const offset = Math.max(0, Number.isFinite(offsetRaw) ? Math.floor(offsetRaw) : 0);

  let sql = `
    SELECT n.*
    FROM notes n
    WHERE n.user_id = ?
  `;
  const params: unknown[] = [user.id];

  if (trash === '1') {
    sql += ` AND n.deleted_at IS NOT NULL `;
  } else {
    sql += ` AND n.deleted_at IS NULL `;
  }

  if (favorite === '1') {
    sql += ` AND n.is_favorite = 1 `;
  }

  if (notebookId === 'null' || notebookId === 'uncategorized') {
    sql += ` AND n.notebook_id IS NULL `;
  } else if (notebookId) {
    sql += ` AND n.notebook_id = ? `;
    params.push(notebookId);
  }

  let searchIds: string[] = [];
  if (q) {
    try {
      const terms = q
        .split(/\s+/)
        .map((t) => t.replace(/["'*:^(){}[\]~-]/g, ' ').trim())
        .filter(Boolean)
        .map((t) => `"${t}"*`);
      const matchExpr = terms.join(' ');
      if (matchExpr) {
        const ftsRows = db
          .prepare(
            `SELECT note_id FROM notes_fts
             WHERE notes_fts MATCH ?
             ORDER BY rank`
          )
          .all(matchExpr) as { note_id: string }[];
        searchIds = ftsRows.map((r) => r.note_id);
      }
    } catch {
      searchIds = [];
    }
    if (searchIds.length === 0) {
      const like = `%${q}%`;
      const likeRows = db
        .prepare(
          `SELECT id FROM notes
           WHERE user_id = ? AND (title LIKE ? OR content LIKE ?)
           ORDER BY updated_at DESC`
        )
        .all(user.id, like, like) as { id: string }[];
      searchIds = likeRows.map((r) => r.id);
    }
    if (searchIds.length === 0) {
      return c.json({ items: [], hasMore: false });
    }
    const placeholders = searchIds.map(() => '?').join(',');
    sql += ` AND n.id IN (${placeholders}) `;
    params.push(...searchIds);
  }

  sql += ` ORDER BY n.updated_at DESC, n.id DESC `;

  let rows = db.prepare(sql).all(...params) as NoteRow[];

  if (q && searchIds.length > 0) {
    const order = new Map(searchIds.map((id, i) => [id, i]));
    rows = rows.slice().sort((a, b) => (order.get(a.id) ?? 9999) - (order.get(b.id) ?? 9999));
  }

  // 内存切片分页（搜索需先按相关度排序）
  const pageRows = rows.slice(offset, offset + limit + 1);
  const hasMore = pageRows.length > limit;
  const items = pageRows.slice(0, limit).map((r) => mapNote(r, false, q));

  return c.json({ items, hasMore });
});

noteRoutes.get('/:id', (c) => {
  const user = getUser(c);
  const row = db
    .prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .get(c.req.param('id'), user.id) as NoteRow | undefined;
  if (!row) return c.json({ error: '笔记不存在' }, 404);
  return c.json(mapNote(row, true));
});

noteRoutes.post('/', async (c) => {
  const user = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const title = String(body.title ?? '未命名笔记').trim() || '未命名笔记';
  const content = String(body.content ?? '');
  const notebookId = body.notebookId ? String(body.notebookId) : null;

  if (notebookId) {
    const nb = db
      .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
      .get(notebookId, user.id);
    if (!nb) return c.json({ error: '笔记本不存在' }, 400);
  }

  const id = nanoid();
  const tx = db.transaction(() => {
    db.prepare(
      `INSERT INTO notes (id, user_id, notebook_id, title, content)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, user.id, notebookId, title, content);
    syncNoteFts(id, title, content);
  });
  tx();

  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow;
  return c.json(mapNote(row, true), 201);
});

noteRoutes.patch('/:id', async (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT * FROM notes WHERE id = ? AND user_id = ?')
    .get(id, user.id) as NoteRow | undefined;
  if (!existing) return c.json({ error: '笔记不存在' }, 404);
  if (existing.deleted_at) return c.json({ error: '回收站中的笔记不可编辑' }, 400);

  const body = await c.req.json().catch(() => ({}));

  const title =
    body.title !== undefined
      ? String(body.title).trim() || '未命名笔记'
      : existing.title;
  const content = body.content !== undefined ? String(body.content) : existing.content;
  const contentHtml =
    body.contentHtml !== undefined ? String(body.contentHtml) : existing.content_html;
  let notebookId = existing.notebook_id;
  if (body.notebookId !== undefined) {
    notebookId = body.notebookId ? String(body.notebookId) : null;
    if (notebookId) {
      const nb = db
        .prepare('SELECT id FROM notebooks WHERE id = ? AND user_id = ?')
        .get(notebookId, user.id);
      if (!nb) return c.json({ error: '笔记本不存在' }, 400);
    }
  }
  const isFavorite =
    body.isFavorite !== undefined ? (body.isFavorite ? 1 : 0) : existing.is_favorite;

  const tx = db.transaction(() => {
    db.prepare(
      `UPDATE notes
       SET title = ?, content = ?, content_html = ?, notebook_id = ?,
           is_favorite = ?, updated_at = datetime('now')
       WHERE id = ? AND user_id = ?`
    ).run(title, content, contentHtml, notebookId, isFavorite, id, user.id);
    syncNoteFts(id, title, content);
  });
  tx();

  const row = db.prepare('SELECT * FROM notes WHERE id = ?').get(id) as NoteRow;
  return c.json(mapNote(row, true));
});

noteRoutes.post('/:id/trash', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT id, deleted_at FROM notes WHERE id = ? AND user_id = ?')
    .get(id, user.id) as { id: string; deleted_at: string | null } | undefined;
  if (!existing) return c.json({ error: '笔记不存在' }, 404);
  if (existing.deleted_at) return c.json({ error: '已在回收站' }, 400);

  db.prepare(
    `UPDATE notes SET deleted_at = datetime('now'), updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(id, user.id);
  return c.json({ ok: true });
});

noteRoutes.post('/:id/restore', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT id, deleted_at FROM notes WHERE id = ? AND user_id = ?')
    .get(id, user.id) as { id: string; deleted_at: string | null } | undefined;
  if (!existing) return c.json({ error: '笔记不存在' }, 404);
  if (!existing.deleted_at) return c.json({ error: '不在回收站中' }, 400);

  db.prepare(
    `UPDATE notes SET deleted_at = NULL, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(id, user.id);
  return c.json({ ok: true });
});

noteRoutes.delete('/:id', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT id FROM notes WHERE id = ? AND user_id = ?')
    .get(id, user.id);
  if (!existing) return c.json({ error: '笔记不存在' }, 404);

  const tx = db.transaction(() => {
    db.prepare('DELETE FROM notes WHERE id = ? AND user_id = ?').run(id, user.id);
    removeNoteFts(id);
  });
  tx();
  return c.json({ ok: true });
});

noteRoutes.delete('/', (c) => {
  const user = getUser(c);
  const trashOnly = c.req.query('trash') === '1';
  if (!trashOnly) return c.json({ error: '请使用 ?trash=1 清空回收站' }, 400);

  const rows = db
    .prepare('SELECT id FROM notes WHERE user_id = ? AND deleted_at IS NOT NULL')
    .all(user.id) as { id: string }[];

  const tx = db.transaction(() => {
    for (const r of rows) {
      db.prepare('DELETE FROM notes WHERE id = ?').run(r.id);
      removeNoteFts(r.id);
    }
  });
  tx();
  return c.json({ ok: true, count: rows.length });
});
