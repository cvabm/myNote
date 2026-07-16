import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { requireAuth, type AppVariables } from '../auth.js';

const UPLOAD_DIR = process.env.UPLOAD_DIR || './data/uploads';
const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024); // 8MB

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

fs.mkdirSync(path.resolve(UPLOAD_DIR), { recursive: true });

export const uploadRoutes = new Hono<{ Variables: AppVariables }>();
uploadRoutes.use('*', requireAuth);

uploadRoutes.post('/', async (c) => {
  const body = await c.req.parseBody({ all: true });
  const raw = body.file;
  const file = Array.isArray(raw) ? raw[0] : raw;

  if (!file || typeof file === 'string') {
    return c.json({ error: '请选择图片文件（字段名 file）' }, 400);
  }

  const mime = file.type || '';
  const ext = ALLOWED[mime];
  if (!ext) {
    return c.json({ error: '仅支持 JPEG / PNG / GIF / WebP' }, 400);
  }

  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.byteLength === 0) {
    return c.json({ error: '文件为空' }, 400);
  }
  if (buf.byteLength > MAX_BYTES) {
    return c.json({ error: `图片不能超过 ${Math.round(MAX_BYTES / 1024 / 1024)}MB` }, 400);
  }

  const name = `${nanoid(16)}${ext}`;
  const dest = path.join(path.resolve(UPLOAD_DIR), name);
  fs.writeFileSync(dest, buf);

  const url = `/uploads/${name}`;
  return c.json({ url, name, size: buf.byteLength }, 201);
});
