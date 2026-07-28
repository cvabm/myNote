import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  BookMarked,
  GitBranch,
  LogOut,
  MessageCircle,
  Search,
  Trash2,
  Settings,
  X,
} from 'lucide-react';
import type { ViewFilter } from '../types';

type Props = {
  filter: ViewFilter;
  onFilterChange: (f: ViewFilter) => void;
  /** 仅说说视图使用 */
  onSearch: (q: string) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  username: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  searching?: boolean;
};

export function Sidebar({
  filter,
  onFilterChange,
  onSearch,
  onLogout,
  onOpenSettings,
  username,
  mobileOpen = false,
  onMobileClose,
  searching = false,
}: Props) {
  const isMomentsView = filter.type === 'moments';
  const [q, setQ] = useState(isMomentsView && filter.q ? filter.q : '');
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isSearchingMoments = isMomentsView && !!filter.q?.trim();

  useEffect(() => {
    if (filter.type === 'moments') {
      setQ(filter.q || '');
      return;
    }
    setQ('');
  }, [filter]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  function selectFilter(f: ViewFilter) {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setQ('');
    onFilterChange(f);
    onMobileClose?.();
  }

  function handleSearchInput(value: string) {
    if (!isMomentsView) return;
    setQ(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const delay = value.trim() ? 220 : 0;
    searchTimer.current = setTimeout(() => {
      onSearch(value.trim());
    }, delay);
  }

  function clearSearch() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setQ('');
    onSearch('');
  }

  return (
    <aside
      className={clsx(
        'flex h-full min-h-0 w-[min(18rem,85vw)] shrink-0 flex-col border-r border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-950',
        'fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out',
        'md:static md:z-auto md:w-64 md:max-w-none md:translate-x-0',
        mobileOpen
          ? 'translate-x-0 shadow-2xl'
          : '-translate-x-full pointer-events-none md:pointer-events-auto md:translate-x-0 md:shadow-none'
      )}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 safe-pt dark:border-slate-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <BookMarked className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800 dark:text-slate-100">
            MyNote
          </div>
          <div className="truncate text-xs text-slate-400">{username}</div>
        </div>
        <button
          type="button"
          className="btn-ghost ml-auto !p-2 md:hidden"
          onClick={onMobileClose}
          title="关闭菜单"
          aria-label="关闭菜单"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {isMomentsView && (
        <div className="border-b border-slate-100 p-3 dark:border-slate-800" data-search-box>
          <div className="relative">
            <Search
              className={clsx(
                'absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2',
                searching ? 'animate-pulse text-brand-500' : 'text-slate-400'
              )}
            />
            <input
              className="input py-2 pl-8 pr-8 text-sm md:py-1.5 md:text-xs"
              placeholder="搜索说说…"
              value={q}
              onChange={(e) => handleSearchInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  clearSearch();
                  (e.target as HTMLInputElement).blur();
                }
              }}
              enterKeyHint="search"
              autoComplete="off"
              spellCheck={false}
            />
            {q && (
              <button
                type="button"
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800 dark:hover:text-slate-200"
                onClick={clearSearch}
                title="清除搜索"
                aria-label="清除搜索"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
          {isSearchingMoments && (
            <div className="mt-1.5 px-0.5 text-[11px] text-slate-400">
              {searching ? '正在搜索…' : `匹配 “${filter.q}” 的说说已显示`}
            </div>
          )}
        </div>
      )}

      <div className="scroll-y flex-1 p-2">
        <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          浏览
        </div>
        <button
          type="button"
          className={clsx(
            'sidebar-item',
            (filter.type === 'mindmap' ||
              filter.type === 'globe' ||
              filter.type === 'all' ||
              filter.type === 'notebook' ||
              filter.type === 'search') &&
              'sidebar-item-active'
          )}
          onClick={() => selectFilter({ type: 'mindmap' })}
        >
          <GitBranch className="h-4 w-4" />
          思维导图
        </button>
        <button
          type="button"
          className={clsx('sidebar-item', filter.type === 'moments' && 'sidebar-item-active')}
          onClick={() => selectFilter({ type: 'moments' })}
        >
          <MessageCircle className="h-4 w-4" />
          说说
        </button>
        <button
          type="button"
          className={clsx('sidebar-item', filter.type === 'trash' && 'sidebar-item-active')}
          onClick={() => selectFilter({ type: 'trash' })}
        >
          <Trash2 className="h-4 w-4" />
          回收站
        </button>
      </div>

      <div className="flex items-center gap-1 border-t border-slate-100 p-2 safe-pb dark:border-slate-800">
        <button type="button" className="btn-ghost flex-1 justify-start" onClick={onOpenSettings}>
          <Settings className="h-4 w-4" />
          设置
        </button>
        <button type="button" className="btn-ghost !p-2" onClick={onLogout} title="退出登录">
          <LogOut className="h-4 w-4" />
        </button>
      </div>
    </aside>
  );
}
