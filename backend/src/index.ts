import { serve } from '@hono/node-server';
import { Hono, type Context } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';
import { initDb } from './db.js';
import { authRoutes } from './routes/auth.js';
import { momentRoutes } from './routes/moments.js';
import { notebookRoutes } from './routes/notebooks.js';
import { noteRoutes } from './routes/notes.js';
import { uploadRoutes } from './routes/uploads.js';

const PORT = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || './data/uploads');

initDb();
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const app = new Hono();

app.use('*', logger());
app.use(
  '/api/*',
  cors({
    origin: (origin) => origin || '*',
    allowHeaders: ['Content-Type', 'Authorization'],
    allowMethods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
  })
);

app.get('/api/health', (c) => c.json({ ok: true, name: 'MyNote', version: '1.0.0' }));

app.route('/api/auth', authRoutes);
app.route('/api/notebooks', notebookRoutes);
app.route('/api/notes', noteRoutes);
app.route('/api/moments', momentRoutes);
app.route('/api/uploads', uploadRoutes);

// 笔记图片（文件名随机，GET 无需登录以便 Markdown 预览）
app.get('/uploads/*', (c) => {
  const rel = c.req.path.replace(/^\/uploads\/?/, '');
  if (!rel || rel.includes('..')) return c.text('Forbidden', 403);
  const filePath = path.join(UPLOAD_DIR, path.basename(rel));
  if (!filePath.startsWith(UPLOAD_DIR)) return c.text('Forbidden', 403);
  const res = sendFile(c, filePath, { immutable: true });
  return res ?? c.text('Not Found', 404);
});

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.map': 'application/json',
  '.txt': 'text/plain; charset=utf-8',
};

const COMPRESSIBLE = new Set(['.html', '.js', '.mjs', '.css', '.json', '.svg', '.txt', '.map']);

/** 内存缓存 gzip 结果，避免每次重新压缩大 JS */
const gzipCache = new Map<string, { mtimeMs: number; body: Buffer }>();

function safeJoin(root: string, reqPath: string): string | null {
  const decoded = decodeURIComponent(reqPath.split('?')[0] || '/');
  const rel = decoded.replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  const rootResolved = path.resolve(root);
  if (full !== rootResolved && !full.startsWith(rootResolved + path.sep)) {
    return null;
  }
  return full;
}

function sendFile(
  c: Context,
  filePath: string,
  opts: { immutable?: boolean; noCache?: boolean }
) {
  if (!fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return null;
  }

  const stat = fs.statSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const type = MIME[ext] || 'application/octet-stream';
  const accept = c.req.header('Accept-Encoding') || '';
  const wantGzip = accept.includes('gzip') && COMPRESSIBLE.has(ext) && stat.size >= 1024;

  let body: Buffer = fs.readFileSync(filePath);
  const headers: Record<string, string> = {
    'Content-Type': type,
    Vary: 'Accept-Encoding',
  };

  if (opts.immutable) {
    headers['Cache-Control'] = 'public, max-age=31536000, immutable';
  } else if (opts.noCache) {
    headers['Cache-Control'] = 'no-cache';
  }

  if (wantGzip) {
    const key = filePath;
    const cached = gzipCache.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs) {
      body = cached.body;
    } else {
      body = gzipSync(body, { level: 6 });
      gzipCache.set(key, { mtimeMs: stat.mtimeMs, body });
    }
    headers['Content-Encoding'] = 'gzip';
  }

  headers['Content-Length'] = String(body.byteLength);
  return new Response(new Uint8Array(body), { status: 200, headers });
}

// 生产环境托管前端静态资源
const staticCandidates = [
  process.env.STATIC_DIR,
  path.resolve(__dirname, '../../frontend/dist'),
  path.resolve(__dirname, '../public'),
  '/app/public',
].filter(Boolean) as string[];

const staticDir = staticCandidates.find((d) => fs.existsSync(path.join(d, 'index.html')));

if (staticDir) {
  // 构建产物：强制 gzip + 长期缓存
  app.get('/assets/*', (c) => {
    const filePath = safeJoin(staticDir, c.req.path);
    if (!filePath) return c.text('Forbidden', 403);
    const res = sendFile(c, filePath, { immutable: true });
    return res ?? c.text('Not Found', 404);
  });

  // 其它静态文件（favicon 等）
  app.get('*', (c) => {
    const filePath = safeJoin(staticDir, c.req.path);
    if (filePath && fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      const res = sendFile(c, filePath, { noCache: true });
      if (res) return res;
    }
    // SPA fallback
    const index = path.join(staticDir, 'index.html');
    const res = sendFile(c, index, { noCache: true });
    return res ?? c.text('Not Found', 404);
  });

  console.log(`[static] serving frontend from ${staticDir} (gzip enabled)`);
}

console.log(`[mynote] listening on http://0.0.0.0:${PORT}`);

serve({
  fetch: app.fetch,
  port: PORT,
  hostname: '0.0.0.0',
});
