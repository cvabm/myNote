import { useEffect, useMemo, useState } from 'react';
import MDEditor from '@uiw/react-md-editor';
import {
  ArrowLeft,
  Lock,
  RotateCcw,
  Star,
  Trash2,
  Unlock,
} from 'lucide-react';
import type { Note, Notebook } from '../types';
import { formatRelativeTime } from '../utils';
import { useIsMobile } from '../hooks/useMediaQuery';

type NotePatch = {
  title?: string;
  content?: string;
  notebookId?: string | null;
  isFavorite?: boolean;
  isLocked?: boolean;
  tags?: string[];
};

type Props = {
  note: Note;
  notebooks: Notebook[];
  saving: boolean;
  onChange: (patch: NotePatch) => void;
  onTrash: () => void;
  onRestore: () => void;
  onDeleteForever: () => void;
  onClose: () => void;
};

export function NoteEditor({
  note,
  notebooks,
  saving,
  onChange,
  onTrash,
  onRestore,
  onDeleteForever,
  onClose,
}: Props) {
  const [tagInput, setTagInput] = useState('');
  const isMobile = useIsMobile();
  const isTrash = !!note.deletedAt;
  const readOnly = isTrash || !!note.isLocked;

  const tagNames = useMemo(() => note.tags.map((t) => t.name) || [], [note.tags]);

  useEffect(() => {
    setTagInput(tagNames.join(', '));
  }, [note.id, tagNames.join(',')]);

  function commitTags() {
    const tags = tagInput
      .split(/[,，]/)
      .map((s) => s.trim())
      .filter(Boolean);
    onChange({ tags });
  }

  // 手机用单栏 edit/preview，避免 live 左右分屏挤成一团
  const previewMode = readOnly ? 'preview' : isMobile ? 'edit' : 'live';

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-white" data-color-mode="light">
      <div className="flex items-center gap-1 border-b border-slate-200 px-2 py-2 safe-pt sm:gap-2 sm:px-4">
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
          className="min-w-0 flex-1 border-0 bg-transparent text-base font-semibold text-slate-800 outline-none placeholder:text-slate-300 sm:text-lg"
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
          <>
            <button
              type="button"
              className="btn-ghost shrink-0 !p-2"
              title={note.isFavorite ? '取消收藏' : '收藏'}
              onClick={() => onChange({ isFavorite: !note.isFavorite })}
            >
              <Star
                className={`h-4 w-4 ${note.isFavorite ? 'fill-amber-400 text-amber-400' : ''}`}
              />
            </button>
            <button
              type="button"
              className="btn-ghost shrink-0 !p-2"
              title={note.isLocked ? '解锁' : '锁定'}
              onClick={() => onChange({ isLocked: !note.isLocked })}
            >
              {note.isLocked ? <Unlock className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
            </button>
            <button
              type="button"
              className="btn-danger shrink-0 !p-2"
              title="移入回收站"
              onClick={onTrash}
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </>
        )}
        {isTrash && (
          <>
            <button type="button" className="btn-ghost shrink-0 !px-2 !py-2 text-xs" onClick={onRestore}>
              <RotateCcw className="h-4 w-4" />
              <span className="hidden xs:inline sm:inline">恢复</span>
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

      <div className="flex flex-wrap items-center gap-2 border-b border-slate-100 px-3 py-2 text-sm sm:gap-3 sm:px-4">
        <label className="flex min-w-0 items-center gap-2 text-slate-500">
          <span className="shrink-0 text-xs">笔记本</span>
          <select
            className="input w-auto max-w-[40vw] py-1.5 text-xs sm:max-w-none sm:py-1"
            disabled={readOnly}
            value={note.notebookId || ''}
            onChange={(e) =>
              onChange({ notebookId: e.target.value ? e.target.value : null })
            }
          >
            <option value="">未分类</option>
            {notebooks.map((nb) => (
              <option key={nb.id} value={nb.id}>
                {nb.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex min-w-0 flex-1 basis-full items-center gap-2 text-slate-500 sm:basis-auto sm:min-w-[200px]">
          <span className="shrink-0 text-xs">标签</span>
          <input
            className="input py-1.5 text-xs sm:py-1"
            disabled={readOnly}
            value={tagInput}
            onChange={(e) => setTagInput(e.target.value)}
            onBlur={commitTags}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                commitTags();
              }
            }}
            placeholder="用逗号分隔，如：工作, 灵感"
          />
        </label>
        {isTrash && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-xs text-amber-700">
            回收站中 · 只读
          </span>
        )}
        {note.isLocked && !isTrash && (
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-600">
            已锁定
          </span>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden safe-pb">
        <MDEditor
          value={note.content}
          height="100%"
          preview={previewMode}
          hideToolbar={readOnly}
          visibleDragbar={false}
          onChange={(v) => {
            if (!readOnly) onChange({ content: v || '' });
          }}
          textareaProps={{
            placeholder: '开始用 Markdown 书写…',
            disabled: readOnly,
          }}
        />
      </div>
    </div>
  );
}
