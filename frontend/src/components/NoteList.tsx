import clsx from 'clsx';
import { Menu, Plus, Star, Trash2 } from 'lucide-react';
import type { NoteListItem } from '../types';
import { formatRelativeTime } from '../utils';

type Props = {
  notes: NoteListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isTrash?: boolean;
  onEmptyTrash?: () => void;
  /** 手机端打开侧边栏 */
  onOpenSidebar?: () => void;
  onCreateNote?: () => void;
  /** 手机选中笔记时隐藏列表 */
  mobileHidden?: boolean;
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
}: Props) {
  return (
    <div
      className={clsx(
        'h-full w-full shrink-0 flex-col border-r border-slate-200 bg-surface-50 md:w-72',
        mobileHidden ? 'hidden md:flex' : 'flex'
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-3 py-3 safe-pt md:px-4">
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
            <div className="text-sm font-semibold text-slate-800">
              {isTrash ? '回收站' : '笔记'}
            </div>
            <div className="text-xs text-slate-400">{notes.length} 篇</div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          {isTrash && notes.length > 0 && (
            <button type="button" className="btn-danger text-xs" onClick={onEmptyTrash}>
              <Trash2 className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">清空</span>
            </button>
          )}
          {!isTrash && onCreateNote && (
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
          <div className="px-4 py-10 text-center text-sm text-slate-400">暂无笔记</div>
        )}
        {notes.map((note) => (
          <button
            key={note.id}
            type="button"
            onClick={() => onSelect(note.id)}
            className={clsx(
              'w-full border-b border-slate-100 px-4 py-3.5 text-left transition active:bg-white md:py-3',
              selectedId === note.id
                ? 'bg-white shadow-soft ring-1 ring-inset ring-brand-100'
                : 'hover:bg-white/80'
            )}
          >
            <div className="mb-1 flex items-start gap-2">
              <span className="line-clamp-1 flex-1 text-sm font-medium text-slate-800">
                {note.title || '未命名笔记'}
              </span>
              {note.isFavorite && (
                <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />
              )}
            </div>
            {note.preview && (
              <p className="mb-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
                {note.preview}
              </p>
            )}
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] text-slate-400">
                {formatRelativeTime(note.updatedAt)}
              </span>
              {note.tags.slice(0, 2).map((t) => (
                <span
                  key={t.id}
                  className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500"
                >
                  {t.name}
                </span>
              ))}
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
