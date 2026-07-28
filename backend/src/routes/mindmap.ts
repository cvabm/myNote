import { Hono } from 'hono';
import { db } from '../db.js';
import { requireAuth, getUser, type AppVariables } from '../auth.js';

type NbRow = {
  id: string;
  parent_id: string | null;
  name: string;
  color: string;
  sort_order: number;
};

type NoteRow = {
  id: string;
  notebook_id: string | null;
  title: string;
  updated_at: string;
};

export type MindNode = {
  id: string;
  type: 'root' | 'notebook' | 'note';
  title: string;
  color?: string;
  refId?: string | null;
  noteCount?: number;
  children: MindNode[];
};

export const mindmapRoutes = new Hono<{ Variables: AppVariables }>();
mindmapRoutes.use('*', requireAuth);

/**
 * GET /api/mindmap
 * 以笔记本树 + 笔记叶子构成思维导图数据（层级，非力导向）
 */
mindmapRoutes.get('/', (c) => {
  const user = getUser(c);

  const notebooks = db
    .prepare(
      `SELECT id, parent_id, name, color, sort_order
       FROM notebooks WHERE user_id = ?
       ORDER BY sort_order ASC, created_at ASC`
    )
    .all(user.id) as NbRow[];

  const notes = db
    .prepare(
      `SELECT id, notebook_id, title, updated_at
       FROM notes WHERE user_id = ? AND deleted_at IS NULL
       ORDER BY title COLLATE NOCASE ASC`
    )
    .all(user.id) as NoteRow[];

  const notesByNb = new Map<string | null, NoteRow[]>();
  for (const n of notes) {
    const k = n.notebook_id;
    const list = notesByNb.get(k) || [];
    list.push(n);
    notesByNb.set(k, list);
  }

  const childrenOf = new Map<string | null, NbRow[]>();
  for (const nb of notebooks) {
    const k = nb.parent_id;
    const list = childrenOf.get(k) || [];
    list.push(nb);
    childrenOf.set(k, list);
  }

  function countNotesInTree(nbId: string): number {
    let c = (notesByNb.get(nbId) || []).length;
    for (const ch of childrenOf.get(nbId) || []) {
      c += countNotesInTree(ch.id);
    }
    return c;
  }

  function buildNb(nb: NbRow): MindNode {
    const childNbs = childrenOf.get(nb.id) || [];
    const noteLeaves = (notesByNb.get(nb.id) || []).map(
      (n): MindNode => ({
        id: `note:${n.id}`,
        type: 'note',
        title: n.title || '未命名',
        refId: n.id,
        children: [],
      })
    );
    const children = [...childNbs.map(buildNb), ...noteLeaves];
    return {
      id: `nb:${nb.id}`,
      type: 'notebook',
      title: nb.name,
      color: nb.color,
      refId: nb.id,
      noteCount: countNotesInTree(nb.id),
      children,
    };
  }

  // 根下：顶级笔记本（排除空的「默认笔记本」可保留但标 0）
  const roots = (childrenOf.get(null) || []).map(buildNb);

  // 无笔记本的笔记
  const orphanNotes = (notesByNb.get(null) || []).map(
    (n): MindNode => ({
      id: `note:${n.id}`,
      type: 'note',
      title: n.title || '未命名',
      refId: n.id,
      children: [],
    })
  );

  const root: MindNode = {
    id: 'root',
    type: 'root',
    title: '我的知识',
    color: '#6366f1',
    noteCount: notes.length,
    children: [...roots, ...orphanNotes],
  };

  return c.json({ root, noteCount: notes.length, notebookCount: notebooks.length });
});
