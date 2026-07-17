import { useEffect, useRef } from 'react';
import clsx from 'clsx';
import { Loader2, Menu, Plus, Star, Trash2 } from 'lucide-react';
import type { NoteListItem } from '../types';
import { formatRelativeTime, highlightText } from '../utils';

type Props = {
  notes: NoteListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isTrash?: boolean;
  onEmptyTrash?: () => void;
  onOpenSidebar?: () => void;
  onCreateNote?: () => void;
  mobileHidden?: boolean;
  highlightQuery?: string;
  searching?: boolean;
  hasMore?: boolean;
  loadingMore?: boolean;
  onLoadMore?: () => void;
};

export function NoteList({
  notes,
  selectedId,
  onSelect,
  isTrash,
  onEmptyTrash,
  onOpenSidebar,
  onCreateNote,
  mobileHidden,
  highlightQuery = '',
  searching = false,
  hasMore = false,
  loadingMore = false,
  onLoadMore,
}: Props) {
  const isSearch = !!highlightQuery.trim();
  const q = highlightQuery.trim();
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!hasMore || !onLoadMore) return;
    const el = sentinelRef.current;
    if (!el) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          onLoadMore();
        }
      },
      { root: el.parentElement, rootMargin: '120px', threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, onLoadMore, notes.length]);

  return (
    <div
      className={clsx(
        'h-full w-full shrink-0 flex-col border-r border-slate-200 bg-surface-50 md:w-72 dark:border-slate-800 dark:bg-slate-900/50',
        mobileHidden ? 'hidden md:flex' : 'flex'
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 safe-pt md:px-4 dark:border-slate-800">
        <div className="flex min-w-0 items-center gap-2">
          <button
            type="button"
            className="btn-ghost !p-2 md:hidden"
            onClick={onOpenSidebar}
            aria-label="打开菜单"
            title="菜单"
          >
            <Menu className="h-5 w-5" />
          </button>
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
              {isTrash ? '回收站' : isSearch ? '搜索结果' : '笔记'}
            </div>
            <div className="flex items-center gap-1.5 text-xs text-slate-400">
              {(searching || loadingMore) && <Loader2 className="h-3 w-3 animate-spin" />}
              {isSearch ? (
                <span className="truncate">
                  “{q}” · 已加载 {notes.length}
                  {hasMore ? '+' : ''} 条
                </span>
              ) : (
                <span>
                  已加载 {notes.length}
                  {hasMore ? '+' : ''} 篇
                </span>
              )}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isTrash && notes.length > 0 && (
            <button type="button" className="btn-danger text-xs" onClick={onEmptyTrash}>
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">清空</span>
            </button>
          )}
          {!isTrash && !isSearch && onCreateNote && (
            <button
              type="button"
              className="btn-primary !px-2.5 !py-2 md:hidden"
              onClick={onCreateNote}
              title="新建笔记"
              aria-label="新建笔记"
            >
              <Plus className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain safe-pb">
        {notes.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-slate-400">
            {searching ? '搜索中…' : isSearch ? '没有匹配的笔记' : '暂无笔记'}
          </div>
        )}
        {notes.map((note) => (
          <button
            key={note.id}
            type="button"
            onClick={() => onSelect(note.id)}
            className={clsx(
              'w-full border-b border-slate-100 px-4 py-3.5 text-left transition md:py-3 dark:border-slate-800',
              selectedId === note.id
                ? 'bg-white shadow-soft ring-1 ring-inset ring-brand-100 dark:bg-slate-900 dark:ring-brand-500/30'
                : 'hover:bg-white/80 active:bg-white dark:hover:bg-slate-800/80 dark:active:bg-slate-800'
            )}
          >
            <div className="mb-1 flex items-start gap-2">
              <span className="line-clamp-1 flex-1 text-sm font-medium text-slate-800 dark:text-slate-100">
                {isSearch
                  ? highlightText(note.title || '未命名笔记', q)
                  : note.title || '未命名笔记'}
              </span>
              {note.isFavorite && (
                <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
              )}
            </div>
            {note.preview && (
              <p className="mb-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
                {isSearch ? highlightText(note.preview, q) : note.preview}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-400">
                {formatRelativeTime(note.updatedAt)}
              </span>
            </div>
          </button>
        ))}

        {/* 无限滚动哨兵 */}
        <div ref={sentinelRef} className="h-1 w-full shrink-0" aria-hidden />
        {loadingMore && (
          <div className="flex items-center justify-center gap-1.5 py-3 text-xs text-slate-400">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            加载更多…
          </div>
        )}
        {!loadingMore && !hasMore && notes.length > 0 && (
          <div className="py-3 text-center text-[11px] text-slate-400">已经到底了</div>
        )}
      </div>
    </div>
  );
}
