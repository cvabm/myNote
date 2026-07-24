import {
  useCallback,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type DragEvent,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import clsx from 'clsx';
import {
  Bold,
  Code,
  Columns2,
  Eye,
  Heading2,
  Image as ImageIcon,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  Loader2,
  PenLine,
  Quote,
} from 'lucide-react';
import { api } from '../api';
import { useIsMobile } from '../hooks/useMediaQuery';
import {
  removeImageFromMarkdown,
  renderMarkdown,
  uploadNameFromSrc,
} from '../lib/markdown';

export type EditorMode = 'edit' | 'preview' | 'split';

type Props = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
  /** 打开时的默认模式；新建笔记可传 split，点开已有笔记用 preview */
  initialMode?: EditorMode;
};

type Tool = {
  title: string;
  icon: ReactNode;
  run: (ta: HTMLTextAreaElement) => void;
};

function applyWrap(
  ta: HTMLTextAreaElement,
  before: string,
  after: string,
  placeholder: string,
  onChange: (v: string) => void
) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = ta.value;
  const selected = text.slice(start, end);
  const insert = selected || placeholder;
  const next = text.slice(0, start) + before + insert + after + text.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    ta.focus();
    const selStart = start + before.length;
    const selEnd = selStart + insert.length;
    ta.setSelectionRange(selStart, selEnd);
  });
}

function applyLinePrefix(
  ta: HTMLTextAreaElement,
  prefix: string,
  onChange: (v: string) => void
) {
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = ta.value;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const lineEndIdx = text.indexOf('\n', end);
  const lineEnd = lineEndIdx === -1 ? text.length : lineEndIdx;
  const block = text.slice(lineStart, lineEnd);
  const nextBlock = block
    .split('\n')
    .map((line) => (line.startsWith(prefix) ? line : prefix + line))
    .join('\n');
  const next = text.slice(0, lineStart) + nextBlock + text.slice(lineEnd);
  onChange(next);
  requestAnimationFrame(() => {
    ta.focus();
    ta.setSelectionRange(lineStart, lineStart + nextBlock.length);
  });
}

function insertSnippet(
  ta: HTMLTextAreaElement | null,
  value: string,
  snippet: string,
  onChange: (v: string) => void
) {
  if (!ta) {
    const needsNl = value.length > 0 && !value.endsWith('\n');
    onChange(value + (needsNl ? '\n' : '') + snippet);
    return;
  }
  const start = ta.selectionStart;
  const end = ta.selectionEnd;
  const text = ta.value;
  const before = text.slice(0, start);
  const pad =
    before.length > 0 && !before.endsWith('\n') && !snippet.startsWith('\n') ? '\n' : '';
  const next = before + pad + snippet + text.slice(end);
  onChange(next);
  requestAnimationFrame(() => {
    ta.focus();
    const pos = start + pad.length + snippet.length;
    ta.setSelectionRange(pos, pos);
  });
}

function isImageFile(file: File) {
  return /^image\/(jpeg|png|gif|webp)$/i.test(file.type);
}

/**
 * 复制文本。HTTP 非 localhost 下 navigator.clipboard 常为 undefined，需 execCommand 降级。
 */
async function copyTextToClipboard(text: string): Promise<boolean> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // 继续降级
    }
  }

  try {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.position = 'fixed';
    ta.style.left = '-9999px';
    ta.style.top = '0';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.focus();
    ta.select();
    ta.setSelectionRange(0, text.length);
    const ok = document.execCommand('copy');
    document.body.removeChild(ta);
    return ok;
  } catch {
    return false;
  }
}

function flashCopyButton(btn: HTMLButtonElement, ok: boolean) {
  const label = btn.textContent || '复制';
  btn.textContent = ok ? '已复制' : '失败';
  if (ok) btn.classList.add('is-copied');
  window.setTimeout(() => {
    btn.textContent = label === '已复制' || label === '失败' ? '复制' : label;
    btn.classList.remove('is-copied');
  }, 1500);
}

