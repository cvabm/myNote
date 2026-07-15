import { useMemo, useState } from 'react';
import clsx from 'clsx';
import {
  BookMarked,
  ChevronDown,
  ChevronRight,
  FolderPlus,
  LogOut,
  Plus,
  Search,
  Star,
  Tag,
  Trash2,
  FileText,
  Settings,
  X,
} from 'lucide-react';
import type { Notebook, Tag as TagType, ViewFilter } from '../types';
import { buildNotebookTree, type NotebookTreeNode } from '../utils';

type Props = {
  notebooks: Notebook[];
  tags: TagType[];
  filter: ViewFilter;
  onFilterChange: (f: ViewFilter) => void;
  onCreateNotebook: (parentId?: string | null) => void;
  onDeleteNotebook: (id: string) => void;
  onCreateNote: () => void;
  onSearch: (q: string) => void;
  onLogout: () => void;
  onOpenSettings: () => void;
  username: string;
  /** 手机端抽屉是否打开 */
  mobileOpen?: boolean;
  onMobileClose?: () => void;
};

function NotebookNode({
  node,
  depth,
  activeId,
  onSelect,
  onCreateChild,
  onDelete,
}: {
  node: NotebookTreeNode;
  depth: number;
  activeId?: string;
  onSelect: (id: string) => void;
  onCreateChild: (id: string) => void;
  onDelete: (id: string) => void;
}) {
  const [open, setOpen] = useState(true);
  const active = activeId === node.id;

  return (
    <div>
      <div
        className={clsx('sidebar-item group', active && 'sidebar-item-active')}
        style={{ paddingLeft: 10 + depth * 14 }}
      >
        <button
          type="button"
          className="shrink-0 rounded p-1 hover:bg-slate-200/70"
          onClick={() => setOpen((v) => !v)}
          aria-label={open ? '折叠' : '展开'}
        >
          {node.children.length > 0 ? (
            open ? (
              <ChevronDown className="h-3.5 w-3.5" />
            ) : (
              <ChevronRight className="h-3.5 w-3.5" />
            )
          ) : (
            <span className="inline-block w-3.5" />
          )}
        </button>
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => onSelect(node.id)}
        >
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: node.color }}
          />
          <span className="truncate">{node.name}</span>
          <span className="ml-auto text-xs text-slate-400">{node.noteCount}</span>
        </button>
        {/* 手机无 hover：始终可点；桌面仅 hover 显示 */}
        <button
          type="button"
          title="新建子笔记本"
          className="inline-flex rounded p-1 text-slate-400 hover:bg-slate-200 hover:text-slate-700 md:hidden md:group-hover:inline-flex"
          onClick={() => onCreateChild(node.id)}
        >
          <FolderPlus className="h-3.5 w-3.5" />
        </button>
        <button
          type="button"
          title="删除笔记本"
          className="inline-flex rounded p-1 text-slate-400 hover:bg-red-50 hover:text-red-600 md:hidden md:group-hover:inline-flex"
          onClick={() => onDelete(node.id)}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      {open &&
        node.children.map((child) => (
          <NotebookNode
            key={child.id}
            node={child}
            depth={depth + 1}
            activeId={activeId}
            onSelect={onSelect}
            onCreateChild={onCreateChild}
            onDelete={onDelete}
          />
        ))}
    </div>
  );
}

