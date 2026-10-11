import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  ChevronDown,
  ChevronRight,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  Loader2,
  Menu,
  Search,
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
  const [creating, setCreating] = useState(false);
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

  async function createNote(notebookId: string | null) {
    if (creating) return;
    setCreating(true);
    try {
      await onCreateNote(notebookId);
    } finally {
      setCreating(false);
    }
  }

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
          <button
            key={node.id}
            type="button"
            onClick={() => id && onSelect(id)}
            className={clsx(
              'flex w-full items-center gap-1.5 rounded-md py-1.5 pr-2 text-left text-sm transition',
              active
                ? 'bg-brand-50 font-medium text-brand-700 dark:bg-brand-500/15 dark:text-brand-300'
                : 'text-slate-700 hover:bg-white dark:text-slate-200 dark:hover:bg-slate-800'
            )}
            style={{ paddingLeft: 12 + depth * 16 }}
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
              title="在此分类下新建笔记"
              aria-label="在此分类下新建笔记"
              disabled={creating}
              onClick={() => void createNote(node.refId || null)}
            >
              <FilePlus className="h-3.5 w-3.5" />
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
          className="btn-primary !px-2.5 !py-2"
          title="新建笔记"
          aria-label="新建笔记"
          disabled={creating}
          onClick={() => void createNote(null)}
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <FilePlus className="h-4 w-4" />}
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
            {searching ? (searchLoading ? '搜索中…' : '没有匹配的笔记') : '还没有笔记'}
          </div>
        )}
        {!loading && !error && renderNodes(visible, 0)}
      </div>
    </div>
  );
}
