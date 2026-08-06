import { useCallback, useEffect, useRef, useState } from 'react';
import { AppWindow, ExternalLink, Menu } from 'lucide-react';
import { api } from '../api';
import { formatRelativeTime } from '../utils';
import { MarkdownEditor } from './MarkdownEditor';

type Props = {
  onOpenSidebar?: () => void;
};

export function SoftwarePage({ onOpenSidebar }: Props) {
  const [content, setContent] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pending = useRef<string | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    api
      .getSoftware()
      .then((page) => {
        if (cancelled) return;
        setContent(page.content);
        setUpdatedAt(page.updatedAt);
        setError('');
      })
      .catch((e) => {
        if (!cancelled) setError(e instanceof Error ? e.message : '加载失败');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const flushSave = useCallback(async () => {
    if (inFlight.current) return;
    if (pending.current === null) return;
    const next = pending.current;
    pending.current = null;
    inFlight.current = true;
    setSaving(true);
    try {
      const page = await api.saveSoftware(next);
      setUpdatedAt(page.updatedAt);
    } catch (e) {
      pending.current = pending.current ?? next;
      alert(e instanceof Error ? e.message : '保存失败');
    } finally {
      inFlight.current = false;
      setSaving(false);
    }
    if (pending.current !== null) void flushSave();
  }, []);

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pending.current !== null) void api.saveSoftware(pending.current).catch(console.error);
    };
  }, []);

  function handleChange(value: string) {
    setContent(value);
    pending.current = value;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void flushSave();
    }, 500);
  }

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-200 px-2 py-2 safe-pt sm:px-4 dark:border-slate-800">
        <button
          type="button"
          className="btn-ghost !p-2 md:hidden"
          onClick={onOpenSidebar}
          title="打开菜单"
          aria-label="打开菜单"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          <AppWindow className="h-4 w-4" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            软件推荐
          </div>
          <div className="truncate text-xs text-slate-400">
            {saving
              ? '保存中…'
              : updatedAt
                ? `已保存 · ${formatRelativeTime(updatedAt)}`
                : '登录后自动保存，对外页只读渲染'}
          </div>
        </div>
        <a
          className="btn-ghost shrink-0 !px-2 !py-2 text-xs"
          href="/software.html"
          target="_blank"
          rel="noreferrer"
          title="打开对外只读页"
        >
          <ExternalLink className="h-4 w-4" />
          <span className="hidden sm:inline">对外页</span>
        </a>
      </div>

      <p className="border-b border-slate-100 px-3 py-2 text-xs leading-5 text-slate-500 dark:border-slate-800 dark:text-slate-400 sm:px-4">
        用 Markdown 写清单。一级标题
        <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800"># Windows</code>
        /
        <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800"># Android</code>
        会变成对外页顶栏，二级标题
        <code className="mx-1 rounded bg-slate-100 px-1 dark:bg-slate-800">## 常用</code>
        是分类。
      </p>

      {loading ? (
        <div className="flex flex-1 items-center justify-center text-sm text-slate-400">
          加载中…
        </div>
      ) : error ? (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-rose-500">
          {error}
        </div>
      ) : (
        <div className="min-h-0 flex-1">
          <MarkdownEditor
            value={content}
            onChange={handleChange}
            initialMode="split"
            placeholder={'# Windows\n\n## 常用\n- [软件名](https://example.com) 备注'}
          />
        </div>
      )}
    </div>
  );
}
