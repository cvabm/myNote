import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  ChevronsDownUp,
  ChevronsUpDown,
  CornerUpLeft,
  ExternalLink,
  FilePlus,
  Focus,
  FolderPlus,
  Menu,
  Pencil,
  RefreshCw,
  Scan,
  Search,
  Trash2,
  X,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { api } from '../api';
import { highlightHtmlKeywords, renderMarkdown } from '../lib/markdown';
import type { MindNode, Note } from '../types';
import { handleCodeCopyClick, highlightText } from '../utils';

type Props = {
  onOpenSidebar?: () => void;
  /** 可选：在编辑器中打开（预览弹层里的按钮） */
  onOpenNote?: (noteId: string) => void;
  /**
   * 导图是否为当前前台视图。进编辑器时仍挂载但应置 false，
   * 避免拦截 Ctrl+F 等快捷键，让出浏览器原生查找。
   */
  active?: boolean;
};

type CtxMenu = {
  x: number;
  y: number;
  node: MindNode;
};

/** 修改父节点：可选目标（根或分类） */
type ParentOption = {
  /** null = 挂到导图根下（笔记无笔记本 / 分类顶级） */
  parentRefId: string | null;
  /** mind 节点 id，用于展开 */
  mindId: string;
  label: string;
  depth: number;
};

type Cam = { x: number; y: number; k: number };
type Laid = {
  id: string;
  node: MindNode;
  x: number;
  y: number;
  w: number;
  h: number;
  parentId: string | null;
  side: 1 | -1;
  depth: number;
  accent: string;
};

const MIN_K = 0.28;
const MAX_K = 2.4;
/** 点击节点聚焦时最低可读缩放，避免为塞进全图而缩得看不清 */
const MIN_READABLE_K = 0.78;
/** 聚焦局部时的缩放上限 */
const FOCUS_MAX_K = 1.2;
/** 默认缩放略小，四周留白（仅「适应全图」用） */
const FIT_SCALE = 0.62;

const NODE_H_ROOT = 36;
const NODE_H_NB = 30;
const NODE_H_NOTE = 26;
const NODE_GAP_Y = 8;
const LEVEL_GAP_X = 128;
/** 折叠 + 按钮占位，避免压住文字 */
const EXPAND_BADGE = 18;
/** 文字左右内边距（保证边框包住字） */
const TEXT_PAD_X = 14;

const PALETTE = [
  '#6366f1',
  '#0ea5e9',
  '#10b981',
  '#f59e0b',
  '#ec4899',
  '#8b5cf6',
  '#14b8a6',
  '#f97316',
  '#06b6d4',
  '#84cc16',
];

function isDark() {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

function nodeHeight(type: MindNode['type']) {
  if (type === 'root') return NODE_H_ROOT;
  if (type === 'notebook') return NODE_H_NB;
  return NODE_H_NOTE;
}

function nodeFont(type: MindNode['type']) {
  if (type === 'root') {
    return `600 14px system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  }
  if (type === 'notebook') {
    return `500 12.5px system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
  }
  return `500 11.5px system-ui, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif`;
}

/** 与绘制相同的字体测宽，保证任意层级边框包住文字 */
let _measureCtx: CanvasRenderingContext2D | null = null;
function getMeasureCtx() {
  if (_measureCtx) return _measureCtx;
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  _measureCtx = c.getContext('2d');
  return _measureCtx;
}

function measureWidth(
  title: string,
  type: MindNode['type'],
  opts?: { expandable?: boolean }
) {
  const text = title || '';
  const ctx = getMeasureCtx();
  let textW: number;
  if (ctx) {
    ctx.font = nodeFont(type);
    textW = ctx.measureText(text).width;
  } else {
    // SSR / 无 DOM 兜底
    const charW = type === 'root' ? 9 : type === 'notebook' ? 8 : 7.5;
    textW = text.length * charW;
  }
  const badge = opts?.expandable ? EXPAND_BADGE : 0;
  // 左右内边距 + 折叠按钮区 + 1px 描边余量
  const base = Math.ceil(textW + TEXT_PAD_X * 2 + badge + 4);
  if (type === 'root') return Math.max(88, base);
  if (type === 'notebook') return Math.max(72, base);
  return Math.max(56, base);
}

function parseHex(hex: string): { r: number; g: number; b: number } | null {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
}

function rgba(hex: string, a: number, fallback = '99,102,241') {
  const c = parseHex(hex);
  if (!c) return `rgba(${fallback},${a})`;
  return `rgba(${c.r},${c.g},${c.b},${a})`;
}

function mixWhite(hex: string, amount: number, dark: boolean) {
  const c = parseHex(hex) || { r: 99, g: 102, b: 241 };
  if (dark) {
    // 深色模式：色相混入深底
    const t = 0.22 + amount * 0.15;
    return `rgb(${Math.round(c.r * t + 15 * (1 - t))},${Math.round(c.g * t + 23 * (1 - t))},${Math.round(c.b * t + 42 * (1 - t))})`;
  }
  const t = amount;
  return `rgb(${Math.round(c.r + (255 - c.r) * t)},${Math.round(c.g + (255 - c.g) * t)},${Math.round(c.b + (255 - c.b) * t)})`;
}

function collectExpandable(node: MindNode, out: string[] = []): string[] {
  if (node.children.length > 0) out.push(node.id);
  for (const ch of node.children) collectExpandable(ch, out);
  return out;
}

function findPath(root: MindNode, targetId: string): MindNode[] | null {
  if (root.id === targetId) return [root];
  for (const ch of root.children) {
    const p = findPath(ch, targetId);
    if (p) return [root, ...p];
  }
  return null;
}

function focusCollapse(root: MindNode, focusId: string): Set<string> {
  const all = collectExpandable(root);
  const path = findPath(root, focusId);
  const keepOpen = new Set<string>();
  if (path) {
    for (const n of path) {
      if (n.children.length) keepOpen.add(n.id);
    }
  } else {
    keepOpen.add(root.id);
  }
  const col = new Set<string>();
  for (const id of all) {
    if (!keepOpen.has(id)) col.add(id);
  }
  if (path) {
    const target = path[path.length - 1];
    for (const ch of target.children) {
      if (ch.children.length) col.add(ch.id);
    }
  }
  return col;
}

function overviewCollapse(root: MindNode): Set<string> {
  const col = new Set<string>();
  const walk = (n: MindNode, depth: number) => {
    if (depth >= 1 && n.children.length) col.add(n.id);
    n.children.forEach((c) => walk(c, depth + 1));
  };
  walk(root, 0);
  col.delete(root.id);
  return col;
}

/** 标题关键字匹配（不区分大小写，多词空格 AND） */
function titleMatches(title: string, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return false;
  const t = (title || '').toLowerCase();
  const parts = q.split(/\s+/).filter(Boolean);
  return parts.every((p) => t.includes(p));
}

export type SearchHitItem = {
  id: string;
  title: string;
  type: 'notebook' | 'note';
  /** 面包屑路径 */
  path: string;
  /** 全文命中时的预览片段 */
  snippet?: string;
};

type TreeIndex = {
  /** note 业务 id → 导图节点 */
  notes: Map<string, { nodeId: string; title: string; path: string }>;
  notebooks: { nodeId: string; title: string; path: string }[];
};

function buildTreeIndex(root: MindNode): TreeIndex {
  const notes = new Map<string, { nodeId: string; title: string; path: string }>();
  const notebooks: { nodeId: string; title: string; path: string }[] = [];
  const walk = (n: MindNode, trail: string[]) => {
    const path = trail.filter(Boolean).join(' › ') || '我的知识';
    if (n.type === 'notebook') {
      notebooks.push({ nodeId: n.id, title: n.title, path });
    }
    if (n.type === 'note' && n.refId) {
      notes.set(n.refId, { nodeId: n.id, title: n.title, path });
    }
    const nextTrail = n.type === 'root' ? trail : [...trail, n.title];
    n.children.forEach((c) => walk(c, nextTrail));
  };
  walk(root, []);
  return { notes, notebooks };
}

/** 仅标题匹配（笔记本 + 本地笔记标题，同步） */
function collectTitleHits(root: MindNode, query: string): SearchHitItem[] {
  const hits: SearchHitItem[] = [];
  const walk = (n: MindNode, trail: string[]) => {
    const nextTrail = n.type === 'root' ? trail : [...trail, n.title];
    if (n.type !== 'root' && titleMatches(n.title, query)) {
      hits.push({
        id: n.id,
        title: n.title,
        type: n.type === 'notebook' ? 'notebook' : 'note',
        path: trail.filter(Boolean).join(' › ') || '我的知识',
      });
    }
    n.children.forEach((c) => walk(c, nextTrail));
  };
  walk(root, []);
  return hits;
}

/** 展开命中项的祖先路径，其余可折叠节点保持折叠 */
function collapsedForSearchHits(root: MindNode, hitIds: string[]): Set<string> {
  const keepOpen = new Set<string>();
  for (const id of hitIds) {
    const path = findPath(root, id);
    if (!path) continue;
    for (let i = 0; i < path.length - 1; i++) {
      if (path[i].children.length) keepOpen.add(path[i].id);
    }
    const last = path[path.length - 1];
    if (last.children.length) keepOpen.add(last.id);
  }
  if (root.children.length) keepOpen.add(root.id);

  const col = new Set(collectExpandable(root));
  for (const id of keepOpen) col.delete(id);
  return col;
}

function subtreeHeight(node: MindNode, collapsed: Set<string>): number {
  const selfH = nodeHeight(node.type);
  if (collapsed.has(node.id) || node.children.length === 0) return selfH;
  let h = 0;
  for (const ch of node.children) {
    h += subtreeHeight(ch, collapsed) + NODE_GAP_Y;
  }
  return Math.max(selfH, h - NODE_GAP_Y);
}

function layoutTree(root: MindNode, collapsed: Set<string>): Laid[] {
  const out: Laid[] = [];
  const rootExpandable = root.children.length > 0 && collapsed.has(root.id);
  const rootW = measureWidth(root.title, root.type, { expandable: rootExpandable });
  const rootAccent = root.color || '#6366f1';

  out.push({
    id: root.id,
    node: root,
    x: 0,
    y: 0,
    w: rootW,
    h: nodeHeight('root'),
    parentId: null,
    side: 1,
    depth: 0,
    accent: rootAccent,
  });

  if (collapsed.has(root.id)) return out;

  const tops = root.children;
  const mid = Math.ceil(tops.length / 2);
  const right = tops.slice(0, mid);
  const left = tops.slice(mid);

  function placeBranch(
    nodes: MindNode[],
    side: 1 | -1,
    parentX: number,
    parentW: number,
    parentId: string,
    depth: number,
    parentAccent: string,
    colorIndex: number
  ) {
    if (!nodes.length) return;
    const heights = nodes.map((n) => subtreeHeight(n, collapsed));
    const total =
      heights.reduce((a, b) => a + b, 0) + NODE_GAP_Y * Math.max(0, nodes.length - 1);
    let y = -total / 2;

    nodes.forEach((n, i) => {
      const hSub = heights[i];
      const nh = nodeHeight(n.type);
      const cy = y + hSub / 2;
      const expandable = n.children.length > 0 && collapsed.has(n.id);
      const w = measureWidth(n.title, n.type, { expandable });
      const x = parentX + side * (parentW / 2 + LEVEL_GAP_X + w / 2);
      const accent =
        n.type === 'notebook'
          ? n.color || PALETTE[(colorIndex + i) % PALETTE.length]
          : parentAccent;

      out.push({
        id: n.id,
        node: n,
        x,
        y: cy,
        w,
        h: nh,
        parentId,
        side,
        depth,
        accent,
      });

      if (!collapsed.has(n.id) && n.children.length) {
        placeBranch(n.children, side, x, w, n.id, depth + 1, accent, colorIndex + i + 1);
      }
      y += hSub + NODE_GAP_Y;
    });
  }

  placeBranch(right, 1, 0, rootW, root.id, 1, rootAccent, 0);
  placeBranch(left, -1, 0, rootW, root.id, 1, rootAccent, mid);
  return out;
}

function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
) {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}