export function Sidebar({
  notebooks,
  tags,
  filter,
  onFilterChange,
  onCreateNotebook,
  onDeleteNotebook,
  onCreateNote,
  onSearch,
  onLogout,
  onOpenSettings,
  username,
  mobileOpen = false,
  onMobileClose,
}: Props) {
  const [q, setQ] = useState('');
  const tree = useMemo(() => buildNotebookTree(notebooks), [notebooks]);
  const activeNotebookId = filter.type === 'notebook' ? filter.id : undefined;

  function selectFilter(f: ViewFilter) {
    onFilterChange(f);
    onMobileClose?.();
  }

  return (
    <aside
      className={clsx(
        'flex h-full w-[min(18rem,85vw)] shrink-0 flex-col border-r border-slate-200 bg-white',
        // 手机：左侧抽屉；桌面：静态侧栏
        'fixed inset-y-0 left-0 z-50 transition-transform duration-200 ease-out',
        'md:static md:z-auto md:w-64 md:max-w-none md:translate-x-0',
        mobileOpen ? 'translate-x-0 shadow-2xl' : '-translate-x-full md:translate-x-0 md:shadow-none'
      )}
    >
      <div className="flex items-center gap-2 border-b border-slate-100 px-4 py-3 safe-pt">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand-600 text-white">
          <BookMarked className="h-4 w-4" />
        </div>
        <div className="min-w-0">
          <div className="truncate text-sm font-semibold text-slate-800">MyNote</div>
          <div className="truncate text-xs text-slate-400">{username}</div>
        </div>
        <button
          type="button"
          className="btn-ghost ml-auto !p-2"
          onClick={() => {
            onCreateNote();
            onMobileClose?.();
          }}
          title="新建笔记"
        >
          <Plus className="h-4 w-4" />
        </button>
        <button
          type="button"
          className="btn-ghost !p-2 md:hidden"
          onClick={onMobileClose}
          title="关闭菜单"
          aria-label="关闭菜单"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="border-b border-slate-100 p-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-400" />
          <input
            className="input py-2 pl-8 text-sm md:py-1.5 md:text-xs"
            placeholder="搜索笔记…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                onSearch(q.trim());
                onMobileClose?.();
              }
            }}
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto overscroll-contain p-2">
        <div className="mb-1 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
          浏览
        </div>
        <button
          type="button"
          className={clsx('sidebar-item', filter.type === 'all' && 'sidebar-item-active')}
          onClick={() => selectFilter({ type: 'all' })}
        >
          <FileText className="h-4 w-4" />
          全部笔记
        </button>
        <button
          type="button"
          className={clsx('sidebar-item', filter.type === 'favorite' && 'sidebar-item-active')}
          onClick={() => selectFilter({ type: 'favorite' })}
        >
          <Star className="h-4 w-4" />
          收藏
        </button>
        <button
          type="button"
          className={clsx('sidebar-item', filter.type === 'trash' && 'sidebar-item-active')}
          onClick={() => selectFilter({ type: 'trash' })}
        >
          <Trash2 className="h-4 w-4" />
          回收站
        </button>

        <div className="mb-1 mt-4 flex items-center justify-between px-2">
          <span className="text-[11px] font-semibold uppercase tracking-wide text-slate-400">
            笔记本
          </span>
          <button
            type="button"
            className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700"
            title="新建笔记本"
            onClick={() => onCreateNotebook(null)}
          >
            <Plus className="h-3.5 w-3.5" />
          </button>
        </div>
        {tree.length === 0 && (
          <div className="px-2.5 py-2 text-xs text-slate-400">暂无笔记本</div>
        )}
        {tree.map((node) => (
          <NotebookNode
            key={node.id}
            node={node}
            depth={0}
            activeId={activeNotebookId}
            onSelect={(id) => selectFilter({ type: 'notebook', id })}
            onCreateChild={(id) => onCreateNotebook(id)}
            onDelete={onDeleteNotebook}
          />
        ))}

        {tags.length > 0 && (
          <>
            <div className="mb-1 mt-4 px-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
              标签
            </div>
            {tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={clsx(
                  'sidebar-item',
                  filter.type === 'tag' && filter.id === tag.id && 'sidebar-item-active'
                )}
                onClick={() => selectFilter({ type: 'tag', id: tag.id })}
              >
                <Tag className="h-4 w-4" style={{ color: tag.color }} />
                <span className="truncate">{tag.name}</span>
                <span className="ml-auto text-xs text-slate-400">{tag.noteCount ?? 0}</span>
              </button>
            ))}
          </>
        )}
      </div>

      <div className="flex items-center gap-1 border-t border-slate-100 p-2 safe-pb">
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
