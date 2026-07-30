import clsx from 'clsx';
import {
  BookMarked,
  GitBranch,
  LogOut,
  MessageCircle,
  Trash2,
  Settings,
  X,
} from 'lucide-react';
import type { ViewFilter } from '../types';

type Props = {
  filter: ViewFilter;
  onFilterChange: (f: ViewFilter) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  username: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

export function Sidebar({
  filter,
  onFilterChange,
  onLogout,
  onOpenSettings,
  username,
  mobileOpen = false,
  onMobileClose,
}: Props) {
  function selectFilter(f: ViewFilter) {
    onFilterChange(f);
    onMobileClose?.();
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
