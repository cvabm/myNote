import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes } from 'react';
import {
  FileUp,
  FolderOpen,
  Laptop,
  Loader2,
  LogOut,
  Monitor,
  Moon,
  RefreshCw,
  Smartphone,
  Sun,
  Tablet,
  Trash2,
  X,
} from 'lucide-react';
import clsx from 'clsx';
import { api, setToken } from '../api';
import { useTheme, type ThemePreference } from '../context/ThemeContext';
import type { LoginSession } from '../types';
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
  const [logoutMsg, setLogoutMsg] = useState('');
  const [logoutErr, setLogoutErr] = useState('');
  const [logoutLoading, setLogoutLoading] = useState(false);
  const [sessions, setSessions] = useState<LoginSession[]>([]);
  const [sessionsLoading, setSessionsLoading] = useState(false);
  const [sessionsErr, setSessionsErr] = useState('');
  const [revokingId, setRevokingId] = useState<string | null>(null);

  const [skipEmpty, setSkipEmpty] = useState(true);
  const [importing, setImporting] = useState(false);
  const [progress, setProgress] = useState({ done: 0, total: 0, current: '' });
  const [importLog, setImportLog] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);

  async function loadSessions() {
    setSessionsErr('');
    setSessionsLoading(true);
    try {
      const res = await api.listSessions();
      setSessions(res.items);
    } catch (e) {
      setSessionsErr(e instanceof Error ? e.message : '加载设备列表失败');
    } finally {
      setSessionsLoading(false);
    }
  }

  useEffect(() => {
    if (!open) return;
    void loadSessions();
  }, [open]);

  if (!open) return null;

  function formatTime(isoLike: string) {
    // sqlite: 2026-07-29 12:00:00
    const d = new Date(isoLike.includes('T') ? isoLike : isoLike.replace(' ', 'T') + 'Z');
    if (Number.isNaN(d.getTime())) return isoLike;
    return d.toLocaleString('zh-CN', {
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    });
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setMsg('');
    setErr('');
    setLoading(true);
    try {
      const res = await api.changePassword(oldPassword, newPassword);
      // 服务端已 bump token_version：旧设备 JWT 失效；本机换新 token
      if (res.token) setToken(res.token);
      setMsg('密码已修改，其它设备的登录已全部失效');
      setOldPassword('');
      setNewPassword('');
      void loadSessions();
    } catch (error) {
      setErr(error instanceof Error ? error.message : '修改失败');
    } finally {
      setLoading(false);
    }
  }

  async function onLogoutOthers() {
    setLogoutMsg('');
    setLogoutErr('');
    if (!window.confirm('使其它设备上的登录全部失效？（本机保持登录）')) return;
    setLogoutLoading(true);
    try {
      const res = await api.logoutAll(true);
      if (res.token) setToken(res.token);
      setLogoutMsg('已退出其它设备登录');
      void loadSessions();
    } catch (error) {
      setLogoutErr(error instanceof Error ? error.message : '操作失败');
    } finally {
      setLogoutLoading(false);
    }
  }

  async function onLogoutEverywhere() {
    setLogoutMsg('');
    setLogoutErr('');
    if (!window.confirm('退出全部设备（包括本机）？需要重新登录。')) return;
    setLogoutLoading(true);
    try {
      await api.logoutAll(false);
      setToken(null);
      window.location.reload();
    } catch (error) {
      setLogoutErr(error instanceof Error ? error.message : '操作失败');
      setLogoutLoading(false);
    }
  }

  async function onRevokeSession(s: LoginSession) {
    if (s.current) return;
    if (!window.confirm(`退出设备「${s.deviceLabel}」？`)) return;
    setRevokingId(s.id);
    setLogoutErr('');
    try {
      await api.revokeSession(s.id);
      setLogoutMsg(`已踢下线：${s.deviceLabel}`);
      await loadSessions();
    } catch (e) {
      setLogoutErr(e instanceof Error ? e.message : '操作失败');
    } finally {
      setRevokingId(null);
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
        flat: true,
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

        <div className="scroll-y flex-1 space-y-6 p-5">
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
              从 Flatnotes 或其它应用导出的 .md 导入。文件将作为全局笔记导入（无笔记本）；可在思维导图中浏览。
            </p>

            <div className="mb-3 space-y-2 text-sm text-slate-600 dark:text-slate-300">
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
              首次部署后请立即更换默认密码。改密后其它设备登录会全部失效。
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

          <hr className="border-slate-100 dark:border-slate-800" />

          {/* 登录设备 */}
          <section>
            <div className="mb-1 flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                登录设备
              </h3>
              <button
                type="button"
                className="btn-ghost !p-1.5"
                title="刷新列表"
                disabled={sessionsLoading || importing}
                onClick={() => void loadSessions()}
              >
                <RefreshCw
                  className={clsx('h-3.5 w-3.5', sessionsLoading && 'animate-spin')}
                />
              </button>
            </div>
            <p className="mb-3 text-xs leading-relaxed text-slate-500 dark:text-slate-400">
              显示当前有效登录。可踢掉单台设备，或一键退出其它/全部。
              登录失败超过 10 次（15 分钟）会临时锁定。
              列表在重新登录后才会出现；旧 token 需重新登录一次。
            </p>

            <div className="mb-3 max-h-72 space-y-2 overflow-y-auto">
              {sessionsLoading && sessions.length === 0 ? (
                <div className="flex items-center gap-2 py-4 text-xs text-slate-400">
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                  加载中…
                </div>
              ) : sessions.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 px-3 py-4 text-center text-xs text-slate-400 dark:border-slate-700">
                  暂无会话记录。请退出后重新登录一次，即可在此看到本机。
                </div>
              ) : (
                sessions.map((s) => {
                  const DeviceIcon =
                    s.deviceType === 'mobile'
                      ? Smartphone
                      : s.deviceType === 'tablet'
                        ? Tablet
                        : Laptop;
                  const detailBits = [
                    s.browser &&
                      (s.browserVersion
                        ? `${s.browser} ${s.browserVersion.split('.').slice(0, 2).join('.')}`
                        : s.browser),
                    s.os && (s.osVersion ? `${s.os} ${s.osVersion}` : s.os),
                    s.engine && `引擎 ${s.engine}`,
                    s.platform && `平台 ${s.platform}`,
                    s.screen && `屏幕 ${s.screen}`,
                    s.devicePixelRatio != null && s.devicePixelRatio > 0
                      ? `DPR ${s.devicePixelRatio}`
                      : null,
                    s.language && `语言 ${s.language}`,
                    s.timezone && s.timezone,
                    s.hardwareConcurrency != null
                      ? `${s.hardwareConcurrency} 核`
                      : null,
                    s.deviceMemory != null ? `${s.deviceMemory} GB 内存` : null,
                    s.maxTouchPoints != null && s.maxTouchPoints > 0
                      ? `触点 ${s.maxTouchPoints}`
                      : null,
                  ].filter(Boolean) as string[];

                  return (
                    <div
                      key={s.id}
                      className={clsx(
                        'flex items-start gap-2 rounded-xl border px-3 py-2.5',
                        s.current
                          ? 'border-indigo-200 bg-indigo-50/80 dark:border-indigo-500/30 dark:bg-indigo-500/10'
                          : 'border-slate-200 dark:border-slate-700'
                      )}
                    >
                      <DeviceIcon className="mt-0.5 h-4 w-4 shrink-0 text-slate-400" />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-1.5 text-sm font-medium text-slate-800 dark:text-slate-100">
                          <span className="truncate">{s.deviceLabel}</span>
                          {s.current && (
                            <span className="rounded-full bg-indigo-100 px-1.5 py-0.5 text-[10px] font-medium text-indigo-700 dark:bg-indigo-500/20 dark:text-indigo-300">
                              本机
                            </span>
                          )}
                          {s.deviceType && s.deviceType !== 'unknown' && (
                            <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">
                              {s.deviceType === 'mobile'
                                ? '手机'
                                : s.deviceType === 'tablet'
                                  ? '平板'
                                  : '电脑'}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11px] text-slate-500 dark:text-slate-400">
                          最近活跃 {formatTime(s.lastSeenAt)}
                          {' · '}
                          登录 {formatTime(s.createdAt)}
                        </div>
                        {detailBits.length > 0 && (
                          <div className="mt-1 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400">
                            {detailBits.join(' · ')}
                          </div>
                        )}
                        {s.userAgent && (
                          <p className="mt-1 break-all text-[10px] leading-snug text-slate-400">
                            {s.userAgent}
                          </p>
                        )}
                      </div>
                      {!s.current && (
                        <button
                          type="button"
                          className="btn-ghost shrink-0 !p-1.5 text-red-500"
                          title="踢下线"
                          disabled={revokingId === s.id || logoutLoading || importing}
                          onClick={() => void onRevokeSession(s)}
                        >
                          {revokingId === s.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Trash2 className="h-3.5 w-3.5" />
                          )}
                        </button>
                      )}
                    </div>
                  );
                })
              )}
            </div>

            {sessionsErr && (
              <div className="mb-2 text-sm text-red-600">{sessionsErr}</div>
            )}

            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-ghost border border-slate-200 dark:border-slate-700"
                disabled={logoutLoading || importing}
                onClick={() => void onLogoutOthers()}
              >
                <LogOut className="h-4 w-4" />
                {logoutLoading ? '处理中…' : '退出其它设备'}
              </button>
              <button
                type="button"
                className="btn-ghost border border-red-200 text-red-600 hover:bg-red-50 dark:border-red-900/50 dark:text-red-400 dark:hover:bg-red-950/40"
                disabled={logoutLoading || importing}
                onClick={() => void onLogoutEverywhere()}
              >
                退出全部（含本机）
              </button>
            </div>
            {logoutMsg && <div className="mt-2 text-sm text-emerald-600">{logoutMsg}</div>}
            {logoutErr && <div className="mt-2 text-sm text-red-600">{logoutErr}</div>}
          </section>
        </div>
      </div>
    </div>
  );
}
