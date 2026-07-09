import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { logger } from 'hono/logger';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { initDb } from './db.js';
import { authRoutes } from './routes/auth.js';
import { notebookRoutes } from './routes/notebooks.js';
import { noteRoutes } from './routes/notes.js';
import { tagRoutes } from './routes/tags.js';

const PORT = Number(process.env.PORT || 3001);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

initDb();

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
app.route('/api/tags', tagRoutes);

// 生产环境托管前端静态资源
const staticCandidates = [
  process.env.STATIC_DIR,
  path.resolve(__dirname, '../../frontend/dist'),
  path.resolve(__dirname, '../public'),
  '/app/public',
].filter(Boolean) as string[];

const staticDir = staticCandidates.find((d) => fs.existsSync(path.join(d, 'index.html')));

if (staticDir) {
  const rel = path.relative(process.cwd(), staticDir).replace(/\\/g, '/') || '.';
  app.use('/*', serveStatic({ root: rel }));
  app.get('*', async (c) => {
    const index = path.join(staticDir, 'index.html');
    const html = fs.readFileSync(index, 'utf-8');
    return c.html(html);
  });
  console.log(`[static] serving frontend from ${staticDir}`);
}

console.log(`[mynote] listening on http://0.0.0.0:${PORT}`);

serve({
  fetch: app.fetch,
  port: PORT,
  hostname: '0.0.0.0',
});