function clearShadow(ctx: CanvasRenderingContext2D) {
  ctx.shadowColor = 'transparent';
  ctx.shadowBlur = 0;
  ctx.shadowOffsetX = 0;
  ctx.shadowOffsetY = 0;
}

export function MindMap({ onOpenSidebar, onOpenNote, active = true }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const [root, setRoot] = useState<MindNode | null>(null);
  const [meta, setMeta] = useState({ noteCount: 0, notebookCount: 0 });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [focusMode, setFocusMode] = useState(true);
  const [cam, setCam] = useState<Cam>({ x: 0, y: 0, k: 0.6 });
  const camRef = useRef(cam);
  camRef.current = cam;
  const [hoverId, setHoverId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [status, setStatus] = useState('');
  /** 关键字搜索：标题本地 + 正文 FTS（防抖） */
  const [searchQ, setSearchQ] = useState('');
  const [searchFocused, setSearchFocused] = useState(false);
  const [searchResults, setSearchResults] = useState<SearchHitItem[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [activeHitId, setActiveHitId] = useState<string | null>(null);
  const [listHi, setListHi] = useState(0);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchBoxRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 叶子笔记：浮层预览，不跳转编辑器 */
  const [preview, setPreview] = useState<Note | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  /** 预览正文高亮用的关键字（来自当前搜索） */
  const [previewHighlightQ, setPreviewHighlightQ] = useState('');
  const previewSeq = useRef(0);
  const dragRef = useRef<{
    lastX: number;
    lastY: number;
    moved: boolean;
    /** 按下时的节点，用于松开时判定为同一次点击 */
    hitId: string | null;
    detail: number;
    /** 长按已弹出菜单，抬起时不再当点击 */
    longPress: boolean;
    clientX: number;
    clientY: number;
  } | null>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 双指缩放 */
  const pinchRef = useRef<{ dist: number; k: number } | null>(null);
  const sizeRef = useRef({ w: 1, h: 1, dpr: 1 });
  const laidRef = useRef<Laid[]>([]);
  const rafRef = useRef(0);
  /** 布局完成后：fit=适应全图；focus=只对准某节点及其可见子树（保持可读） */
  const viewIntentRef = useRef<'fit' | { focus: string } | null>(null);

  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);

  const clearLongPress = useCallback(() => {
    if (longPressTimer.current) {
      clearTimeout(longPressTimer.current);
      longPressTimer.current = null;
    }
  }, []);

  const openCtxAt = useCallback((clientX: number, clientY: number, node: MindNode) => {
    setSelectedId(node.id);
    const mw = 200;
    const mh = 260;
    let x = clientX;
    let y = clientY;
    if (x + mw > window.innerWidth - 8) x = Math.max(8, window.innerWidth - mw - 8);
    if (y + mh > window.innerHeight - 8) y = Math.max(8, window.innerHeight - mh - 8);
    setCtxMenu({ x, y, node });
  }, []);

  const openPreview = useCallback(
    async (noteId: string, titleHint?: string, highlightQ?: string) => {
      const seq = ++previewSeq.current;
      setPreviewLoading(true);
      setPreviewError(null);
      setPreviewHighlightQ((highlightQ ?? '').trim());
      setPreview((prev) =>
        prev?.id === noteId
          ? prev
          : ({
              id: noteId,
              title: titleHint || '加载中…',
              content: '',
              contentHtml: '',
              notebookId: null,
              deletedAt: null,
              sortOrder: 0,
              createdAt: '',
              updatedAt: '',
            } as Note)
      );
      try {
        const note = await api.getNote(noteId);
        if (seq !== previewSeq.current) return;
        setPreview(note);
        setStatus(note.title);
      } catch (e) {
        if (seq !== previewSeq.current) return;
        setPreviewError(e instanceof Error ? e.message : '加载失败');
      } finally {
        if (seq === previewSeq.current) setPreviewLoading(false);
      }
    },
    []
  );

  const closePreview = useCallback(() => {
    previewSeq.current += 1;
    setPreview(null);
    setPreviewError(null);
    setPreviewLoading(false);
    setPreviewHighlightQ('');
  }, []);

  useEffect(() => {
    if (!preview) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closePreview();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [preview, closePreview]);

  /** Ctrl/Cmd + F → 聚焦思维导图搜索（拦截浏览器默认查找）；编辑器前台时不拦截 */
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      // 预览层内可先 Esc；仍允许 Ctrl+F 跳到搜索
      e.preventDefault();
      e.stopPropagation();
      setSearchFocused(true);
      const input = searchInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [active]);

  const previewHtml = useMemo(() => {
    if (!preview?.content) return '';
    const html = renderMarkdown(preview.content);
    return previewHighlightQ
      ? highlightHtmlKeywords(html, previewHighlightQ)
      : html;
  }, [preview?.content, previewHighlightQ]);

  const load = useCallback(async (opts?: { keepView?: boolean }) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getMindmap();
      setRoot(data.root);
      setMeta({ noteCount: data.noteCount, notebookCount: data.notebookCount });
      if (!opts?.keepView) {
        setCollapsed(overviewCollapse(data.root));
        setSelectedId(data.root.id);
        setStatus('右键节点可编辑 · 点笔记预览');
        viewIntentRef.current = 'fit';
      } else {
        // 清理已不存在的折叠 id；保留当前相机，不强制全图适应
        setCollapsed((prev) => {
          const alive = new Set<string>();
          const walk = (n: MindNode) => {
            alive.add(n.id);
            n.children.forEach(walk);
          };
          walk(data.root);
          const next = new Set<string>();
          for (const id of prev) if (alive.has(id)) next.add(id);
          return next;
        });
        viewIntentRef.current = null;
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const closeCtx = useCallback(() => setCtxMenu(null), []);

  useEffect(() => {
    if (!ctxMenu) return;
    const onDoc = () => closeCtx();
    window.addEventListener('click', onDoc);
    window.addEventListener('scroll', onDoc, true);
    return () => {
      window.removeEventListener('click', onDoc);
      window.removeEventListener('scroll', onDoc, true);
    };
  }, [ctxMenu, closeCtx]);

  /** 重命名：分类=笔记本名，笔记=标题 */
  const renameNode = useCallback(
    async (node: MindNode) => {
      closeCtx();
      if (node.type === 'root') return;
      const next = window.prompt('重命名', node.title);
      if (next == null) return;
      const name = next.trim();
      if (!name || name === node.title) return;
      try {
        if (node.type === 'notebook' && node.refId) {
          await api.updateNotebook(node.refId, { name });
        } else if (node.type === 'note' && node.refId) {
          await api.updateNote(node.refId, { title: name });
        }
        setStatus(`已重命名：${name}`);
        await load({ keepView: true });
        setSelectedId(node.id);
      } catch (e) {
        alert(e instanceof Error ? e.message : '重命名失败');
      }
    },
    [closeCtx, load]
  );

  /** 在分类/根下新建笔记 */
  const addNoteUnder = useCallback(
    async (parent: MindNode) => {
      closeCtx();
      const title = window.prompt('笔记标题', '未命名笔记');
      if (title == null) return;
      const name = title.trim() || '未命名笔记';
      const notebookId =
        parent.type === 'notebook' && parent.refId
          ? parent.refId
          : parent.type === 'root'
            ? null
            : null;
      // 笔记节点下不能挂笔记，挂到其父分类需调用方保证
      if (parent.type === 'note') return;
      try {
        const note = await api.createNote({
          title: name,
          content: '',
          notebookId,
        });
        setStatus(`已新建笔记：${name}`);
        // 展开父节点
        if (parent.type === 'notebook' || parent.type === 'root') {
          setCollapsed((prev) => {
            const next = new Set(prev);
            next.delete(parent.id);
            return next;
          });
        }
        await load({ keepView: true });
        setSelectedId(`note:${note.id}`);
        if (onOpenNote) {
          // 可选：直接进编辑
        }
      } catch (e) {
        alert(e instanceof Error ? e.message : '新建失败');
      }
    },
    [closeCtx, load, onOpenNote]
  );

  /** 在分类/根下新建子分类（内部仍是 notebook，界面称「分类」） */
  const addCategoryUnder = useCallback(
    async (parent: MindNode) => {
      closeCtx();
      if (parent.type === 'note') return;
      const title = window.prompt('分类名称', '新分类');
      if (title == null) return;
      const name = title.trim() || '新分类';
      const parentId =
        parent.type === 'notebook' && parent.refId ? parent.refId : null;
      try {
        const color = PALETTE[Math.floor(Math.random() * PALETTE.length)];
        const nb = await api.createNotebook({ name, parentId, color });
        setStatus(`已新建分类：${name}`);
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(parent.id);
          return next;
        });
        await load({ keepView: true });
        setSelectedId(`nb:${nb.id}`);
      } catch (e) {
        alert(e instanceof Error ? e.message : '新建分类失败');
      }
    },
    [closeCtx, load]
  );

  const deleteNode = useCallback(
    async (node: MindNode) => {
      closeCtx();
      if (node.type === 'root') return;
      if (node.type === 'note' && node.refId) {
        if (!window.confirm(`将笔记「${node.title}」移入回收站？`)) return;
        try {
          await api.trashNote(node.refId);
          setStatus(`已删除：${node.title}`);
          setSelectedId(null);
          closePreview();
          await load({ keepView: true });
        } catch (e) {
          alert(e instanceof Error ? e.message : '删除失败');
        }
        return;
      }
      if (node.type === 'notebook' && node.refId) {
        if (
          !window.confirm(
            `删除分类「${node.title}」？\n其中的笔记会进入回收站，子分类也会一并删除。`
          )
        ) {
          return;
        }
        try {
          await api.deleteNotebook(node.refId);
          setStatus(`已删除分类：${node.title}`);
          setSelectedId(null);
          await load({ keepView: true });
        } catch (e) {
          alert(e instanceof Error ? e.message : '删除失败');
        }
      }
    },
    [closeCtx, closePreview, load]
  );

  /** 修改父节点面板 */
  const [moveNodeTarget, setMoveNodeTarget] = useState<MindNode | null>(null);
  const [moveFilter, setMoveFilter] = useState('');
  const [moving, setMoving] = useState(false);

  const openMoveParent = useCallback(
    (node: MindNode) => {
      closeCtx();
      if (node.type === 'root' || !node.refId) return;
      setMoveFilter('');
      setMoveNodeTarget(node);
    },
    [closeCtx]
  );

  const closeMoveParent = useCallback(() => {
    if (moving) return;
    setMoveNodeTarget(null);
    setMoveFilter('');
  }, [moving]);

  /** 收集可作为父节点的选项；分类移动时排除自身及子树 */
  const parentOptions = useMemo((): ParentOption[] => {
    if (!root || !moveNodeTarget) return [];
    const forbid = new Set<string>();
    if (moveNodeTarget.type === 'notebook') {
      const mark = (n: MindNode) => {
        forbid.add(n.id);
        n.children.forEach(mark);
      };
      mark(moveNodeTarget);
    }

    const out: ParentOption[] = [
      {
        parentRefId: null,
        mindId: 'root',
        label: '（根节点 / 无上级分类）',
        depth: 0,
      },
    ];

    const walk = (n: MindNode, path: string[], depth: number) => {
      if (n.type === 'notebook' && n.refId) {
        if (!forbid.has(n.id)) {
          out.push({
            parentRefId: n.refId,
            mindId: n.id,
            label: [...path, n.title].join(' / '),
            depth,
          });
        }
        for (const c of n.children) {
          if (c.type === 'notebook') walk(c, [...path, n.title], depth + 1);
        }
      } else if (n.type === 'root') {
        for (const c of n.children) {
          if (c.type === 'notebook') walk(c, [], 1);
        }
      }
    };
    walk(root, [], 0);

    // 笔记不能选「自己当前父」也可列出来方便确认；不特殊过滤
    const q = moveFilter.trim().toLowerCase();
    if (!q) return out;
    return out.filter((o) => o.label.toLowerCase().includes(q));
  }, [root, moveNodeTarget, moveFilter]);

  /** 当前父节点 ref，用于高亮「当前」 */
  const currentParentRefId = useMemo((): string | null | undefined => {
    if (!root || !moveNodeTarget) return undefined;
    let found: MindNode | null = null;
    const walk = (n: MindNode, parent: MindNode | null) => {
      if (n.id === moveNodeTarget.id) {
        found = parent;
        return true;
      }
      for (const c of n.children) {
        if (walk(c, n)) return true;
      }
      return false;
    };
    walk(root, null);
    if (!found) return null;
    const p = found as MindNode;
    if (p.type === 'root') return null;
    if (p.type === 'notebook') return p.refId ?? null;
    return null;
  }, [root, moveNodeTarget]);

  const confirmMoveParent = useCallback(
    async (opt: ParentOption) => {
      if (!moveNodeTarget?.refId) return;
      // 未变化
      if (opt.parentRefId === currentParentRefId) {
        setStatus('父节点未变化');
        setMoveNodeTarget(null);
        return;
      }
      setMoving(true);
      try {
        if (moveNodeTarget.type === 'notebook') {
          await api.updateNotebook(moveNodeTarget.refId, {
            parentId: opt.parentRefId,
          });
        } else if (moveNodeTarget.type === 'note') {
          await api.updateNote(moveNodeTarget.refId, {
            notebookId: opt.parentRefId,
          });
        } else {
          return;
        }
        const nodeId = moveNodeTarget.id;
        const title = moveNodeTarget.title;
        setStatus(`已移动「${title}」→ ${opt.label}`);
        setMoveNodeTarget(null);
        setMoveFilter('');
        // 展开新父，并在布局后聚焦
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(opt.mindId);
          return next;
        });
        viewIntentRef.current = { focus: nodeId };
        await load({ keepView: true });
        setSelectedId(nodeId);
        // load(keepView) 会清空 viewIntent，布局后再聚焦一次
        requestAnimationFrame(() => {
          requestAnimationFrame(() => {
            viewIntentRef.current = { focus: nodeId };
            // 若 laid 未再变，直接对准
            const item = laidRef.current.find((i) => i.id === nodeId);
            if (item) {
              setCam((c) => ({
                ...c,
                x: item.x,
                y: item.y,
                k: Math.max(c.k, MIN_READABLE_K),
              }));
            }
          });
        });
      } catch (e) {
        alert(e instanceof Error ? e.message : '移动失败');
      } finally {
        setMoving(false);
      }
    },
    [moveNodeTarget, currentParentRefId, load]
  );

  // F2 重命名 / Delete 删除
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) {
        return;
      }
      if (moveNodeTarget) {
        if (e.key === 'Escape') {
          e.preventDefault();
          closeMoveParent();
        }
        return;
      }
      if (!selectedId || !root) return;
      const find = (n: MindNode): MindNode | null => {
        if (n.id === selectedId) return n;
        for (const c of n.children) {
          const f = find(c);
          if (f) return f;
        }
        return null;
      };
      const node = find(root);
      if (!node || node.type === 'root') return;
      if (e.key === 'F2') {
        e.preventDefault();
        void renameNode(node);
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        // Backspace 易误触，仅 Delete
        if (e.key === 'Backspace') return;
        e.preventDefault();
        void deleteNode(node);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [selectedId, root, renameNode, deleteNode, moveNodeTarget, closeMoveParent]);

  const laid = useMemo(() => {
    if (!root) return [] as Laid[];
    return layoutTree(root, collapsed);
  }, [root, collapsed]);
  laidRef.current = laid;

  const treeIndex = useMemo(() => (root ? buildTreeIndex(root) : null), [root]);

  const hitSet = useMemo(() => new Set(searchResults.map((h) => h.id)), [searchResults]);

  /** 全文 + 标题：防抖请求 FTS，合并笔记本标题命中 */
  useEffect(() => {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const q = searchQ.trim();
    if (!q || !root || !treeIndex) {
      setSearchResults([]);
      setSearchLoading(false);
      setActiveHitId(null);
      setListHi(0);
      if (!q) setStatus('');
      return;
    }

    setSearchLoading(true);
    // 标题命中立刻显示（笔记本 + 标题匹配的笔记）
    const titleHits = collectTitleHits(root, q);
    setSearchResults(titleHits);
    setListHi(0);

    const seq = ++searchSeq.current;
    searchTimer.current = setTimeout(() => {
      void (async () => {
        try {
          const page = await api.listNotes({ q, limit: 100, offset: 0 });
          if (seq !== searchSeq.current) return;

          const byId = new Map<string, SearchHitItem>();
          for (const h of collectTitleHits(root, q)) {
            byId.set(h.id, h);
          }
          for (const note of page.items) {
            const nodeId = `note:${note.id}`;
            const meta = treeIndex.notes.get(note.id);
            const existing = byId.get(nodeId);
            const snippet = note.preview?.trim() || undefined;
            byId.set(nodeId, {
              id: nodeId,
              title: note.title || meta?.title || '未命名',
              type: 'note',
              path: meta?.path || '我的知识',
              snippet: snippet && snippet !== note.title ? snippet : existing?.snippet,
            });
          }

          // 笔记本仅标题；笔记：标题命中优先，再按接口顺序（相关度）
          const notebooks = [...byId.values()].filter((h) => h.type === 'notebook');
          const notesOrdered: SearchHitItem[] = [];
          const seen = new Set<string>();
          for (const note of page.items) {
            const id = `note:${note.id}`;
            const h = byId.get(id);
            if (h) {
              notesOrdered.push(h);
              seen.add(id);
            }
          }
          for (const h of byId.values()) {
            if (h.type === 'note' && !seen.has(h.id)) notesOrdered.push(h);
          }

          const merged = [...notebooks, ...notesOrdered];
          setSearchResults(merged);
          setStatus(
            merged.length ? `${merged.length} 条（标题+全文）· 点击定位` : `未找到「${q}」`
          );
        } catch (e) {
          if (seq !== searchSeq.current) return;
          // FTS 失败时至少保留标题结果
          setStatus(e instanceof Error ? e.message : '全文搜索失败');
        } finally {
          if (seq === searchSeq.current) setSearchLoading(false);
        }
      })();
    }, 220);

    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, [searchQ, root, treeIndex]);

  const centerOnNode = useCallback((nodeId: string) => {
    const item = laidRef.current.find((i) => i.id === nodeId);
    if (!item) return;
    setCam((c) => ({
      ...c,
      x: item.x,
      y: item.y,
      k: Math.max(c.k, MIN_READABLE_K),
    }));
    setSelectedId(nodeId);
  }, []);

  /**
   * 对准某节点及其当前可见子孙：
   * 只框选局部，缩放不低于可读下限——不把整张导图塞进屏幕。
   */
  const focusNodeRegion = useCallback(
    (nodeId: string) => {
      const items = laidRef.current;
      if (!items.length) return;

      const inSubtree = new Set<string>();
      const collect = (id: string) => {
        inSubtree.add(id);
        for (const it of items) {
          if (it.parentId === id) collect(it.id);
        }
      };
      collect(nodeId);

      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (const i of items) {
        if (!inSubtree.has(i.id)) continue;
        minX = Math.min(minX, i.x - i.w / 2);
        maxX = Math.max(maxX, i.x + i.w / 2);
        minY = Math.min(minY, i.y - i.h / 2);
        maxY = Math.max(maxY, i.y + i.h / 2);
      }

      if (!Number.isFinite(minX)) {
        centerOnNode(nodeId);
        return;
      }

      const pad = 88;
      const bw = Math.max(maxX - minX, 60) + pad * 2;
      const bh = Math.max(maxY - minY, 48) + pad * 2;
      const { w, h } = sizeRef.current;
      const fitK = Math.min(w / bw, h / bh) * 0.9;
      // 局部框选：可读优先；分支很大时也不掉到全图那种过小比例
      const k = Math.min(FOCUS_MAX_K, Math.max(MIN_READABLE_K, Math.min(MAX_K, fitK)));
      setCam({
        x: (minX + maxX) / 2,
        y: (minY + maxY) / 2,
        k,
      });
      setSelectedId(nodeId);
    },
    [centerOnNode]
  );

  /** 点击列表某条：展开路径并定位；笔记可顺带打开预览 */
  const locateHit = useCallback(
    (nodeId: string) => {
      if (!root) return;
      const item = searchResults.find((h) => h.id === nodeId);
      setActiveHitId(nodeId);
      setCollapsed(collapsedForSearchHits(root, [nodeId]));
      // 等布局后再局部聚焦，避免先 fit 全图
      viewIntentRef.current = { focus: nodeId };
      setStatus(item ? `定位：${item.title}` : '已定位');
      setSearchFocused(false);
      searchInputRef.current?.blur();
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          // 笔记：定位后打开内容浮层，并高亮当前搜索关键字
          if (item?.type === 'note') {
            const refId = nodeId.startsWith('note:') ? nodeId.slice(5) : item.id;
            void openPreview(refId, item.title, searchQ);
          }
        });
      });
    },
    [root, searchResults, openPreview, searchQ]
  );

  const clearSearch = useCallback(() => {
    searchSeq.current += 1;
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchQ('');
    setSearchResults([]);
    setSearchLoading(false);
    setActiveHitId(null);
    setListHi(0);
    setStatus('');
    setSearchFocused(false);
  }, []);

  const showSearchList = searchFocused && !!searchQ.trim();
  const [listPos, setListPos] = useState({ top: 0, left: 0, width: 280 });

  // 下拉用 fixed 挂到 body，避免被顶栏 overflow / 画布盖住
  useLayoutEffect(() => {
    if (!showSearchList) return;
    const update = () => {
      const el = searchBoxRef.current;
      if (!el) return;
      const r = el.getBoundingClientRect();
      const width = Math.min(Math.max(r.width, 280), window.innerWidth - 16);
      let left = r.left;
      if (left + width > window.innerWidth - 8) left = Math.max(8, window.innerWidth - 8 - width);
      setListPos({ top: r.bottom + 4, left, width });
    };
    update();
    window.addEventListener('resize', update);
    window.addEventListener('scroll', update, true);
    return () => {
      window.removeEventListener('resize', update);
      window.removeEventListener('scroll', update, true);
    };
  }, [showSearchList, searchQ, searchResults.length]);

  // 点击搜索框 / 下拉外部关闭列表
  useEffect(() => {
    if (!searchFocused) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      const box = searchBoxRef.current;
      const panel = document.getElementById('mindmap-search-dropdown');
      if (box?.contains(t) || panel?.contains(t)) return;
      setSearchFocused(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [searchFocused]);

  const fitView = useCallback(() => {
    const items = laidRef.current;
    if (!items.length) {
      setCam({ x: 0, y: 0, k: 0.6 });
      return;
    }
    let minX = Infinity,
      minY = Infinity,
      maxX = -Infinity,
      maxY = -Infinity;
    for (const i of items) {
      minX = Math.min(minX, i.x - i.w / 2);
      maxX = Math.max(maxX, i.x + i.w / 2);
      minY = Math.min(minY, i.y - i.h / 2);
      maxY = Math.max(maxY, i.y + i.h / 2);
    }
    const pad = 72;
    const bw = Math.max(maxX - minX, 100) + pad * 2;
    const bh = Math.max(maxY - minY, 80) + pad * 2;
    const { w, h } = sizeRef.current;
    const k = Math.min(MAX_K, Math.max(MIN_K, Math.min(w / bw, h / bh) * FIT_SCALE));
    setCam({ x: (minX + maxX) / 2, y: (minY + maxY) / 2, k });
  }, []);

  useEffect(() => {
    if (!laid.length) return;
    const intent = viewIntentRef.current;
    if (!intent) return;
    viewIntentRef.current = null;
    requestAnimationFrame(() => {
      if (intent === 'fit') fitView();
      else focusNodeRegion(intent.focus);
    });
  }, [laid, fitView, focusNodeRegion]);

  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      const rect = el.getBoundingClientRect();
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      sizeRef.current = { w: rect.width, h: rect.height, dpr };
      const c = canvasRef.current;
      if (c) {
        c.width = Math.max(1, Math.floor(rect.width * dpr));
        c.height = Math.max(1, Math.floor(rect.height * dpr));
        c.style.width = `${rect.width}px`;
        c.style.height = `${rect.height}px`;
      }
      scheduleDraw();
    });
    ro.observe(el);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const { w, h, dpr } = sizeRef.current;
    const { x: cx, y: cy, k } = camRef.current;
    const dark = isDark();
    const items = laidRef.current;
    const byId = new Map(items.map((i) => [i.id, i]));

    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    // 柔和渐变底
    const bg = ctx.createLinearGradient(0, 0, w, h);
    if (dark) {
      bg.addColorStop(0, '#0f172a');
      bg.addColorStop(0.5, '#111827');
      bg.addColorStop(1, '#1e1b4b');
    } else {
      bg.addColorStop(0, '#f0f9ff');
      bg.addColorStop(0.45, '#f8fafc');
      bg.addColorStop(1, '#eef2ff');
    }
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, w, h);

    // 轻点纹理
    ctx.fillStyle = dark ? 'rgba(255,255,255,0.02)' : 'rgba(99,102,241,0.03)';
    for (let i = 0; i < 40; i++) {
      const px = ((i * 97) % w) + (i % 7) * 3;
      const py = ((i * 53) % h) + (i % 5) * 5;
      ctx.beginPath();
      ctx.arc(px, py, 1.2, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.save();
    ctx.translate(w / 2, h / 2);
    ctx.scale(k, k);
    ctx.translate(-cx, -cy);

    // 连线：与父节点同色、带透明度
    for (const item of items) {
      if (!item.parentId) continue;
      const p = byId.get(item.parentId);
      if (!p) continue;
      const x1 = p.x + item.side * (p.w / 2 - 2);
      const y1 = p.y;
      const x2 = item.x - item.side * (item.w / 2 - 2);
      const y2 = item.y;
      const mx = (x1 + x2) / 2;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.bezierCurveTo(mx, y1, mx, y2, x2, y2);
      ctx.strokeStyle = rgba(item.accent, dark ? 0.45 : 0.4);
      ctx.lineWidth = (item.node.type === 'note' ? 1.6 : 2.2) / k;
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    // 节点
    for (const item of items) {
      const { node, x, y, w: nw, h: nh, accent } = item;
      const left = x - nw / 2;
      const top = y - nh / 2;
      const sel = selectedId === item.id;
      const hov = hoverId === item.id;
      const isHit = hitSet.has(item.id);
      const isActiveHit = activeHitId === item.id;
      const collapsedBranch = collapsed.has(item.id) && node.children.length > 0;
      const r = node.type === 'root' ? nh / 2 : node.type === 'notebook' ? 10 : 8;

      const useShadow = node.type === 'root' || node.type === 'notebook' || hov || sel;
      if (useShadow) {
        ctx.shadowColor = rgba(accent, dark ? 0.35 : 0.2);
        ctx.shadowBlur = (node.type === 'root' ? 16 : 10) / k;
        ctx.shadowOffsetY = 2.5 / k;
      }

      if (node.type === 'root') {
        roundRectPath(ctx, left, top, nw, nh, r);
        const g = ctx.createLinearGradient(left, top, left + nw, top + nh);
        g.addColorStop(0, '#6366f1');
        g.addColorStop(1, '#8b5cf6');
        ctx.fillStyle = g;
        ctx.fill();
        clearShadow(ctx);
        ctx.strokeStyle = 'rgba(255,255,255,0.28)';
        ctx.lineWidth = 1.2 / k;
        ctx.stroke();
      } else if (node.type === 'notebook') {
        roundRectPath(ctx, left, top, nw, nh, r);
        ctx.fillStyle = mixWhite(accent, dark ? 0.15 : 0.88, dark);
        ctx.fill();
        clearShadow(ctx);
        ctx.strokeStyle = rgba(accent, dark ? 0.55 : 0.35);
        ctx.lineWidth = 1.4 / k;
        ctx.stroke();
      } else {
        roundRectPath(ctx, left, top, nw, nh, r);
        ctx.fillStyle = dark
          ? hov || sel
            ? 'rgba(30,41,59,0.95)'
            : 'rgba(15,23,42,0.75)'
          : hov || sel
            ? '#ffffff'
            : 'rgba(255,255,255,0.92)';
        ctx.fill();
        clearShadow(ctx);
        ctx.strokeStyle = rgba(accent, dark ? 0.35 : 0.28);
        ctx.lineWidth = 1.1 / k;
        ctx.stroke();
      }
      clearShadow(ctx);

      // 搜索命中高亮（当前条更亮）
      if (isActiveHit) {
        roundRectPath(ctx, left - 3, top - 3, nw + 6, nh + 6, r + 3);
        ctx.strokeStyle = dark ? '#fbbf24' : '#f59e0b';
        ctx.lineWidth = 2.4 / k;
        ctx.stroke();
        roundRectPath(ctx, left, top, nw, nh, r);
        ctx.fillStyle = dark ? 'rgba(251,191,36,0.18)' : 'rgba(251,191,36,0.22)';
        ctx.fill();
      } else if (isHit) {
        roundRectPath(ctx, left - 2, top - 2, nw + 4, nh + 4, r + 2);
        ctx.strokeStyle = dark ? 'rgba(251,191,36,0.65)' : 'rgba(245,158,11,0.7)';
        ctx.lineWidth = 1.8 / k;
        ctx.stroke();
      } else if (sel) {
        roundRectPath(ctx, left - 2, top - 2, nw + 4, nh + 4, r + 2);
        ctx.strokeStyle = rgba(accent, 0.9);
        ctx.lineWidth = 2 / k;
        ctx.stroke();
      } else if (hov) {
        roundRectPath(ctx, left - 1, top - 1, nw + 2, nh + 2, r + 1);
        ctx.strokeStyle = rgba(accent, 0.55);
        ctx.lineWidth = 1.5 / k;
        ctx.stroke();
      }

      // 文案：与测宽同一字体；折叠时在「左区」居中，保证不溢出边框
      const label = node.title || '';
      ctx.font = nodeFont(node.type);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';

      if (node.type === 'root') {
        ctx.fillStyle = '#ffffff';
      } else if (node.type === 'notebook') {
        ctx.fillStyle = dark ? '#e2e8f0' : '#1e293b';
      } else {
        ctx.fillStyle = dark ? '#cbd5e1' : '#334155';
      }
      // 折叠时文字在左侧区域居中；否则节点几何中心（宽度已按 measureText 包住）
      const textCx = collapsedBranch ? left + (nw - EXPAND_BADGE) / 2 : x;
      ctx.fillText(label, textCx, y + 0.5);

      // 折叠 +：贴右侧，与文字分区（宽度已含 EXPAND_BADGE）
      if (collapsedBranch) {
        const bx = left + nw - EXPAND_BADGE / 2 - 1;
        ctx.beginPath();
        ctx.arc(bx, y, 5, 0, Math.PI * 2);
        ctx.fillStyle = accent;
        ctx.fill();
        ctx.fillStyle = '#fff';
        ctx.font = `bold 10px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('+', bx, y + 0.5);
      }
    }

    ctx.restore();
  }, [collapsed, hoverId, selectedId, hitSet, activeHitId]);

  const scheduleDraw = useCallback(() => {
    if (rafRef.current) cancelAnimationFrame(rafRef.current);
    rafRef.current = requestAnimationFrame(() => draw());
  }, [draw]);

  useEffect(() => {
    scheduleDraw();
  }, [laid, cam, hoverId, selectedId, collapsed, scheduleDraw]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  function zoomBy(factor: number, sx?: number, sy?: number) {
    const { w, h } = sizeRef.current;
    const px = sx ?? w / 2;
    const py = sy ?? h / 2;
    const prev = camRef.current;
    const nextK = Math.min(MAX_K, Math.max(MIN_K, prev.k * factor));
    const wx = (px - w / 2) / prev.k + prev.x;
    const wy = (py - h / 2) / prev.k + prev.y;
    setCam({
      x: wx - (px - w / 2) / nextK,
      y: wy - (py - h / 2) / nextK,
      k: nextK,
    });
  }

  function screenToWorld(sx: number, sy: number) {
    const { w, h } = sizeRef.current;
    const { x, y, k } = camRef.current;
    return { x: (sx - w / 2) / k + x, y: (sy - h / 2) / k + y };
  }

  function hitTest(sx: number, sy: number): Laid | null {
    const p = screenToWorld(sx, sy);
    for (let i = laidRef.current.length - 1; i >= 0; i--) {
      const it = laidRef.current[i];
      if (
        p.x >= it.x - it.w / 2 &&
        p.x <= it.x + it.w / 2 &&
        p.y >= it.y - it.h / 2 &&
        p.y <= it.y + it.h / 2
      ) {
        return it;
      }
    }
    return null;
  }

  /** 展开/收起：已展开再点则收起；折叠时再点则展开（聚焦模式会收起其它支） */
  function toggleExpand(nodeId: string) {
    if (!root) return;
    const currentlyCollapsed = collapsed.has(nodeId);
    if (currentlyCollapsed) {
      // 展开
      if (focusMode) {
        setCollapsed(focusCollapse(root, nodeId));
      } else {
        setCollapsed((prev) => {
          const next = new Set(prev);
          next.delete(nodeId);
          return next;
        });
      }
    } else {
      // 已展开 → 收起本节点
      setCollapsed((prev) => {
        const next = new Set(prev);
        next.add(nodeId);
        return next;
      });
    }
    // 只对准该节点局部，不强制全图缩小
    viewIntentRef.current = { focus: nodeId };
  }

  function expandAll() {
    setCollapsed(new Set());
    viewIntentRef.current = 'fit';
    setStatus('已展开全部');
  }

  function collapseToOverview() {
    if (!root) return;
    setCollapsed(overviewCollapse(root));
    setSelectedId(root.id);
    viewIntentRef.current = 'fit';
    setStatus('概览模式');
  }

  const onPointerDown = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    // 右键留给 contextmenu
    if (e.button === 2) return;
    setCtxMenu(null);
    clearLongPress();
    canvas.setPointerCapture(e.pointerId);
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;
    const hit = hitTest(sx, sy);
    // 按下只记录拖拽；点击行为统一在 pointerup（与预览一致）
    dragRef.current = {
      lastX: e.clientX,
      lastY: e.clientY,
      moved: false,
      hitId: hit?.id ?? null,
      detail: e.detail,
      longPress: false,
      clientX: e.clientX,
      clientY: e.clientY,
    };
    if (hit) setSelectedId(hit.id);
    else setSelectedId(null);

    // 手机：长按节点 ≈ 右键菜单（约 480ms）
    if (hit && e.pointerType !== 'mouse') {
      const node = hit.node;
      const cx = e.clientX;
      const cy = e.clientY;
      longPressTimer.current = setTimeout(() => {
        if (!dragRef.current || dragRef.current.moved) return;
        dragRef.current.longPress = true;
        // 轻微震动（支持则）
        try {
          navigator.vibrate?.(12);
        } catch {
          /* ignore */
        }
        openCtxAt(cx, cy, node);
        setStatus('长按菜单');
      }, 480);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const sx = e.clientX - rect.left;
    const sy = e.clientY - rect.top;

    // 触摸/笔：有 dragRef 即允许拖；鼠标仍看 buttons
    const dragging =
      !!dragRef.current &&
      (e.pointerType !== 'mouse' || (e.buttons & 1) !== 0);

    if (dragging && dragRef.current) {
      const dx = e.clientX - dragRef.current.lastX;
      const dy = e.clientY - dragRef.current.lastY;
      if (Math.hypot(dx, dy) > 8) {
        dragRef.current.moved = true;
        clearLongPress();
      }
      if (dragRef.current.moved && !dragRef.current.longPress) {
        dragRef.current.lastX = e.clientX;
        dragRef.current.lastY = e.clientY;
        const kk = camRef.current.k;
        setCam((c) => ({ ...c, x: c.x - dx / kk, y: c.y - dy / kk }));
        canvas.style.cursor = 'grabbing';
        return;
      }
    }

    const hit = hitTest(sx, sy);
    setHoverId(hit?.id ?? null);
    canvas.style.cursor = hit ? 'pointer' : 'grab';
  };

  const onPointerUp = (e: React.PointerEvent) => {
    clearLongPress();
    const drag = dragRef.current;
    dragRef.current = null;
    // 拖过画布 / 长按菜单 → 不当点击
    if (!drag || drag.moved || drag.longPress) return;
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    // 松开时仍点在同一节点上（避免拖出后误触）
    if (!hit || (drag.hitId && hit.id !== drag.hitId)) return;

    const n = hit.node;

    // 叶子：浮层预览
    if (n.type === 'note' && n.refId) {
      void openPreview(n.refId, n.title);
      return;
    }

    // 可展开节点：再点收起 / 折叠时展开
    if (n.children.length > 0) {
      toggleExpand(n.id);
      setStatus(n.title);
    }
  };

  const onWheel = (e: React.WheelEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    zoomBy(e.deltaY > 0 ? 0.9 : 1.12, e.clientX - rect.left, e.clientY - rect.top);
  };

  /** 双指捏合缩放（手机） */
  const onTouchStart = (e: React.TouchEvent) => {
    if (e.touches.length === 2) {
      clearLongPress();
      if (dragRef.current) dragRef.current.moved = true;
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      pinchRef.current = { dist, k: camRef.current.k };
    }
  };

  const onTouchMove = (e: React.TouchEvent) => {
    if (e.touches.length === 2 && pinchRef.current) {
      e.preventDefault();
      const [a, b] = [e.touches[0], e.touches[1]];
      const dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
      const ratio = dist / Math.max(pinchRef.current.dist, 1);
      const nextK = Math.min(MAX_K, Math.max(MIN_K, pinchRef.current.k * ratio));
      setCam((c) => ({ ...c, k: nextK }));
    }
  };

  const onTouchEnd = () => {
    if (pinchRef.current) pinchRef.current = null;
  };

  const onContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const hit = hitTest(e.clientX - rect.left, e.clientY - rect.top);
    if (!hit) {
      setCtxMenu(null);
      return;
    }
    openCtxAt(e.clientX, e.clientY, hit.node);
  };

  const selected = useMemo(
    () => laid.find((l) => l.id === selectedId)?.node ?? null,
    [laid, selectedId]
  );

  const canEditSelected = selected && selected.type !== 'root';
  const canAddUnder =
    selected && (selected.type === 'root' || selected.type === 'notebook');

  return (
    <div className="relative flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden bg-slate-50 dark:bg-slate-950">
      <div className="relative z-30 flex shrink-0 flex-wrap items-center gap-1 border-b border-indigo-100/80 bg-white/90 px-2.5 py-1.5 backdrop-blur safe-pt dark:border-slate-800 dark:bg-slate-950/90">
        <button
          type="button"
          className="btn-ghost !p-1.5 md:hidden"
          onClick={onOpenSidebar}
          aria-label="菜单"
        >
          <Menu className="h-4 w-4" />
        </button>
        <div className="min-w-0 shrink-0 px-0.5">
          <div className="flex items-center gap-2">
            <span className="bg-gradient-to-r from-indigo-600 to-violet-600 bg-clip-text text-sm font-semibold text-transparent dark:from-indigo-400 dark:to-violet-400">
              思维导图
            </span>
            {!loading && (
              <span className="hidden rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-medium text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-300 sm:inline">
                {meta.noteCount}
              </span>
            )}
          </div>
          <div className="hidden max-w-[10rem] truncate text-[11px] text-slate-400 sm:block">
            {loading
              ? '加载中…'
              : status || (selected ? selected.title : '右键编辑 · Ctrl+F 搜索')}
          </div>
        </div>

        {/* 编辑操作（对应当前选中节点） */}
        <div className="flex shrink-0 items-center gap-0.5 border-r border-slate-100 pr-1 dark:border-slate-800">
          <button
            type="button"
            className="btn-ghost !p-1.5"
            title="新建分类（根下）"
            onClick={() => root && void addCategoryUnder(root)}
          >
            <FolderPlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost !p-1.5"
            title="新建笔记（当前分类下，或根下）"
            disabled={!canAddUnder && !root}
            onClick={() => {
              const p = canAddUnder ? selected! : root;
              if (p) void addNoteUnder(p);
            }}
          >
            <FilePlus className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost !p-1.5"
            title="重命名 (F2)"
            disabled={!canEditSelected}
            onClick={() => selected && void renameNode(selected)}
          >
            <Pencil className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost !p-1.5"
            title="修改父节点"
            disabled={!canEditSelected}
            onClick={() => selected && openMoveParent(selected)}
          >
            <CornerUpLeft className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost !p-1.5 text-red-500 hover:text-red-600"
            title="删除 (Delete)"
            disabled={!canEditSelected}
            onClick={() => selected && void deleteNode(selected)}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>

        {/* 关键字搜索：实时结果列表，点击定位 */}
        <div className="relative mx-1 min-w-0 flex-1 basis-[14rem]" ref={searchBoxRef}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            ref={searchInputRef}
            className="input w-full py-1.5 pl-8 pr-8 text-sm md:py-1 md:text-xs"
            placeholder="搜索标题与正文… (Ctrl+F)"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            onFocus={() => setSearchFocused(true)}
            title="Ctrl+F 聚焦搜索"
            onKeyDown={(e) => {
              const n = searchResults.length;
              if (e.key === 'ArrowDown' && n) {
                e.preventDefault();
                setSearchFocused(true);
                setListHi((i) => (i + 1) % n);
              } else if (e.key === 'ArrowUp' && n) {
                e.preventDefault();
                setSearchFocused(true);
                setListHi((i) => (i - 1 + n) % n);
              } else if (e.key === 'Enter' && n) {
                e.preventDefault();
                const hit = searchResults[listHi] || searchResults[0];
                if (hit) locateHit(hit.id);
              } else if (e.key === 'Escape') {
                e.preventDefault();
                if (searchFocused && searchQ) setSearchFocused(false);
                else clearSearch();
              }
            }}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
          />
          {searchQ && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              title="清除"
              onClick={clearSearch}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}

        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            className={clsx(
              'btn-ghost !rounded-lg !px-2 !py-1 text-[11px]',
              focusMode &&
                'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300'
            )}
            title="聚焦模式：点分类只展开这一支"
            onClick={() => {
              setFocusMode((v) => !v);
              setStatus(!focusMode ? '聚焦模式开' : '自由折叠');
            }}
          >
            <Scan className="h-3.5 w-3.5" />
            <span className="hidden sm:inline">聚焦</span>
          </button>
          <button type="button" className="btn-ghost !p-1.5" title="展开全部" onClick={expandAll}>
            <ChevronsUpDown className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost !p-1.5"
            title="概览"
            onClick={collapseToOverview}
          >
            <ChevronsDownUp className="h-4 w-4" />
          </button>
          <button type="button" className="btn-ghost !p-1.5" title="放大" onClick={() => zoomBy(1.12)}>
            <ZoomIn className="h-4 w-4" />
          </button>
          <button
            type="button"
            className="btn-ghost !p-1.5"
            title="缩小"
            onClick={() => zoomBy(1 / 1.12)}
          >
            <ZoomOut className="h-4 w-4" />
          </button>
          <button type="button" className="btn-ghost !p-1.5" title="适应" onClick={fitView}>
            <Focus className="h-4 w-4" />
          </button>
          <button type="button" className="btn-ghost !p-1.5" title="刷新" onClick={() => void load()}>
            <RefreshCw className={clsx('h-4 w-4', loading && 'animate-spin')} />
          </button>
        </div>
      </div>

      {/* Portal 到 body，保证不被导图画布 / overflow 裁切 */}
      {showSearchList &&
        createPortal(
          <div
            id="mindmap-search-dropdown"
            className={clsx(
              'fixed z-[9999] max-h-[min(16rem,50vh)] overflow-y-auto rounded-xl border shadow-2xl',
              'border-slate-200 bg-white dark:border-slate-700 dark:bg-slate-900'
            )}
            style={{
              top: listPos.top,
              left: listPos.left,
              width: listPos.width,
            }}
            role="listbox"
          >
            {searchLoading && searchResults.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">搜索中…</div>
            ) : searchResults.length === 0 ? (
              <div className="px-3 py-4 text-center text-xs text-slate-400">
                无匹配（标题与正文）
              </div>
            ) : (
              <>
                <div className="sticky top-0 z-10 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-[10px] text-slate-400 dark:border-slate-800 dark:bg-slate-950">
                  {searchResults.length} 条
                  {searchLoading ? ' · 全文检索中…' : ' · 标题+正文'}
                  {' · 点击定位'}
                </div>
                {searchResults.map((hit, i) => (
                  <button
                    key={hit.id}
                    type="button"
                    role="option"
                    aria-selected={i === listHi || hit.id === activeHitId}
                    className={clsx(
                      'flex w-full flex-col gap-0.5 px-3 py-2 text-left transition-colors',
                      i === listHi || hit.id === activeHitId
                        ? 'bg-indigo-50 dark:bg-indigo-500/15'
                        : 'hover:bg-slate-50 dark:hover:bg-slate-800/80'
                    )}
                    onMouseEnter={() => setListHi(i)}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => locateHit(hit.id)}
                  >
                    <span className="flex items-center gap-1.5 text-sm text-slate-800 dark:text-slate-100">
                      <span
                        className={clsx(
                          'shrink-0 rounded px-1 py-px text-[10px] font-medium',
                          hit.type === 'note'
                            ? 'bg-sky-100 text-sky-700 dark:bg-sky-500/20 dark:text-sky-300'
                            : 'bg-violet-100 text-violet-700 dark:bg-violet-500/20 dark:text-violet-300'
                        )}
                      >
                        {hit.type === 'note' ? '笔记' : '分类'}
                      </span>
                      <span className="min-w-0 truncate font-medium">
                        {highlightText(hit.title, searchQ)}
                      </span>
                    </span>
                    <span className="truncate pl-0.5 text-[11px] text-slate-400">
                      {highlightText(hit.path, searchQ)}
                    </span>
                    {hit.snippet && (
                      <span className="line-clamp-2 pl-0.5 text-[11px] leading-snug text-slate-500 dark:text-slate-400">
                        {highlightText(hit.snippet, searchQ)}
                      </span>
                    )}
                  </button>
                ))}
              </>
            )}
          </div>,
          document.body
        )}

      {error && (
        <div className="border-b border-red-200 bg-red-50 px-3 py-1.5 text-xs text-red-600 dark:border-red-900 dark:bg-red-950/40 dark:text-red-300">
          {error}
          <button type="button" className="ml-2 underline" onClick={() => void load()}>
            重试
          </button>
        </div>
      )}

      <div className="relative min-h-0 flex-1" ref={wrapRef}>
        <canvas
          ref={canvasRef}
          className="absolute inset-0 touch-none"
          style={{ touchAction: 'none' }}
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={() => {
            clearLongPress();
            dragRef.current = null;
            pinchRef.current = null;
          }}
          onWheel={onWheel}
          onContextMenu={onContextMenu}
          onTouchStart={onTouchStart}
          onTouchMove={onTouchMove}
          onTouchEnd={onTouchEnd}
          onTouchCancel={onTouchEnd}
        />

        {/* 手机：选中节点后底部快捷操作条 */}
        {selected && !preview && !ctxMenu && !moveNodeTarget && (
          <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center p-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] md:hidden">
            <div className="pointer-events-auto flex max-w-full items-center gap-0.5 overflow-x-auto rounded-2xl border border-slate-200/90 bg-white/95 px-1.5 py-1 shadow-xl backdrop-blur dark:border-slate-700 dark:bg-slate-900/95">
              {(selected.type === 'root' || selected.type === 'notebook') && (
                <>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 !px-2.5 !py-2 text-xs"
                    onClick={() => void addCategoryUnder(selected)}
                  >
                    <FolderPlus className="h-4 w-4" />
                    分类
                  </button>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 !px-2.5 !py-2 text-xs"
                    onClick={() => void addNoteUnder(selected)}
                  >
                    <FilePlus className="h-4 w-4" />
                    笔记
                  </button>
                </>
              )}
              {selected.type === 'note' && selected.refId && (
                <button
                  type="button"
                  className="btn-ghost shrink-0 !px-2.5 !py-2 text-xs"
                  onClick={() => void openPreview(selected.refId!, selected.title)}
                >
                  预览
                </button>
              )}
              {selected.type !== 'root' && (
                <>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 !px-2.5 !py-2 text-xs"
                    onClick={() => void renameNode(selected)}
                  >
                    <Pencil className="h-4 w-4" />
                    重命名
                  </button>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 !px-2.5 !py-2 text-xs"
                    onClick={() => openMoveParent(selected)}
                  >
                    <CornerUpLeft className="h-4 w-4" />
                    改父节点
                  </button>
                  <button
                    type="button"
                    className="btn-ghost shrink-0 !px-2.5 !py-2 text-xs text-red-500"
                    onClick={() => void deleteNode(selected)}
                  >
                    <Trash2 className="h-4 w-4" />
                    删除
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {/* 右键菜单 */}
        {ctxMenu &&
          createPortal(
            <div
              className="fixed z-[10000] min-w-[10.5rem] overflow-hidden rounded-xl border border-slate-200 bg-white py-1 text-sm shadow-2xl dark:border-slate-700 dark:bg-slate-900"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onClick={(e) => e.stopPropagation()}
              onContextMenu={(e) => e.preventDefault()}
            >
              <div className="border-b border-slate-100 px-3 py-1.5 text-[11px] text-slate-400 dark:border-slate-800">
                {ctxMenu.node.type === 'root'
                  ? '根节点'
                  : ctxMenu.node.type === 'notebook'
                    ? '分类'
                    : '笔记'}
                ：{ctxMenu.node.title}
              </div>
              {(ctxMenu.node.type === 'root' || ctxMenu.node.type === 'notebook') && (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => void addCategoryUnder(ctxMenu.node)}
                  >
                    <FolderPlus className="h-3.5 w-3.5 text-violet-500" />
                    新建子分类
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => void addNoteUnder(ctxMenu.node)}
                  >
                    <FilePlus className="h-3.5 w-3.5 text-sky-500" />
                    新建笔记
                  </button>
                </>
              )}
              {ctxMenu.node.type === 'note' && (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => {
                      closeCtx();
                      if (ctxMenu.node.refId) void openPreview(ctxMenu.node.refId, ctxMenu.node.title);
                    }}
                  >
                    预览
                  </button>
                  {onOpenNote && ctxMenu.node.refId && (
                    <button
                      type="button"
                      className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                      onClick={() => {
                        const id = ctxMenu.node.refId!;
                        closeCtx();
                        onOpenNote(id);
                      }}
                    >
                      <ExternalLink className="h-3.5 w-3.5" />
                      编辑
                    </button>
                  )}
                </>
              )}
              {ctxMenu.node.type !== 'root' && (
                <>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => void renameNode(ctxMenu.node)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                    重命名
                    <span className="ml-auto text-[10px] text-slate-400">F2</span>
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-slate-50 dark:hover:bg-slate-800"
                    onClick={() => openMoveParent(ctxMenu.node)}
                  >
                    <CornerUpLeft className="h-3.5 w-3.5 text-amber-500" />
                    修改父节点
                  </button>
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                    onClick={() => void deleteNode(ctxMenu.node)}
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                    删除
                    <span className="ml-auto text-[10px] opacity-60">Del</span>
                  </button>
                </>
              )}
            </div>,
            document.body
          )}

        {/* 修改父节点：选择目标分类 / 根 */}
        {moveNodeTarget &&
          createPortal(
            <div className="fixed inset-0 z-[10020] flex items-end justify-center sm:items-center sm:p-4">
              <button
                type="button"
                className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
                aria-label="取消"
                disabled={moving}
                onClick={closeMoveParent}
              />
              <div
                className="relative flex max-h-[min(80vh,32rem)] w-full max-w-md flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl"
                onClick={(e) => e.stopPropagation()}
              >
                <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                  <div className="min-w-0">
                    <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                      修改父节点
                    </div>
                    <div className="mt-0.5 truncate text-xs text-slate-500">
                      {moveNodeTarget.type === 'notebook' ? '分类' : '笔记'}：
                      {moveNodeTarget.title}
                    </div>
                  </div>
                  <button
                    type="button"
                    className="btn-ghost !p-1.5"
                    disabled={moving}
                    onClick={closeMoveParent}
                    title="关闭"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
                <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                  <input
                    className="input w-full py-1.5 text-sm"
                    placeholder="筛选分类…"
                    value={moveFilter}
                    autoFocus
                    disabled={moving}
                    onChange={(e) => setMoveFilter(e.target.value)}
                  />
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto py-1">
                  {parentOptions.length === 0 ? (
                    <div className="px-4 py-8 text-center text-xs text-slate-400">
                      无匹配分类
                    </div>
                  ) : (
                    parentOptions.map((opt) => {
                      const isCurrent =
                        opt.parentRefId === currentParentRefId ||
                        (opt.parentRefId == null && currentParentRefId == null);
                      return (
                        <button
                          key={opt.mindId + String(opt.parentRefId)}
                          type="button"
                          disabled={moving || isCurrent}
                          className={clsx(
                            'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors',
                            isCurrent
                              ? 'bg-indigo-50 text-indigo-700 dark:bg-indigo-500/15 dark:text-indigo-300'
                              : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                            moving && 'opacity-60'
                          )}
                          style={{ paddingLeft: `${12 + Math.min(opt.depth, 6) * 10}px` }}
                          onClick={() => void confirmMoveParent(opt)}
                        >
                          <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                          {isCurrent && (
                            <span className="shrink-0 text-[10px] text-indigo-500">当前</span>
                          )}
                        </button>
                      );
                    })
                  )}
                </div>
                <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800">
                  {moving ? '移动中…' : '选择新的上级分类；笔记也可挂到根下'}
                </div>
              </div>
            </div>,
            document.body
          )}

        {/* 叶子笔记内容浮层：不跳转页面 */}
        {preview && (
          <div className="absolute inset-0 z-20 flex items-stretch justify-end sm:items-center sm:justify-center sm:p-4">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
              aria-label="关闭预览"
              onClick={closePreview}
            />
            <div
              className={clsx(
                'relative flex h-full w-full flex-col bg-white shadow-2xl dark:bg-slate-900',
                'sm:h-[min(85dvh,720px)] sm:max-w-lg sm:rounded-2xl sm:border sm:border-slate-200 dark:sm:border-slate-700',
                'md:max-w-xl'
              )}
              role="dialog"
              aria-modal="true"
              aria-labelledby="mindmap-preview-title"
            >
              <div className="flex shrink-0 items-start gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div className="min-w-0 flex-1">
                  <h2
                    id="mindmap-preview-title"
                    className="truncate text-base font-semibold text-slate-800 dark:text-slate-100"
                  >
                    {previewHighlightQ
                      ? highlightText(preview.title || '未命名', previewHighlightQ)
                      : preview.title || '未命名'}
                  </h2>
                  <p className="mt-0.5 text-[11px] text-slate-400">
                    {previewLoading
                      ? '加载中…'
                      : previewHighlightQ
                        ? `预览 · 已高亮「${previewHighlightQ}」· 点击遮罩关闭`
                        : '思维导图预览 · 点击遮罩关闭'}
                  </p>
                </div>
                <button
                  type="button"
                  className="btn-ghost !p-1.5"
                  title="关闭"
                  onClick={closePreview}
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              <div className="scroll-y min-h-0 flex-1 px-4 py-3">
                {previewError ? (
                  <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600 dark:bg-red-950/40 dark:text-red-300">
                    {previewError}
                    <button
                      type="button"
                      className="ml-2 underline"
                      onClick={() => void openPreview(preview.id, preview.title)}
                    >
                      重试
                    </button>
                  </div>
                ) : previewLoading && !preview.content ? (
                  <div className="py-12 text-center text-sm text-slate-400">加载笔记内容…</div>
                ) : preview.content?.trim() ? (
                  <div
                    className="md-preview prose-sm max-w-none"
                    dangerouslySetInnerHTML={{ __html: previewHtml }}
                    onClick={(e) => {
                      if (handleCodeCopyClick(e.target)) {
                        e.preventDefault();
                        e.stopPropagation();
                      }
                    }}
                  />
                ) : (
                  <div className="py-12 text-center text-sm text-slate-400">（空笔记）</div>
                )}
              </div>

              <div className="flex shrink-0 items-center justify-end gap-2 border-t border-slate-100 px-4 py-2.5 dark:border-slate-800">
                <button type="button" className="btn-ghost !py-1.5 text-sm" onClick={closePreview}>
                  关闭
                </button>
                {onOpenNote && (
                  <button
                    type="button"
                    className="btn-primary !py-1.5 text-sm"
                    onClick={() => {
                      const id = preview.id;
                      closePreview();
                      onOpenNote(id);
                    }}
                  >
                    <ExternalLink className="h-3.5 w-3.5" />
                    在编辑器打开
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