export function MarkdownEditor({
  value,
  onChange,
  readOnly,
  placeholder,
  initialMode = 'preview',
}: Props) {
  const isMobile = useIsMobile();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // 手机无分栏时，split 降级为 edit
  const [mode, setMode] = useState<EditorMode>(() =>
    initialMode === 'split' && isMobile ? 'edit' : initialMode
  );
  const [uploading, setUploading] = useState(false);
  const [dragOver, setDragOver] = useState(false);

  const effectiveMode: EditorMode = readOnly ? 'preview' : mode;

  const html = useMemo(
    () => renderMarkdown(value || '', { showImageDelete: !readOnly }),
    [value, readOnly]
  );

  const runTool = useCallback(
    (fn: (ta: HTMLTextAreaElement) => void) => {
      const ta = taRef.current;
      if (!ta || readOnly) return;
      fn(ta);
    },
    [readOnly]
  );

  const handleDeleteImage = useCallback(
    async (src: string) => {
      if (readOnly || !src) return;
      if (!window.confirm('从笔记中删除此图片？本地上传的文件也会一并删除。')) return;
      onChange(removeImageFromMarkdown(value, src));
      const name = uploadNameFromSrc(src);
      if (name) {
        try {
          await api.deleteUpload(name);
        } catch (e) {
          // 正文已删；文件删失败仅提示
          console.error(e);
        }
      }
    },
    [readOnly, value, onChange]
  );

  const uploadAndInsert = useCallback(
    async (file: File) => {
      if (readOnly || uploading) return;
      if (!isImageFile(file)) {
        alert('仅支持 JPEG / PNG / GIF / WebP 图片');
        return;
      }
      if (file.size > 8 * 1024 * 1024) {
        alert('图片不能超过 8MB');
        return;
      }
      setUploading(true);
      try {
        const { url } = await api.uploadImage(file);
        const alt = file.name.replace(/\.[^.]+$/, '') || 'image';
        const snippet = `![${alt}](${url})\n`;
        insertSnippet(taRef.current, value, snippet, onChange);
        // 上传后若在预览模式，切到编辑或分栏更直观；保持预览也可（内容已写入）
        if (mode === 'preview') setMode(isMobile ? 'edit' : 'split');
      } catch (e) {
        alert(e instanceof Error ? e.message : '上传失败');
      } finally {
        setUploading(false);
      }
    },
    [readOnly, uploading, value, onChange, mode, isMobile]
  );

  const tools: Tool[] = useMemo(
    () => [
      {
        title: '加粗',
        icon: <Bold className="h-4 w-4" />,
        run: (ta) => applyWrap(ta, '**', '**', '加粗文字', onChange),
      },
      {
        title: '斜体',
        icon: <Italic className="h-4 w-4" />,
        run: (ta) => applyWrap(ta, '*', '*', '斜体文字', onChange),
      },
      {
        title: '标题',
        icon: <Heading2 className="h-4 w-4" />,
        run: (ta) => applyLinePrefix(ta, '## ', onChange),
      },
      {
        title: '无序列表',
        icon: <List className="h-4 w-4" />,
        run: (ta) => applyLinePrefix(ta, '- ', onChange),
      },
      {
        title: '有序列表',
        icon: <ListOrdered className="h-4 w-4" />,
        run: (ta) => applyLinePrefix(ta, '1. ', onChange),
      },
      {
        title: '引用',
        icon: <Quote className="h-4 w-4" />,
        run: (ta) => applyLinePrefix(ta, '> ', onChange),
      },
      {
        title: '行内代码',
        icon: <Code className="h-4 w-4" />,
        run: (ta) => applyWrap(ta, '`', '`', 'code', onChange),
      },
      {
        title: '链接',
        icon: <LinkIcon className="h-4 w-4" />,
        run: (ta) => applyWrap(ta, '[', '](https://)', '链接文字', onChange),
      },
    ],
    [onChange]
  );

  function onKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      runTool((ta) => applyWrap(ta, '**', '**', '加粗文字', onChange));
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'i') {
      e.preventDefault();
      runTool((ta) => applyWrap(ta, '*', '*', '斜体文字', onChange));
    }
    if (e.key === 'Tab') {
      e.preventDefault();
      const ta = e.currentTarget;
      const start = ta.selectionStart;
      const end = ta.selectionEnd;
      const next = ta.value.slice(0, start) + '  ' + ta.value.slice(end);
      onChange(next);
      requestAnimationFrame(() => {
        ta.selectionStart = ta.selectionEnd = start + 2;
      });
    }
  }

  async function onPaste(e: ClipboardEvent<HTMLTextAreaElement>) {
    if (readOnly) return;
    const items = e.clipboardData?.items;
    if (!items) return;
    for (const item of Array.from(items)) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile();
        if (file) {
          e.preventDefault();
          await uploadAndInsert(file);
          return;
        }
      }
    }
  }

  function onDragOver(e: DragEvent) {
    if (readOnly) return;
    if ([...e.dataTransfer.types].includes('Files')) {
      e.preventDefault();
      setDragOver(true);
    }
  }

  function onDragLeave(e: DragEvent) {
    e.preventDefault();
    setDragOver(false);
  }

  async function onDrop(e: DragEvent) {
    if (readOnly) return;
    e.preventDefault();
    setDragOver(false);
    const files = Array.from(e.dataTransfer.files || []).filter(isImageFile);
    for (const f of files) {
      await uploadAndInsert(f);
    }
  }

  const showEdit = effectiveMode === 'edit' || effectiveMode === 'split';
  const showPreview = effectiveMode === 'preview' || effectiveMode === 'split';

  return (
    <div
      className={clsx(
        'relative flex h-full min-h-0 flex-col',
        dragOver && 'ring-2 ring-inset ring-brand-400'
      )}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
      onDrop={(e) => void onDrop(e)}
    >
      {dragOver && !readOnly && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center bg-brand-50/80 text-sm font-medium text-brand-700 dark:bg-brand-950/80 dark:text-brand-200">
          松开以上传图片
        </div>
      )}

      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1.5 py-1 dark:border-slate-800 dark:bg-slate-900">
          {tools.map((t) => (
            <button
              key={t.title}
              type="button"
              title={t.title}
              className="btn-ghost !rounded-md !p-2"
              onClick={() => runTool(t.run)}
            >
              {t.icon}
            </button>
          ))}
          <button
            type="button"
            title="插入图片"
            className="btn-ghost !rounded-md !p-2"
            disabled={uploading}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ImageIcon className="h-4 w-4" />
            )}
          </button>
          <input
            ref={fileRef}
            type="file"
            className="hidden"
            accept="image/jpeg,image/png,image/gif,image/webp"
            disabled={uploading}
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (f) void uploadAndInsert(f);
            }}
          />
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button
            type="button"
            title="编辑"
            className={clsx(
              'btn-ghost !rounded-md !p-2',
              effectiveMode === 'edit' && 'bg-white shadow-sm dark:bg-slate-800'
            )}
            onClick={() => setMode('edit')}
          >
            <PenLine className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="预览"
            className={clsx(
              'btn-ghost !rounded-md !p-2',
              effectiveMode === 'preview' && 'bg-white shadow-sm dark:bg-slate-800'
            )}
            onClick={() => setMode('preview')}
          >
            <Eye className="h-4 w-4" />
          </button>
          {!isMobile && (
            <button
              type="button"
              title="分栏"
              className={clsx(
                'btn-ghost !rounded-md !p-2',
                effectiveMode === 'split' && 'bg-white shadow-sm dark:bg-slate-800'
              )}
              onClick={() => setMode('split')}
            >
              <Columns2 className="h-4 w-4" />
            </button>
          )}
        </div>
      )}

      <div
        className={clsx(
          'min-h-0 flex-1',
          effectiveMode === 'split'
            ? 'grid grid-cols-2 divide-x divide-slate-200 dark:divide-slate-800'
            : 'flex'
        )}
      >
        {showEdit && (
          <textarea
            ref={taRef}
            className={clsx(
              'h-full min-h-0 w-full resize-none border-0 bg-white px-4 py-3 font-mono text-base leading-relaxed text-slate-800 outline-none placeholder:text-slate-300 dark:bg-slate-950 dark:text-slate-100 dark:placeholder:text-slate-600 sm:text-[15px]',
              // iOS：在输入框内允许纵向滑动
              '[touch-action:pan-y] [-webkit-overflow-scrolling:touch]',
              effectiveMode === 'edit' && 'flex-1'
            )}
            value={value}
            disabled={readOnly}
            placeholder={placeholder || '开始用 Markdown 书写…（可粘贴或拖入图片）'}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
            onPaste={(e) => void onPaste(e)}
          />
        )}
        {showPreview && (
          <div
            className={clsx(
              'md-preview scroll-y h-full min-h-0 px-4 py-3',
              effectiveMode === 'preview' && 'flex-1'
            )}
            dangerouslySetInnerHTML={{ __html: html || '<p class="text-slate-400">暂无内容</p>' }}
            onClick={(e) => {
              const target = e.target as HTMLElement;
              const root = e.currentTarget as HTMLElement;

              const copyBtn = target.closest('.code-copy-btn');
              if (copyBtn instanceof HTMLButtonElement) {
                e.preventDefault();
                const block = copyBtn.closest('.code-block');
                const raw = block?.querySelector(
                  'textarea.code-raw'
                ) as HTMLTextAreaElement | null;
                const text = raw?.value ?? '';
                void copyTextToClipboard(text).then((ok) => flashCopyButton(copyBtn, ok));
                return;
              }

              const delBtn = target.closest('.md-img-delete');
              if (delBtn instanceof HTMLButtonElement) {
                e.preventDefault();
                e.stopPropagation();
                const src = delBtn.getAttribute('data-src') || '';
                void handleDeleteImage(src);
                return;
              }

              // 文内锚点：#id 在预览滚动容器内平滑定位（避免改 location.hash）
              const link = target.closest('a');
              if (link instanceof HTMLAnchorElement) {
                const href = link.getAttribute('href') || '';
                if (href.startsWith('#') && href.length > 1) {
                  e.preventDefault();
                  let id = href.slice(1);
                  try {
                    id = decodeURIComponent(id);
                  } catch {
                    /* keep raw */
                  }
                  if (!id) return;
                  const el = root.querySelector(`#${CSS.escape(id)}`);
                  el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                }
              }
            }}
          />
        )}
      </div>
    </div>
  );
}
