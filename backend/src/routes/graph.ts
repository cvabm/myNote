import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import { db } from '../db.js';
import { requireAuth, getUser, type AppVariables } from '../auth.js';
import {
  computeDefaultLayout,
  rebuildAllWikiEdges,
  syncStructuralGraph,
  syncWikiEdgesForNote,
} from '../graphSync.js';

type GraphNodeRow = {
  id: string;
  user_id: string;
  type: string;
  ref_id: string | null;
  title: string;
  color: string;
  x: number | null;
  y: number | null;
  pinned: number;
  created_at: string;
  updated_at: string;
};

type GraphEdgeRow = {
  id: string;
  user_id: string;
  from_id: string;
  to_id: string;
  relation: string;
  source: string;
  weight: number;
  created_at: string;
};

export const graphRoutes = new Hono<{ Variables: AppVariables }>();
graphRoutes.use('*', requireAuth);

function mapNode(
  row: GraphNodeRow,
  layout: Map<string, { x: number; y: number }>,
  degree: number,
  clusterId: string | null
) {
  const fallback = layout.get(row.id);
  const x = row.pinned && row.x != null ? row.x : (row.x ?? fallback?.x ?? 0);
  const y = row.pinned && row.y != null ? row.y : (row.y ?? fallback?.y ?? 0);
  return {
    id: row.id,
    type: row.type as 'concept' | 'note' | 'notebook',
    refId: row.ref_id,
    title: row.title,
    color: row.color,
    x,
    y,
    pinned: !!row.pinned,
    degree,
    clusterId,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapEdge(row: GraphEdgeRow) {
  return {
    id: row.id,
    fromId: row.from_id,
    toId: row.to_id,
    relation: row.relation,
    source: row.source as 'wiki' | 'system' | 'manual',
    weight: row.weight,
    createdAt: row.created_at,
  };
}

/** 同步结构 + wiki，返回完整图 */
function buildGraph(userId: string) {
  syncStructuralGraph(userId);
  rebuildAllWikiEdges(userId);

  const nodes = db
    .prepare(`SELECT * FROM graph_nodes WHERE user_id = ?`)
    .all(userId) as GraphNodeRow[];
  const edges = db
    .prepare(`SELECT * FROM graph_edges WHERE user_id = ?`)
    .all(userId) as GraphEdgeRow[];

  const layout = computeDefaultLayout(userId);

  // 度数：用于前端 LOD
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.from_id, (degree.get(e.from_id) || 0) + 1);
    degree.set(e.to_id, (degree.get(e.to_id) || 0) + 1);
  }

  // clusterId：笔记归属笔记本图节点；概念独立；笔记本自身
  const noteToNb = new Map<string, string | null>();
  const noteRows = db
    .prepare(
      `SELECT id, notebook_id FROM notes WHERE user_id = ? AND deleted_at IS NULL`
    )
    .all(userId) as { id: string; notebook_id: string | null }[];
  for (const n of noteRows) noteToNb.set(n.id, n.notebook_id);

  const nbNodeByRef = new Map<string, string>();
  for (const n of nodes) {
    if (n.type === 'notebook' && n.ref_id) nbNodeByRef.set(n.ref_id, n.id);
  }

  const mappedNodes = nodes.map((n) => {
    let clusterId: string | null = null;
    if (n.type === 'notebook') clusterId = n.id;
    else if (n.type === 'note' && n.ref_id) {
      const nbRef = noteToNb.get(n.ref_id);
      clusterId = nbRef ? nbNodeByRef.get(nbRef) ?? null : null;
    } else if (n.type === 'concept') {
      clusterId = n.id;
    }
    return mapNode(n, layout, degree.get(n.id) || 0, clusterId);
  });

  return {
    nodes: mappedNodes,
    edges: edges.map(mapEdge),
  };
}

/** GET /api/graph — 全量知识图（含默认布局） */
graphRoutes.get('/', (c) => {
  const user = getUser(c);
  return c.json(buildGraph(user.id));
});

/** POST /api/graph/rebuild — 强制重建 system + wiki */
graphRoutes.post('/rebuild', (c) => {
  const user = getUser(c);
  return c.json(buildGraph(user.id));
});

