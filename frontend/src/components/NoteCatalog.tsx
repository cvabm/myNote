import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import clsx from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  CornerUpLeft,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Loader2,
  Menu,
  Search,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { MindNode, NoteListItem } from '../types';
import { BrowseModeSwitch, type BrowseMode } from './BrowseModeSwitch';

type Props = {
  selectedId: string | null;
  selectedTitle?: string | null;
  onSelect: (id: string) => void;
  onCreateNote: (notebookId: string | null) => Promise<void>;
  onOpenSidebar?: () => void;
  onBrowseMode: (mode: BrowseMode) => void;
  mobileHidden?: boolean;
  reloadToken?: number;
};

type ParentOption = {
  key: string;
  parentRefId: string | null;
  mindId: string;
  label: string;
  depth: number;
};

function filterNodes(
  nodes: MindNode[],
  query: string,
  contentIds: Set<string> | null
): MindNode[] {
  const q = query.trim().toLowerCase();
  if (!q) return nodes;
  const out: MindNode[] = [];
  for (const node of nodes) {
    const titleHit = node.title.toLowerCase().includes(q);
    if (node.type === 'note') {
      const id = node.refId || '';
      if (titleHit || (id !== '' && contentIds?.has(id))) out.push(node);
      continue;
    }
    const children = filterNodes(node.children, query, contentIds);
    if (titleHit || children.length) {
      out.push({ ...node, children: children.length ? children : node.children });
    }
  }
  return out;
}

function findParentRef(node: MindNode, targetId: string): string | null | undefined {
  for (const child of node.children) {
    if (child.id === targetId) {
      return node.type === 'notebook' ? node.refId ?? null : null;
    }
    if (child.type === 'notebook') {
      const found = findParentRef(child, targetId);
      if (found !== undefined) return found;
    }
  }
  return undefined;
}

