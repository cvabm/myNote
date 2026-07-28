import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { nanoid } from 'nanoid';
import { requireAuth, type AppVariables } from '../auth.js';
import { resolveDataPath } from '../paths.js';

const UPLOAD_DIR = resolveDataPath(process.env.UPLOAD_DIR || './data/uploads');
const MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES || 8 * 1024 * 1024); // 8MB

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
};

fs.mkdirSync(UPLOAD_DIR, { recursive: true });

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
  const dest = path.join(UPLOAD_DIR, name);
  fs.writeFileSync(dest, buf);

  const url = `/uploads/${name}`;
  return c.json({ url, name, size: buf.byteLength }, 201);
});

/** 删除已上传图片文件（仅允许 uploads 目录下安全文件名） */
uploadRoutes.delete('/:name', (c) => {
  const name = path.basename(c.req.param('name') || '');
  if (!name || name === '.' || name === '..') {
    return c.json({ error: '无效文件名' }, 400);
  }
  // 仅允许我们上传时生成的 nanoid + 扩展名
  if (!/^[A-Za-z0-9_-]{8,}\.(jpg|jpeg|png|gif|webp)$/i.test(name)) {
    return c.json({ error: '无效文件名' }, 400);
  }

  const dest = path.join(UPLOAD_DIR, name);
  if (!dest.startsWith(UPLOAD_DIR + path.sep) && dest !== UPLOAD_DIR) {
    return c.json({ error: '禁止访问' }, 403);
  }

  if (fs.existsSync(dest) && fs.statSync(dest).isFile()) {
    fs.unlinkSync(dest);
  }
  // 文件不存在也视为成功（幂等）
  return c.json({ ok: true });
});
