import { nanoid } from 'nanoid';
import { db } from './db.js';

export type GraphNodeType = 'concept' | 'note' | 'notebook';
export type GraphEdgeSource = 'wiki' | 'system' | 'manual';

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

type NoteLite = {
  id: string;
  title: string;
  content: string;
  notebook_id: string | null;
};

type NotebookLite = {
  id: string;
  parent_id: string | null;
  name: string;
  color: string;
};

/** 去掉代码块 / 行内代码，避免误解析 [[...]] */
function stripCodeForWiki(md: string): string {
  return (md || '')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/~~~[\s\S]*?~~~/g, ' ')
    .replace(/`[^`\n]+`/g, ' ');
}

/** 常见非知识链：目录标记等，不生成边 / 不建概念 */
const WIKI_TITLE_BLOCKLIST = new Set([
  'toc',
  '目录',
  'contents',
  'table of contents',
]);

/**
 * 提取 wiki 链目标标题。
 * 支持：[[标题]]、[[标题|别名]]、[[标题#锚点]]
 */
export function extractWikiLinkTitles(content: string): string[] {
  const text = stripCodeForWiki(content);
  const re = /\[\[([^\]\n]+)\]\]/g;
  const titles: string[] = [];
  const seen = new Set<string>();
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    let raw = (m[1] || '').trim();
    if (!raw) continue;
    // 别名：[[目标|显示]]
    const pipe = raw.indexOf('|');
    if (pipe >= 0) raw = raw.slice(0, pipe).trim();
    // 锚点：[[目标#heading]]
    const hash = raw.indexOf('#');
    if (hash >= 0) raw = raw.slice(0, hash).trim();
    if (!raw) continue;
    if (WIKI_TITLE_BLOCKLIST.has(raw.toLowerCase())) continue;
    // 纯数字 / 过短通常是误写
    if (raw.length < 1 || /^\d+$/.test(raw)) continue;
    const key = raw.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    titles.push(raw);
  }
  return titles;
}

/** 确保同名游离概念存在（用于未匹配到笔记的 wiki 目标） */
export function ensureConceptByTitle(userId: string, title: string, color = '#8b5cf6'): string {
  const existing = db
    .prepare(
      `SELECT id FROM graph_nodes
       WHERE user_id = ? AND type = 'concept' AND lower(title) = lower(?)
       LIMIT 1`
    )
    .get(userId, title) as { id: string } | undefined;
  if (existing) return existing.id;
  const id = nanoid();
  db.prepare(
    `INSERT INTO graph_nodes (id, user_id, type, ref_id, title, color, pinned)
     VALUES (?, ?, 'concept', NULL, ?, ?, 0)`
  ).run(id, userId, title, color);
  return id;
}

function getNodeByRef(
  userId: string,
  type: GraphNodeType,
  refId: string
): GraphNodeRow | undefined {
  return db
    .prepare(
      `SELECT * FROM graph_nodes WHERE user_id = ? AND type = ? AND ref_id = ?`
    )
    .get(userId, type, refId) as GraphNodeRow | undefined;
}

/** 确保 note/notebook 有对应图节点；返回节点 id */
export function ensureRefNode(
  userId: string,
  type: 'note' | 'notebook',
  refId: string,
  title: string,
  color = '#6366f1'
): string {
  const existing = getNodeByRef(userId, type, refId);
  if (existing) {
    if (existing.title !== title || (type === 'notebook' && existing.color !== color)) {
      db.prepare(
        `UPDATE graph_nodes
         SET title = ?, color = ?, updated_at = datetime('now')
         WHERE id = ?`
      ).run(title, type === 'notebook' ? color : existing.color, existing.id);
    }
    return existing.id;
  }
  const id = nanoid();
  db.prepare(
    `INSERT INTO graph_nodes (id, user_id, type, ref_id, title, color)
     VALUES (?, ?, ?, ?, ?, ?)`
  ).run(id, userId, type, refId, title, color);
  return id;
}

export function removeRefNode(userId: string, type: 'note' | 'notebook', refId: string) {
  const row = getNodeByRef(userId, type, refId);
  if (!row) return;
  // edges cascade via FK
  db.prepare('DELETE FROM graph_nodes WHERE id = ? AND user_id = ?').run(row.id, userId);
}

function upsertSystemEdge(
  userId: string,
  fromId: string,
  toId: string,
  relation: string
) {
  if (fromId === toId) return;
  const existing = db
    .prepare(
      `SELECT id FROM graph_edges
       WHERE user_id = ? AND from_id = ? AND to_id = ? AND source = 'system' AND relation = ?`
    )
    .get(userId, fromId, toId, relation) as { id: string } | undefined;
  if (existing) return;
  db.prepare(
    `INSERT INTO graph_edges (id, user_id, from_id, to_id, relation, source, weight)
     VALUES (?, ?, ?, ?, ?, 'system', 1)`
  ).run(nanoid(), userId, fromId, toId, relation);
}

/** 重建笔记本树与 note→notebook 的 system 边；清理孤儿 ref 节点 */
export function syncStructuralGraph(userId: string) {
  const notebooks = db
    .prepare(
      `SELECT id, parent_id, name, color FROM notebooks WHERE user_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(userId) as NotebookLite[];
  const notes = db
    .prepare(
      `SELECT id, title, content, notebook_id FROM notes
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC, id ASC`
    )
    .all(userId) as NoteLite[];

  const nbNodeIds = new Map<string, string>();
  for (const nb of notebooks) {
    nbNodeIds.set(nb.id, ensureRefNode(userId, 'notebook', nb.id, nb.name, nb.color));
  }

  const noteNodeIds = new Map<string, string>();
  for (const n of notes) {
    noteNodeIds.set(n.id, ensureRefNode(userId, 'note', n.id, n.title));
  }

  // 删除已不存在的 note/notebook 图节点
  const liveNoteRefs = new Set(notes.map((n) => n.id));
  const liveNbRefs = new Set(notebooks.map((n) => n.id));
  const stale = db
    .prepare(
      `SELECT id, type, ref_id FROM graph_nodes
       WHERE user_id = ? AND type IN ('note', 'notebook') AND ref_id IS NOT NULL`
    )
    .all(userId) as { id: string; type: string; ref_id: string }[];
  for (const s of stale) {
    const alive =
      s.type === 'note' ? liveNoteRefs.has(s.ref_id) : liveNbRefs.has(s.ref_id);
    if (!alive) {
      db.prepare('DELETE FROM graph_nodes WHERE id = ?').run(s.id);
    }
  }

  // 清掉旧 system 边后重建（数量通常不大）
  db.prepare(
    `DELETE FROM graph_edges WHERE user_id = ? AND source = 'system'`
  ).run(userId);

  for (const nb of notebooks) {
    const childNode = nbNodeIds.get(nb.id);
    if (!childNode) continue;
    if (nb.parent_id) {
      const parentNode = nbNodeIds.get(nb.parent_id);
      if (parentNode) upsertSystemEdge(userId, parentNode, childNode, 'contains');
    }
  }

  for (const n of notes) {
    const noteNode = noteNodeIds.get(n.id);
    if (!noteNode || !n.notebook_id) continue;
    const nbNode = nbNodeIds.get(n.notebook_id);
    if (nbNode) upsertSystemEdge(userId, nbNode, noteNode, 'contains');
  }

  return { notes, notebooks, noteNodeIds, nbNodeIds };
}

