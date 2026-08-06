import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth, type AppVariables } from '../auth.js';

const MAX_CONTENT = 200_000;

type SoftwareRow = {
  id: number;
  content: string;
  updated_at: string;
};

function getRow(): SoftwareRow {
  const row = db.prepare('SELECT id, content, updated_at FROM software_page WHERE id = 1').get() as
    | SoftwareRow
    | undefined;
  if (row) return row;
  db.prepare(
    `INSERT INTO software_page (id, content, updated_at) VALUES (1, '', datetime('now'))`
  ).run();
  return db.prepare('SELECT id, content, updated_at FROM software_page WHERE id = 1').get() as SoftwareRow;
}

function mapPage(row: SoftwareRow) {
  return {
    content: row.content,
    updatedAt: row.updated_at,
  };
}

export const softwareRoutes = new Hono<{ Variables: AppVariables }>();
softwareRoutes.use('*', requireAuth);

softwareRoutes.get('/', (c) => {
  return c.json(mapPage(getRow()));
});

softwareRoutes.put('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const content = typeof body.content === 'string' ? body.content : '';
  if (content.length > MAX_CONTENT) {
    return c.json({ error: `内容过长（最多 ${MAX_CONTENT} 字）` }, 400);
  }
  getRow();
  db.prepare(
    `UPDATE software_page SET content = ?, updated_at = datetime('now') WHERE id = 1`
  ).run(content);
  return c.json(mapPage(getRow()));
});

/** 免登录只读，给工具站对外页用 */
export const publicSoftwareRoutes = new Hono();

publicSoftwareRoutes.get('/', (c) => {
  c.header('Cache-Control', 'no-store');
  return c.json(mapPage(getRow()));
});
