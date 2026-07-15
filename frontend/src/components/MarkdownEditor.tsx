import { useCallback, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import clsx from 'clsx';
import { marked } from 'marked';
import {
  Bold,
  Code,
  Columns2,
  Eye,
  Heading2,
  Italic,
  Link as LinkIcon,
  List,
  ListOrdered,
  PenLine,
  Quote,
} from 'lucide-react';
import { useIsMobile } from '../hooks/useMediaQuery';

export type EditorMode = 'edit' | 'preview' | 'split';

type Props = {
  value: string;
  onChange: (value: string) => void;
  readOnly?: boolean;
  placeholder?: string;
};

marked.setOptions({
  gfm: true,
  breaks: true,
});

function escapeHtml(s: string) {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 基础消毒：去掉 script / on* 事件，保留常见 Markdown 标签 */
function sanitizeHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

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

export function MarkdownEditor({ value, onChange, readOnly, placeholder }: Props) {
  const isMobile = useIsMobile();
  const taRef = useRef<HTMLTextAreaElement>(null);
  const [mode, setMode] = useState<EditorMode>(readOnly ? 'preview' : isMobile ? 'edit' : 'split');

  // 只读时强制预览
  const effectiveMode: EditorMode = readOnly ? 'preview' : mode;

  const html = useMemo(() => {
    try {
      const raw = marked.parse(value || '', { async: false }) as string;
      return sanitizeHtml(raw);
    } catch {
      return `<pre>${escapeHtml(value || '')}</pre>`;
    }
  }, [value]);

  const runTool = useCallback(
    (fn: (ta: HTMLTextAreaElement) => void) => {
      const ta = taRef.current;
      if (!ta || readOnly) return;
      fn(ta);
    },
    [readOnly]
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

  const showEdit = effectiveMode === 'edit' || effectiveMode === 'split';
  const showPreview = effectiveMode === 'preview' || effectiveMode === 'split';

  return (
    <div className="flex h-full min-h-0 flex-col">
      {!readOnly && (
        <div className="flex flex-wrap items-center gap-0.5 border-b border-slate-200 bg-slate-50 px-1.5 py-1">
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
          <span className="mx-1 h-5 w-px bg-slate-200" />
          <button
            type="button"
            title="编辑"
            className={clsx('btn-ghost !rounded-md !p-2', effectiveMode === 'edit' && 'bg-white shadow-sm')}
            onClick={() => setMode('edit')}
          >
            <PenLine className="h-4 w-4" />
          </button>
          <button
            type="button"
            title="预览"
            className={clsx(
              'btn-ghost !rounded-md !p-2',
              effectiveMode === 'preview' && 'bg-white shadow-sm'
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
                effectiveMode === 'split' && 'bg-white shadow-sm'
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
          effectiveMode === 'split' ? 'grid grid-cols-2 divide-x divide-slate-200' : 'flex'
        )}
      >
        {showEdit && (
          <textarea
            ref={taRef}
            className={clsx(
              'h-full min-h-0 w-full resize-none border-0 bg-white px-4 py-3 font-mono text-base leading-relaxed text-slate-800 outline-none placeholder:text-slate-300 sm:text-[15px]',
              effectiveMode === 'edit' && 'flex-1'
            )}
            value={value}
            disabled={readOnly}
            placeholder={placeholder || '开始用 Markdown 书写…'}
            spellCheck={false}
            onChange={(e) => onChange(e.target.value)}
            onKeyDown={onKeyDown}
          />
        )}
        {showPreview && (
          <div
            className={clsx(
              'md-preview h-full min-h-0 overflow-y-auto overscroll-contain px-4 py-3',
              effectiveMode === 'preview' && 'flex-1'
            )}
            // 内容来自本人笔记 + 基础消毒
            dangerouslySetInnerHTML={{ __html: html || '<p class="text-slate-400">暂无内容</p>' }}
          />
        )}
      </div>
    </div>
  );
}