/** 按笔记正文重建该笔记发出的 wiki 边（可指向笔记或同名概念） */
export function syncWikiEdgesForNote(userId: string, noteId: string) {
  const note = db
    .prepare(
      `SELECT id, title, content, notebook_id FROM notes
       WHERE id = ? AND user_id = ? AND deleted_at IS NULL`
    )
    .get(noteId, userId) as NoteLite | undefined;
  if (!note) {
    removeRefNode(userId, 'note', noteId);
    return;
  }

  const fromId = ensureRefNode(userId, 'note', note.id, note.title);

  // 删除该节点作为起点的旧 wiki 边
  db.prepare(
    `DELETE FROM graph_edges WHERE user_id = ? AND from_id = ? AND source = 'wiki'`
  ).run(userId, fromId);

  const titles = extractWikiLinkTitles(note.content);
  if (titles.length === 0) return;

  // 标题 → 笔记 id（同用户未删除；大小写不敏感优先精确）
  const allNotes = db
    .prepare(
      `SELECT id, title FROM notes WHERE user_id = ? AND deleted_at IS NULL`
    )
    .all(userId) as { id: string; title: string }[];
  const byExact = new Map(allNotes.map((n) => [n.title, n.id]));
  const byLower = new Map<string, string>();
  for (const n of allNotes) {
    const k = n.title.toLowerCase();
    if (!byLower.has(k)) byLower.set(k, n.id);
  }

  // 概念节点：标题精确匹配
  const concepts = db
    .prepare(
      `SELECT id, title FROM graph_nodes WHERE user_id = ? AND type = 'concept'`
    )
    .all(userId) as { id: string; title: string }[];
  const conceptByLower = new Map<string, string>();
  for (const c of concepts) {
    const k = c.title.toLowerCase();
    if (!conceptByLower.has(k)) conceptByLower.set(k, c.id);
  }

  for (const title of titles) {
    // 不链向自己
    if (title === note.title || title.toLowerCase() === note.title.toLowerCase()) {
      continue;
    }

    let toId: string | null = null;
    const targetNoteId = byExact.get(title) ?? byLower.get(title.toLowerCase());
    if (targetNoteId) {
      const t = allNotes.find((n) => n.id === targetNoteId);
      toId = ensureRefNode(userId, 'note', targetNoteId, t?.title || title);
    } else {
      // 无同名笔记：复用或自动创建游离概念，保证 wiki 边可见
      toId =
        conceptByLower.get(title.toLowerCase()) ??
        ensureConceptByTitle(userId, title);
      conceptByLower.set(title.toLowerCase(), toId);
    }
    if (!toId || toId === fromId) continue;

    const exists = db
      .prepare(
        `SELECT id FROM graph_edges
         WHERE user_id = ? AND from_id = ? AND to_id = ? AND source = 'wiki' AND relation = 'wiki'`
      )
      .get(userId, fromId, toId);
    if (exists) continue;

    db.prepare(
      `INSERT INTO graph_edges (id, user_id, from_id, to_id, relation, source, weight)
       VALUES (?, ?, ?, ?, 'wiki', 'wiki', 1)`
    ).run(nanoid(), userId, fromId, toId);
  }
}