export function NoteCatalog({
  selectedId,
  selectedTitle,
  onSelect,
  onCreateNote,
  onOpenSidebar,
  onBrowseMode,
  mobileHidden,
  reloadToken = 0,
}: Props) {
  const [root, setRoot] = useState<MindNode | null>(null);
  const [noteCount, setNoteCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [contentHits, setContentHits] = useState<Map<string, string>>(new Map());
  const [searchLoading, setSearchLoading] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [creating, setCreating] = useState<'note' | 'dir' | null>(null);
  const [moveTarget, setMoveTarget] = useState<MindNode | null>(null);
  const [moveFilter, setMoveFilter] = useState('');
  const [moving, setMoving] = useState(false);
  const searchSeq = useRef(0);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    setError('');
    try {
      const data = await api.getMindmap();
      setRoot(data.root);
      setNoteCount(data.noteCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : '目录加载失败');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load(reloadToken > 0);
  }, [load, reloadToken]);

  const searching = query.trim().length > 0;
  const contentIds = useMemo(
    () => (searching ? new Set(contentHits.keys()) : null),
    [searching, contentHits]
  );
  const visible = useMemo(
    () => filterNodes(root?.children || [], query, contentIds),
    [root, query, contentIds]
  );

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      searchSeq.current += 1;
      setContentHits(new Map());
      setSearchLoading(false);
      return;
    }
    setSearchLoading(true);
    const seq = ++searchSeq.current;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const items: NoteListItem[] = [];
          let offset = 0;
          for (;;) {
            const page = await api.listNotes({ q, limit: 100, offset });
            if (seq !== searchSeq.current) return;
            items.push(...page.items);
            if (!page.hasMore || page.items.length === 0) break;
            offset += page.items.length;
            if (offset >= 500) break;
          }
          if (seq !== searchSeq.current) return;
          const hits = new Map<string, string>();
          for (const note of items) {
            const preview = (note.preview || '').trim();
            hits.set(note.id, preview && preview !== (note.title || '').trim() ? preview : '');
          }
          setContentHits(hits);
        } catch {
          if (seq !== searchSeq.current) return;
          setContentHits(new Map());
        } finally {
          if (seq === searchSeq.current) setSearchLoading(false);
        }
      })();
    }, 220);
    return () => clearTimeout(timer);
  }, [query]);

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function expand(id: string) {
    setExpanded((prev) => {
      if (prev.has(id)) return prev;
      const next = new Set(prev);
      next.add(id);
      return next;
    });
  }

  async function createNote(notebookId: string | null) {
    if (creating || moving) return;
    setCreating('note');
    try {
      await onCreateNote(notebookId);
    } finally {
      setCreating(null);
    }
  }

  async function createDirectory(parentId: string | null, parentMindId: string | null) {
    if (creating || moving) return;
    const title = window.prompt('目录名称', '新目录');
    if (title == null) return;
    const name = title.trim() || '新目录';
    setCreating('dir');
    try {
      await api.createNotebook({ name, parentId });
      if (parentMindId) expand(parentMindId);
      await load(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : '新建目录失败');
    } finally {
      setCreating(null);
    }
  }

  function openMove(node: MindNode) {
    if (creating || moving || !node.refId) return;
    setMoveFilter('');
    setMoveTarget(node);
  }

  function closeMove() {
    if (moving) return;
    setMoveTarget(null);
    setMoveFilter('');
  }

  const currentParentRefId = useMemo((): string | null | undefined => {
    if (!root || !moveTarget) return undefined;
    return findParentRef(root, moveTarget.id);
  }, [root, moveTarget]);

  const parentOptions = useMemo((): ParentOption[] => {
    if (!root || !moveTarget) return [];
    const forbid = new Set<string>();
    if (moveTarget.type === 'notebook') {
      const mark = (n: MindNode) => {
        forbid.add(n.id);
        n.children.forEach(mark);
      };
      mark(moveTarget);
    }

    const out: ParentOption[] = [
      { key: 'root', parentRefId: null, mindId: 'root', label: '根目录', depth: 0 },
    ];
    const walk = (n: MindNode, path: string[], depth: number) => {
      if (n.type !== 'notebook' || !n.refId || forbid.has(n.id)) {
        if (n.type === 'root') {
          for (const child of n.children) {
            if (child.type === 'notebook') walk(child, [], 1);
          }
        }
        return;
      }
      out.push({
        key: n.id,
        parentRefId: n.refId,
        mindId: n.id,
        label: [...path, n.title].join(' / '),
        depth,
      });
      for (const child of n.children) {
        if (child.type === 'notebook') walk(child, [...path, n.title], depth + 1);
      }
    };
    walk(root, [], 0);

    const q = moveFilter.trim().toLowerCase();
    if (!q) return out;
    return out.filter((opt) => opt.label.toLowerCase().includes(q));
  }, [root, moveTarget, moveFilter]);

  async function confirmMove(opt: ParentOption) {
    if (!moveTarget?.refId || moving) return;
    if (opt.parentRefId === (currentParentRefId ?? null)) {
      closeMove();
      return;
    }
    setMoving(true);
    try {
      if (moveTarget.type === 'notebook') {
        await api.updateNotebook(moveTarget.refId, { parentId: opt.parentRefId });
      } else if (moveTarget.type === 'note') {
        await api.updateNote(moveTarget.refId, { notebookId: opt.parentRefId });
      } else {
        return;
      }
      if (opt.mindId !== 'root') expand(opt.mindId);
      setMoveTarget(null);
      setMoveFilter('');
      await load(true);
    } catch (e) {
      alert(e instanceof Error ? e.message : '更改父目录失败');
    } finally {
      setMoving(false);
    }
  }

  useEffect(() => {
    if (!moveTarget) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMove();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [moveTarget, moving]);

  function renderNodes(nodes: MindNode[], depth: number) {
    return nodes.map((node) => {
      if (node.type === 'note') {
        const id = node.refId || '';
        const active = id !== '' && id === selectedId;
        const title =
          active && selectedTitle != null
            ? selectedTitle || '未命名笔记'
            : node.title || '未命名笔记';
        return (
          <div
            key={node.id}
            className={clsx(
              'group flex items-center rounded-md pr-1',
              active
                ? 'bg-brand-50 dark:bg-brand-500/15'
                : 'hover:bg-white dark:hover:bg-slate-800'
            )}
            style={{ paddingLeft: 12 + depth * 16 }}
          >
            <button
              type="button"
              onClick={() => id && onSelect(id)}
              className={clsx(
                'flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm transition',
                active
                  ? 'font-medium text-brand-700 dark:text-brand-300'
                  : 'text-slate-700 dark:text-slate-200'
              )}
            >
              <FileText className="h-3.5 w-3.5 shrink-0 opacity-70" />
              <span className="min-w-0 flex-1">
                <span className="block truncate">{title}</span>
                {searching && contentHits.get(id) ? (
                  <span className="block truncate text-[11px] font-normal text-slate-400">
                    {contentHits.get(id)}
                  </span>
                ) : null}
              </span>
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              title="更改父目录"
              aria-label="更改父目录"
              disabled={creating !== null || moving}
              onClick={() => openMove(node)}
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      }

      const open = searching || expanded.has(node.id);
      return (
        <div key={node.id}>
          <div
            className="group flex items-center gap-0.5 rounded-md pr-1 hover:bg-white dark:hover:bg-slate-800"
            style={{ paddingLeft: 4 + depth * 16 }}
          >
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              aria-label={open ? '折叠' : '展开'}
              onClick={() => toggle(node.id)}
            >
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-sm font-medium text-slate-800 dark:text-slate-100"
              onClick={() => toggle(node.id)}
            >
              {open ? (
                <FolderOpen className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              ) : (
                <Folder className="h-3.5 w-3.5 shrink-0 text-amber-500" />
              )}
              <span className="truncate">{node.title}</span>
              <span className="shrink-0 text-[11px] font-normal text-slate-400">{node.noteCount ?? 0}</span>
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              title="在此目录下新建子目录"
              aria-label="在此目录下新建子目录"
              disabled={creating !== null || moving}
              onClick={() => void createDirectory(node.refId || null, node.id)}
            >
              <FolderPlus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              title="在此目录下新建笔记"
              aria-label="在此目录下新建笔记"
              disabled={creating !== null || moving}
              onClick={() => void createNote(node.refId || null)}
            >
              <FilePlus className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className="rounded p-1 text-slate-400 hover:text-slate-700 dark:hover:text-slate-200"
              title="更改父目录"
              aria-label="更改父目录"
              disabled={creating !== null || moving}
              onClick={() => openMove(node)}
            >
              <CornerUpLeft className="h-3.5 w-3.5" />
            </button>
          </div>
          {open && node.children.length > 0 && renderNodes(node.children, depth + 1)}
        </div>
      );
    });
  }

  return (
    <div
      className={clsx(
        'h-full min-h-0 w-full shrink-0 flex-col border-r border-slate-200 bg-surface-50 md:w-80 dark:border-slate-800 dark:bg-slate-900/50',
        mobileHidden ? 'hidden md:flex' : 'flex'
      )}
    >
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 safe-pt dark:border-slate-800">
        <button
          type="button"
          className="btn-ghost !p-2 md:hidden"
          onClick={onOpenSidebar}
          aria-label="打开菜单"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">笔记</div>
          <div className="text-xs text-slate-400">{loading ? '加载中…' : `${noteCount} 篇`}</div>
        </div>
        <BrowseModeSwitch mode="catalog" onChange={onBrowseMode} />
        <button
          type="button"
          className="btn-ghost !px-2.5 !py-2"
          title="新建目录"
          aria-label="新建目录"
          disabled={creating !== null || moving}
          onClick={() => void createDirectory(null, null)}
        >
          {creating === 'dir' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FolderPlus className="h-4 w-4" />}
        </button>
        <button
          type="button"
          className="btn-primary !px-2.5 !py-2"
          title="新建笔记"
          aria-label="新建笔记"
          disabled={creating !== null || moving}
          onClick={() => void createNote(null)}
        >
          {creating === 'note' ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus className="h-4 w-4" />}
        </button>
      </div>

      <div className="border-b border-slate-200 px-3 py-2 dark:border-slate-800">
        <div className="relative">
          {searchLoading ? (
            <Loader2 className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 animate-spin text-slate-400" />
          ) : (
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          )}
          <input
            className="input w-full py-1.5 pl-8 text-sm"
            placeholder="搜索标题与正文…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <div className="scroll-y flex-1 px-1.5 py-1.5 safe-pb">
        {loading && (
          <div className="flex items-center justify-center gap-1.5 py-10 text-sm text-slate-400">
            <Loader2 className="h-4 w-4 animate-spin" />
            加载目录…
          </div>
        )}
        {!loading && error && (
          <div className="px-3 py-8 text-center text-sm text-slate-400">
            <p>{error}</p>
            <button type="button" className="btn-ghost mt-2 text-xs" onClick={() => void load()}>
              重试
            </button>
          </div>
        )}
        {!loading && !error && visible.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-slate-400">
            {searching ? (searchLoading ? '搜索中…' : '没有匹配的笔记') : '还没有目录或笔记'}
          </div>
        )}
        {!loading && !error && renderNodes(visible, 0)}
      </div>

      {moveTarget &&
        createPortal(
          <div className="fixed inset-0 z-[10020] flex items-end justify-center sm:items-center sm:p-4">
            <button
              type="button"
              className="absolute inset-0 bg-slate-900/40 backdrop-blur-[2px]"
              aria-label="取消"
              disabled={moving}
              onClick={closeMove}
            />
            <div
              className="relative flex max-h-[min(80vh,32rem)] w-full max-w-md flex-col rounded-t-2xl border border-slate-200 bg-white shadow-2xl dark:border-slate-700 dark:bg-slate-900 sm:rounded-2xl"
              role="dialog"
              aria-modal="true"
              aria-labelledby="catalog-move-title"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex items-start justify-between gap-2 border-b border-slate-100 px-4 py-3 dark:border-slate-800">
                <div className="min-w-0">
                  <div id="catalog-move-title" className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                    更改父目录
                  </div>
                  <div className="mt-0.5 truncate text-xs text-slate-500">
                    {moveTarget.type === 'notebook' ? '目录' : '笔记'}：{moveTarget.title}
                  </div>
                </div>
                <button
                  type="button"
                  className="btn-ghost !p-1.5"
                  disabled={moving}
                  onClick={closeMove}
                  title="关闭"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
              <div className="border-b border-slate-100 px-3 py-2 dark:border-slate-800">
                <input
                  className="input w-full py-1.5 text-sm"
                  placeholder="筛选目录…"
                  value={moveFilter}
                  autoFocus
                  disabled={moving}
                  onChange={(e) => setMoveFilter(e.target.value)}
                />
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {parentOptions.length === 0 ? (
                  <div className="px-4 py-8 text-center text-xs text-slate-400">无匹配目录</div>
                ) : (
                  parentOptions.map((opt) => {
                    const isCurrent = opt.parentRefId === (currentParentRefId ?? null);
                    return (
                      <button
                        key={opt.key}
                        type="button"
                        disabled={moving || isCurrent}
                        className={clsx(
                          'flex w-full items-center gap-2 px-4 py-2.5 text-left text-sm transition-colors',
                          isCurrent
                            ? 'bg-brand-50 text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                            : 'hover:bg-slate-50 dark:hover:bg-slate-800',
                          moving && 'opacity-60'
                        )}
                        style={{ paddingLeft: `${12 + Math.min(opt.depth, 6) * 12}px` }}
                        onClick={() => void confirmMove(opt)}
                      >
                        <span className="min-w-0 flex-1 truncate">{opt.label}</span>
                        {isCurrent && <span className="shrink-0 text-[10px]">当前</span>}
                      </button>
                    );
                  })
                )}
              </div>
              <div className="border-t border-slate-100 px-4 py-2 text-[11px] text-slate-400 dark:border-slate-800">
                {moving
                  ? '移动中…'
                  : '可移到根目录或任意其他目录。目录不能移进自己或自己的子目录。'}
              </div>
            </div>
          </div>,
          document.body
        )}
    </div>
  );
}
