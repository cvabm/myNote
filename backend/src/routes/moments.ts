import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { requireAuth, getUser, type AppVariables } from '../auth.js';

const MAX_CONTENT = 2000;
const MAX_IMAGES = 9;

type MomentRow = {
  id: string;
  user_id: string;
  content: string;
  images: string;
  created_at: string;
  updated_at: string;
};

export const momentRoutes = new Hono<{ Variables: AppVariables }>();
momentRoutes.use('*', requireAuth);

function parseImages(raw: unknown): string[] {
  if (Array.isArray(raw)) {
    return raw
      .map((x) => String(x || '').trim())
      .filter((u) => u.startsWith('/uploads/') || u.startsWith('http://') || u.startsWith('https://'))
      .slice(0, MAX_IMAGES);
  }
  if (typeof raw === 'string' && raw.trim()) {
    try {
      return parseImages(JSON.parse(raw));
    } catch {
      return [];
    }
  }
  return [];
}

function mapMoment(row: MomentRow) {
  let images: string[] = [];
  try {
    images = parseImages(JSON.parse(row.images || '[]'));
  } catch {
    images = [];
  }
  return {
    id: row.id,
    content: row.content,
    images,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

momentRoutes.get('/', (c) => {
  const user = getUser(c);
  const limitRaw = Number(c.req.query('limit') || 20);
  const limit = Math.min(100, Math.max(1, Number.isFinite(limitRaw) ? limitRaw : 20));
  const before = (c.req.query('before') || '').trim(); // created_at cursor
  const beforeId = (c.req.query('beforeId') || '').trim();
  const q = (c.req.query('q') || '').trim();

  let sql = `
    SELECT * FROM moments
    WHERE user_id = ?
  `;
  const params: unknown[] = [user.id];

  if (q) {
    // 按空格拆词，每词都要命中（AND）；用 LIKE 覆盖中文
    const terms = q
      .split(/\s+/)
      .map((t) => t.trim())
      .filter(Boolean)
      .slice(0, 8);
    for (const term of terms) {
      sql += ` AND content LIKE ? ESCAPE '\\' `;
      // 转义 LIKE 通配符
      const escaped = term.replace(/\\/g, '\\\\').replace(/%/g, '\\%').replace(/_/g, '\\_');
      params.push(`%${escaped}%`);
    }
  }

  if (before) {
    // 稳定游标：(created_at, id) 字典序倒序翻页
    if (beforeId) {
      sql += ` AND (created_at < ? OR (created_at = ? AND id < ?)) `;
      params.push(before, before, beforeId);
    } else {
      sql += ` AND created_at < ? `;
      params.push(before);
    }
  }

  sql += ` ORDER BY created_at DESC, id DESC LIMIT ? `;
  params.push(limit + 1);

  const rows = db.prepare(sql).all(...params) as MomentRow[];
  const hasMore = rows.length > limit;
  const items = rows.slice(0, limit).map(mapMoment);
  return c.json({ items, hasMore });
});

momentRoutes.get('/:id', (c) => {
  const user = getUser(c);
  const row = db
    .prepare('SELECT * FROM moments WHERE id = ? AND user_id = ?')
    .get(c.req.param('id'), user.id) as MomentRow | undefined;
  if (!row) return c.json({ error: '说说不存在' }, 404);
  return c.json(mapMoment(row));
});

momentRoutes.post('/', async (c) => {
  const user = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const content = String(body.content ?? '').trim();
  const images = parseImages(body.images);

  if (!content && images.length === 0) {
    return c.json({ error: '请输入内容或添加图片' }, 400);
  }
  if (content.length > MAX_CONTENT) {
    return c.json({ error: `内容不能超过 ${MAX_CONTENT} 字` }, 400);
  }

  const id = nanoid();
  db.prepare(
    `INSERT INTO moments (id, user_id, content, images)
     VALUES (?, ?, ?, ?)`
  ).run(id, user.id, content, JSON.stringify(images));

  const row = db.prepare('SELECT * FROM moments WHERE id = ?').get(id) as MomentRow;
  return c.json(mapMoment(row), 201);
});

momentRoutes.patch('/:id', async (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT * FROM moments WHERE id = ? AND user_id = ?')
    .get(id, user.id) as MomentRow | undefined;
  if (!existing) return c.json({ error: '说说不存在' }, 404);

  const body = await c.req.json().catch(() => ({}));
  const content =
    body.content !== undefined ? String(body.content).trim() : existing.content;
  const images = body.images !== undefined ? parseImages(body.images) : parseImages(existing.images);

  if (!content && images.length === 0) {
    return c.json({ error: '请输入内容或添加图片' }, 400);
  }
  if (content.length > MAX_CONTENT) {
    return c.json({ error: `内容不能超过 ${MAX_CONTENT} 字` }, 400);
  }

  db.prepare(
    `UPDATE moments
     SET content = ?, images = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(content, JSON.stringify(images), id, user.id);

  const row = db.prepare('SELECT * FROM moments WHERE id = ?').get(id) as MomentRow;
  return c.json(mapMoment(row));
});

momentRoutes.delete('/:id', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const existing = db
    .prepare('SELECT id FROM moments WHERE id = ? AND user_id = ?')
    .get(id, user.id);
  if (!existing) return c.json({ error: '说说不存在' }, 404);

  db.prepare('DELETE FROM moments WHERE id = ? AND user_id = ?').run(id, user.id);
  return c.json({ ok: true });
});
