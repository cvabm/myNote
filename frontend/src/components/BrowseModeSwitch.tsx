import clsx from 'clsx';
import { GitBranch, ListTree } from 'lucide-react';

export type BrowseMode = 'catalog' | 'mindmap';

type Props = {
  mode: BrowseMode;
  onChange: (mode: BrowseMode) => void;
};

export function BrowseModeSwitch({ mode, onChange }: Props) {
  return (
    <div
      className="flex shrink-0 rounded-lg bg-slate-100 p-0.5 text-xs dark:bg-slate-800"
      role="group"
      aria-label="笔记浏览方式"
    >
      <button
        type="button"
        className={clsx(
          'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition',
          mode === 'catalog'
            ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
        )}
        aria-pressed={mode === 'catalog'}
        onClick={() => onChange('catalog')}
      >
        <ListTree className="h-3.5 w-3.5" />
        目录
      </button>
      <button
        type="button"
        className={clsx(
          'inline-flex items-center gap-1 rounded-md px-2 py-1 font-medium transition',
          mode === 'mindmap'
            ? 'bg-white text-slate-800 shadow-sm dark:bg-slate-700 dark:text-slate-100'
            : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
        )}
        aria-pressed={mode === 'mindmap'}
        onClick={() => onChange('mindmap')}
      >
        <GitBranch className="h-3.5 w-3.5" />
        导图
      </button>
    </div>
  );
}