/** 全量重建 wiki 边 */
export function rebuildAllWikiEdges(userId: string) {
  const notes = db
    .prepare(
      `SELECT id FROM notes WHERE user_id = ? AND deleted_at IS NULL`
    )
    .all(userId) as { id: string }[];

  // 清掉全部 wiki 边后按笔记重建
  db.prepare(`DELETE FROM graph_edges WHERE user_id = ? AND source = 'wiki'`).run(
    userId
  );
  for (const n of notes) {
    syncWikiEdgesForNote(userId, n.id);
  }
}

/** 为未固定节点计算默认布局（多笔记本分散 + 大簇多环，避免全堆默认本中心） */
export function computeDefaultLayout(userId: string): Map<string, { x: number; y: number }> {
  const notebooks = db
    .prepare(
      `SELECT id, parent_id, name, color FROM notebooks WHERE user_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(userId) as NotebookLite[];
  const notes = db
    .prepare(
      `SELECT id, title, notebook_id FROM notes
       WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY updated_at DESC, id ASC`
    )
    .all(userId) as { id: string; title: string; notebook_id: string | null }[];
  const concepts = db
    .prepare(
      `SELECT id, title FROM graph_nodes WHERE user_id = ? AND type = 'concept'
       ORDER BY created_at ASC, id ASC`
    )
    .all(userId) as { id: string; title: string }[];

  // 各本笔记数，用于按规模拉开间距
  const countByNb = new Map<string, number>();
  for (const n of notes) {
    if (!n.notebook_id) continue;
    countByNb.set(n.notebook_id, (countByNb.get(n.notebook_id) || 0) + 1);
  }

  const positions = new Map<string, { x: number; y: number }>();
  const roots = notebooks.filter((n) => !n.parent_id);
  const childrenOf = new Map<string, NotebookLite[]>();
  for (const nb of notebooks) {
    if (!nb.parent_id) continue;
    const list = childrenOf.get(nb.parent_id) || [];
    list.push(nb);
    childrenOf.set(nb.parent_id, list);
  }

  const nbPos = new Map<string, { x: number; y: number }>();
  const rootCount = Math.max(roots.length, 1);
  // 笔记本越多、单本越大，环半径越大，避免重叠
  const maxNotes = Math.max(1, ...[...countByNb.values()], 1);
  const baseR = 420 + Math.min(rootCount, 20) * 36 + Math.min(maxNotes, 40) * 4;

  roots.forEach((nb, i) => {
    const angle = (2 * Math.PI * i) / rootCount - Math.PI / 2;
    // 大簇略外移
    const weight = 1 + Math.min(countByNb.get(nb.id) || 0, 50) / 80;
    const r = baseR * weight;
    const x = Math.cos(angle) * r;
    const y = Math.sin(angle) * r;
    nbPos.set(nb.id, { x, y });
  });

  // 子笔记本环绕父本
  for (const [parentId, kids] of childrenOf) {
    const parent = nbPos.get(parentId) || { x: 0, y: 0 };
    const n = Math.max(kids.length, 1);
    kids.forEach((ch, i) => {
      const angle = (2 * Math.PI * i) / n + 0.3;
      const cr = 160 + Math.min(countByNb.get(ch.id) || 0, 20) * 5;
      nbPos.set(ch.id, {
        x: parent.x + Math.cos(angle) * cr,
        y: parent.y + Math.sin(angle) * cr,
      });
    });
  }

  // 没有出现在树布局里的（兜底）
  notebooks.forEach((nb, i) => {
    if (nbPos.has(nb.id)) return;
    const angle = (2 * Math.PI * i) / Math.max(notebooks.length, 1);
    nbPos.set(nb.id, { x: Math.cos(angle) * baseR * 0.7, y: Math.sin(angle) * baseR * 0.7 });
  });

  for (const nb of notebooks) {
    const p = nbPos.get(nb.id);
    const node = getNodeByRef(userId, 'notebook', nb.id);
    if (p && node) positions.set(node.id, p);
  }

  // 按笔记本分组笔记；大簇用多环分布，避免单环重叠
  const byNb = new Map<string | null, typeof notes>();
  for (const n of notes) {
    const key = n.notebook_id;
    const list = byNb.get(key) || [];
    list.push(n);
    byNb.set(key, list);
  }

  for (const [nbId, list] of byNb) {
    const center = nbId && nbPos.has(nbId) ? nbPos.get(nbId)! : { x: 0, y: 0 };
    const total = list.length;
    // 每环最多约 14 个，半径递增
    const perRing = 14;
    list.forEach((n, i) => {
      const ring = Math.floor(i / perRing);
      const idxInRing = i % perRing;
      const inThisRing = Math.min(perRing, total - ring * perRing);
      const orbitR = 70 + ring * 42 + Math.min(inThisRing, 12) * 2;
      const angle = (2 * Math.PI * idxInRing) / Math.max(inThisRing, 1) + ring * 0.15;
      const x = center.x + Math.cos(angle) * orbitR;
      const y = center.y + Math.sin(angle) * orbitR;
      const node = getNodeByRef(userId, 'note', n.id);
      if (node) positions.set(node.id, { x, y });
    });
  }

  // 游离概念：最外稀疏环
  const conceptR = baseR + 280;
  concepts.forEach((c, i) => {
    const angle = (2 * Math.PI * i) / Math.max(concepts.length, 1) + 0.4;
    positions.set(c.id, {
      x: Math.cos(angle) * conceptR,
      y: Math.sin(angle) * conceptR,
    });
  });

  return positions;
}