/** POST /api/graph/nodes — 创建游离概念节点 */
graphRoutes.post('/nodes', async (c) => {
  const user = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const title = String(body.title ?? '').trim();
  if (!title) return c.json({ error: '标题不能为空' }, 400);

  const color = String(body.color ?? '#8b5cf6').trim() || '#8b5cf6';
  const x = typeof body.x === 'number' && Number.isFinite(body.x) ? body.x : 0;
  const y = typeof body.y === 'number' && Number.isFinite(body.y) ? body.y : 0;
  const pinned = body.pinned === false ? 0 : 1;

  const id = nanoid();
  db.prepare(
    `INSERT INTO graph_nodes (id, user_id, type, ref_id, title, color, x, y, pinned)
     VALUES (?, ?, 'concept', NULL, ?, ?, ?, ?, ?)`
  ).run(id, user.id, title, color, x, y, pinned);

  // 新建概念后，已有 wiki 指向同名标题的笔记边需要接上
  rebuildAllWikiEdges(user.id);

  const row = db.prepare('SELECT * FROM graph_nodes WHERE id = ?').get(id) as GraphNodeRow;
  return c.json(
    {
      id: row.id,
      type: 'concept' as const,
      refId: null,
      title: row.title,
      color: row.color,
      x: row.x ?? 0,
      y: row.y ?? 0,
      pinned: !!row.pinned,
      degree: 0,
      clusterId: row.id,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
    201
  );
});

/** PATCH /api/graph/nodes/:id — 改标题/颜色/位置（note 标题只改图上展示缓存，不反写笔记） */
graphRoutes.patch('/nodes/:id', async (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const row = db
    .prepare('SELECT * FROM graph_nodes WHERE id = ? AND user_id = ?')
    .get(id, user.id) as GraphNodeRow | undefined;
  if (!row) return c.json({ error: '节点不存在' }, 404);

  const body = await c.req.json().catch(() => ({}));

  let title = row.title;
  let color = row.color;
  let x = row.x;
  let y = row.y;
  let pinned = row.pinned;

  // 仅 concept 允许改标题；note/notebook 标题以源为准
  if (row.type === 'concept' && body.title !== undefined) {
    title = String(body.title).trim() || row.title;
  }
  if (body.color !== undefined) {
    color = String(body.color).trim() || row.color;
  }
  if (typeof body.x === 'number' && Number.isFinite(body.x)) x = body.x;
  if (typeof body.y === 'number' && Number.isFinite(body.y)) y = body.y;
  if (body.pinned !== undefined) pinned = body.pinned ? 1 : 0;
  // 拖拽时默认钉住
  if (
    (typeof body.x === 'number' || typeof body.y === 'number') &&
    body.pinned === undefined
  ) {
    pinned = 1;
  }

  db.prepare(
    `UPDATE graph_nodes
     SET title = ?, color = ?, x = ?, y = ?, pinned = ?, updated_at = datetime('now')
     WHERE id = ? AND user_id = ?`
  ).run(title, color, x, y, pinned, id, user.id);

  if (row.type === 'concept' && body.title !== undefined && title !== row.title) {
    rebuildAllWikiEdges(user.id);
  }

  const updated = db
    .prepare('SELECT * FROM graph_nodes WHERE id = ?')
    .get(id) as GraphNodeRow;
  return c.json({
    id: updated.id,
    type: updated.type,
    refId: updated.ref_id,
    title: updated.title,
    color: updated.color,
    x: updated.x ?? 0,
    y: updated.y ?? 0,
    pinned: !!updated.pinned,
    createdAt: updated.created_at,
    updatedAt: updated.updated_at,
  });
});

/** DELETE /api/graph/nodes/:id — 仅可删游离概念 */
graphRoutes.delete('/nodes/:id', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const row = db
    .prepare('SELECT * FROM graph_nodes WHERE id = ? AND user_id = ?')
    .get(id, user.id) as GraphNodeRow | undefined;
  if (!row) return c.json({ error: '节点不存在' }, 404);
  if (row.type !== 'concept') {
    return c.json({ error: '笔记/笔记本节点请在原模块中删除' }, 400);
  }
  db.prepare('DELETE FROM graph_nodes WHERE id = ? AND user_id = ?').run(id, user.id);
  return c.json({ ok: true });
});

/** POST /api/graph/edges — 手动连线 */
graphRoutes.post('/edges', async (c) => {
  const user = getUser(c);
  const body = await c.req.json().catch(() => ({}));
  const fromId = String(body.fromId || '');
  const toId = String(body.toId || '');
  const relation = String(body.relation || 'related').trim() || 'related';
  if (!fromId || !toId) return c.json({ error: '需要 fromId 与 toId' }, 400);
  if (fromId === toId) return c.json({ error: '不能连接自身' }, 400);

  const from = db
    .prepare('SELECT id FROM graph_nodes WHERE id = ? AND user_id = ?')
    .get(fromId, user.id);
  const to = db
    .prepare('SELECT id FROM graph_nodes WHERE id = ? AND user_id = ?')
    .get(toId, user.id);
  if (!from || !to) return c.json({ error: '节点不存在' }, 400);

  const existing = db
    .prepare(
      `SELECT id FROM graph_edges
       WHERE user_id = ? AND from_id = ? AND to_id = ? AND source = 'manual' AND relation = ?`
    )
    .get(user.id, fromId, toId, relation) as { id: string } | undefined;
  if (existing) {
    const row = db
      .prepare('SELECT * FROM graph_edges WHERE id = ?')
      .get(existing.id) as GraphEdgeRow;
    return c.json(mapEdge(row));
  }

  const id = nanoid();
  db.prepare(
    `INSERT INTO graph_edges (id, user_id, from_id, to_id, relation, source, weight)
     VALUES (?, ?, ?, ?, ?, 'manual', 1)`
  ).run(id, user.id, fromId, toId, relation);

  const row = db.prepare('SELECT * FROM graph_edges WHERE id = ?').get(id) as GraphEdgeRow;
  return c.json(mapEdge(row), 201);
});

/** DELETE /api/graph/edges/:id — 仅可删 manual */
graphRoutes.delete('/edges/:id', (c) => {
  const user = getUser(c);
  const id = c.req.param('id');
  const row = db
    .prepare('SELECT * FROM graph_edges WHERE id = ? AND user_id = ?')
    .get(id, user.id) as GraphEdgeRow | undefined;
  if (!row) return c.json({ error: '边不存在' }, 404);
  if (row.source !== 'manual') {
    return c.json({ error: '系统/wiki 边不可手动删除（改笔记正文或笔记本即可）' }, 400);
  }
  db.prepare('DELETE FROM graph_edges WHERE id = ? AND user_id = ?').run(id, user.id);
  return c.json({ ok: true });
});

/** 供 notes 路由调用的轻量同步（避免每次 GET 全量 rebuild 太重时可选） */
export function onNoteContentChanged(userId: string, noteId: string) {
  syncStructuralGraph(userId);
  syncWikiEdgesForNote(userId, noteId);
}
