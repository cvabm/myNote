import { useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import { FileUp, FolderOpen, Loader2, Monitor, Moon, Sun, X } from 'lucide-react';
import clsx from 'clsx';
import { api } from '../api';
import { useTheme, type ThemePreference } from '../context/ThemeContext';
import { filesToImportList, importMarkdownFiles } from '../utils/importMd';

type Props = {
  open: boolean;
  onClose: () => void;
  /** 导入成功后刷新侧栏/列表 */
  onImported?: () => void;
};

const THEME_OPTIONS: { id: ThemePreference; label: string; icon: typeof Sun }[] = [
  { id: 'light', label: '浅色', icon: Sun },
  { id: 'dark', label: '深色', icon: Moon },
  { id: 'system', label: '跟随系统', icon: Monitor },
];

export function SettingsModal({ open, onClose, onImported }: Props) {
  const { preference, setPreference } = useTheme();
  const [oldPassword, setOldPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [msg, setMsg] = useState('');
  const [err, setErr] = useState('');
  const [loading, setLoading] = useState(false);

  const [flat, setFlat] = useState(false);
  const [skipEmpty, setSkipEmpty] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [importLog, setImportLog] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  if (!open) return null;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    setLoading(true);
    try {
      await api.changePassword(oldPassword, newPassword);
      setMsg('密码已修改');
      setOldPassword('');
      setNewPassword('');
    } catch (error) {
      setErr(error instanceof Error ? error.message : '修改失败');
    } finally {
      setLoading(false);
    }
  }

  async function handleFiles(fileList: FileList | null) {
    if (!fileList || fileList.length === 0) return;
    setImportLog('');
    setImporting(true);
    setProgress({ done: 0, total: 0, current: '读取文件…' });
    try {
      const items = await filesToImportList(fileList);
      if (items.length === 0) {
        setImportLog('未找到 .md / .markdown 文件');
        return;
      }
      const result = await importMarkdownFiles(items, {
        flat,
        skipEmpty,
        onProgress: (done, total, current) => setProgress({ done, total, current }),
      });
      const lines = [
        `完成：成功 ${result.ok}，跳过 ${result.skip}，失败 ${result.fail}`,
        ...result.errors.slice(0, 8),
      ];
      if (result.errors.length > 8) {
        lines.push(`…另有 ${result.errors.length - 8} 条错误未显示`);
      }
      setImportLog(lines.join('\n'));
      if (result.ok > 0) onImported?.();
    } catch (e) {
      setImportLog(e instanceof Error ? e.message : '导入失败');
    } finally {
      setImporting(false);
      if (fileRef.current) fileRef.current.value = '';
      if (folderRef.current) folderRef.current.value = '';
    }
  }

  const pct =
    progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <div className="fixed inset-0 z-[60] flex items-end justify-center bg-slate-900/50 p-0 sm:items-center sm:p-4">
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="关闭"
        onClick={onClose}
        disabled={importing}
      />
      <div className="relative z-10 flex max-h-[90dvh] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-2xl safe-pb dark:bg-slate-900 sm:rounded-2xl">
        <div className="flex shrink-0 items-center justify-between border-b border-slate-100 px-5 py-3 dark:border-slate-800">
          <h2 className="text-base font-semibold text-slate-900 dark:text-slate-100">设置</h2>
          <button
            type="button"
            className="btn-ghost !p-2"
            onClick={onClose}
            disabled={importing}
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-6 overflow-y-auto overscroll-contain p-5">
          {/* 外观 */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">外观</h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              选择浅色、深色，或跟随系统
            </p>
            <div className="grid grid-cols-3 gap-2">
              {THEME_OPTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  disabled={importing}
                  onClick={() => setPreference(id)}
                  className={clsx(
                    'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-xs font-medium transition',
                    preference === id
                      ? 'border-brand-500 bg-brand-50 text-brand-700 dark:border-brand-400 dark:bg-brand-500/15 dark:text-brand-300'
                      : 'border-slate-200 text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800'
                  )}
                >
                  <Icon className="h-4 w-4" />
                  {label}
                </button>
              ))}
            </div>
          </section>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* 导入 Markdown */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              导入 Markdown
            </h3>
            <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              从 Flatnotes 或其它应用导出的 .md 文件导入。选择文件夹时，子目录会建成笔记本；也可只选多个文件。
            </p>

            <div className="mb-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 dark:border-slate-600"
                  checked={flat}
                  disabled={importing}
                  onChange={(e) => setFlat(e.target.checked)}
                />
                全部放进「未分类」（不按文件夹建笔记本）
              </label>
              <label className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  className="rounded border-slate-300 dark:border-slate-600"
                  checked={skipEmpty}
                  disabled={importing}
                  onChange={(e) => setSkipEmpty(e.target.checked)}
                />
                跳过空文件
              </label>
            </div>

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={importing}
                onClick={() => folderRef.current?.click()}
              >
                <FolderOpen className="h-4 w-4" />
                选择文件夹
              </button>
              <button
                type="button"
                className="btn-ghost border border-slate-200 dark:border-slate-700"
                disabled={importing}
                onClick={() => fileRef.current?.click()}
              >
                <FileUp className="h-4 w-4" />
                选择 .md 文件
              </button>
            </div>

            <input
              ref={fileRef}
              type="file"
              className="hidden"
              accept=".md,.markdown,text/markdown"
              multiple
              disabled={importing}
              onChange={(e) => void handleFiles(e.target.files)}
            />
            <input
              ref={folderRef}
              type="file"
              className="hidden"
              accept=".md,.markdown,text/markdown"
              multiple
              // 浏览器选文件夹（Chrome / Edge / Safari）
              {...({
                webkitdirectory: '',
                directory: '',
              } as InputHTMLAttributes<HTMLInputElement>)}
              disabled={importing}
              onChange={(e) => void handleFiles(e.target.files)}
            />

            {importing && (
              <div className="mt-4 rounded-xl border border-slate-100 bg-slate-50 p-3 dark:border-slate-700 dark:bg-slate-800/50">
                <div className="mb-2 flex items-center gap-2 text-sm text-slate-600 dark:text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin text-brand-600" />
                  正在导入 {progress.done}/{progress.total || '…'}
                  {progress.total > 0 ? `（${pct}%）` : ''}
                </div>
                <div className="mb-2 h-1.5 overflow-hidden rounded-full bg-slate-200 dark:bg-slate-700">
                  <div
                    className="h-full rounded-full bg-brand-600 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                <p className="truncate text-xs text-slate-400">{progress.current}</p>
              </div>
            )}

            {importLog && !importing && (
              <pre className="mt-3 max-h-32 overflow-y-auto whitespace-pre-wrap rounded-xl bg-slate-50 p-3 text-xs text-slate-600 dark:bg-slate-800/50 dark:text-slate-300">
                {importLog}
              </pre>
            )}
          </section>

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* 改密 */}
          <section>
            <h3 className="mb-1 text-sm font-semibold text-slate-800 dark:text-slate-100">
              修改密码
            </h3>
            <p className="mb-3 text-xs text-slate-500 dark:text-slate-400">
              首次部署后请立即更换默认密码
            </p>
            <form onSubmit={onSubmit} className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">原密码</span>
                <input
                  type="password"
                  className="input text-base sm:text-sm"
                  value={oldPassword}
                  onChange={(e) => setOldPassword(e.target.value)}
                  required
                  disabled={importing}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs text-slate-500">新密码（至少 6 位）</span>
                <input
                  type="password"
                  className="input text-base sm:text-sm"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  minLength={6}
                  required
                  disabled={importing}
                />
              </label>
              {msg && <div className="text-sm text-emerald-600">{msg}</div>}
              {err && <div className="text-sm text-red-600">{err}</div>}
              <button
                type="submit"
                className="btn-primary w-full sm:w-auto"
                disabled={loading || importing}
              >
                {loading ? '保存中…' : '保存密码'}
              </button>
            </form>
          </section>
        </div>
      </div>
    </div>
  );
}
