import clsx from 'clsx';
import { Star, Trash2 } from 'lucide-react';
import type { NoteListItem } from '../types';
import { formatRelativeTime } from '../utils';

type Props = {
  notes: NoteListItem[];
  selectedId: string | null;
  onSelect: (id: string) => void;
  isTrash?: boolean;
  onEmptyTrash?: () => void;
};

export function NoteList({ notes, selectedId, onSelect, isTrash, onEmptyTrash }: Props) {
  return (
    <div className="flex h-full w-72 shrink-0 flex-col border-r border-slate-200 bg-surface-50">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div>
          <div className="text-sm font-semibold text-slate-800">
            {isTrash ? '回收站' : '笔记'}
          </div>
          <div className="text-xs text-slate-400">{notes.length} 篇</div>
        </div>
        {isTrash && notes.length > 0 && (
          <button type="button" className="btn-danger text-xs" onClick={onEmptyTrash}>
            <Trash2 className="h-3.5 w-3.5" />
            清空
          </button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto">
        {notes.length === 0 && (
          <div className="px-4 py-10 text-center text-sm text-slate-400">暂无笔记</div>
        )}
        {notes.map((note) => (
          <button
            key={note.id}
            type="button"
            onClick={() => onSelect(note.id)}
            className={clsx(
              'w-full border-b border-slate-100 px-4 py-3 text-left transition',
              selectedId === note.id
                ? 'bg-white shadow-soft ring-1 ring-inset ring-brand-100'
                : 'hover:bg-white/80'
            )}
          >
            <div className="mb-1 flex items-start gap-2">
              <span className="line-clamp-1 flex-1 text-sm font-medium text-slate-800">
                {note.title || '未命名笔记'}
              </span>
              {note.isFavorite && <Star className="h-3.5 w-3.5 shrink-0 fill-amber-400 text-amber-400" />}
            </div>
            {note.preview && (
              <p className="mb-1.5 line-clamp-2 text-xs leading-relaxed text-slate-500">
                {note.preview}
              </p>
            )}
            <div className="flex items-center gap-2">
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
