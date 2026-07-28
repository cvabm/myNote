import {
  ArrowLeft,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type { Note } from '../types';
import { formatRelativeTime } from '../utils';
import { MarkdownEditor, type EditorMode } from './MarkdownEditor';

type NotePatch = {
  title?: string;
  content?: string;
};

type Props = {
  note: Note;
  saving: boolean;
  onChange: (patch: NotePatch) => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onClose: () => void;
  /** 新建后打开用分栏；点列表打开用预览 */
  initialEditorMode?: EditorMode;
};

export function NoteEditor({
  note,
  saving,
  onChange,
  onTrash,
  onRestore,
  onDeleteForever,
  onClose,
  initialEditorMode = 'preview',
}: Props) {
  const isTrash = !!note.deletedAt;
  const readOnly = isTrash;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-slate-950">
      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-2 safe-pt sm:gap-2 sm:px-4 dark:border-slate-800">
        <button
          type="button"
          className="btn-ghost shrink-0 !p-2 md:hidden"
          onClick={onClose}
          title="返回列表"
          aria-label="返回列表"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <input
          className="min-w-0 flex-1 border-0 bg-transparent text-base font-semibold text-slate-800 outline-none placeholder:text-slate-300 dark:text-slate-100 dark:placeholder:text-slate-600 sm:text-lg"
          value={note.title}
          disabled={readOnly}
          onChange={(e) => onChange({ title: e.target.value })}
          placeholder="笔记标题"
        />
        <span className="hidden shrink-0 text-xs text-slate-400 sm:inline">
          {saving ? '保存中…' : `已保存 · ${formatRelativeTime(note.updatedAt)}`}
        </span>
        <span className="shrink-0 text-[11px] text-slate-400 sm:hidden">
          {saving ? '保存中' : '已保存'}
        </span>
        {!isTrash && (
          <button
            type="button"
            className="btn-danger shrink-0 !p-2"
            title="移入回收站"
            onClick={onTrash}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
        {isTrash && (
          <>
            <button
              type="button"
              className="btn-ghost shrink-0 !px-2 !py-2 text-xs"
              onClick={onRestore}
            >
              <RotateCcw className="h-4 w-4" />
              <span className="hidden sm:inline">恢复</span>
            </button>
            <button
              type="button"
              className="btn-danger shrink-0 !px-2 !py-2 text-xs"
              onClick={onDeleteForever}
            >
              <Trash2 className="h-4 w-4" />
              <span className="hidden sm:inline">永久删除</span>
            </button>
          </>
        )}
      </div>

      {isTrash && (
        <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm dark:border-slate-800 sm:px-4">
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            回收站中 · 只读
          </span>
        </div>
      )}

      <div className="min-h-0 flex-1 overflow-hidden safe-pb">
        <MarkdownEditor
          key={`${note.id}-${initialEditorMode}`}
          value={note.content}
          readOnly={readOnly}
          initialMode={initialEditorMode}
          placeholder="开始用 Markdown 书写…"
          onChange={(content) => {
            if (!readOnly) onChange({ content });
          }}
        />
      </div>
    </div>
  );
}
