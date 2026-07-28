import type { ViewFilter } from '../types';

/** 与地址栏同步的视图状态，刷新 / 分享链接可恢复 */
export type ViewRouteState = {
  filter: ViewFilter;
  selectedId: string | null;
};

function safeDecode(v: string | null): string {
  if (!v) return '';
  try {
    return decodeURIComponent(v);
  } catch {
    return v;
  }
}

/** 从当前 URL 读取视图（search params） */
export function readViewRoute(search = window.location.search): ViewRouteState {
  const params = new URLSearchParams(search);
  const note = params.get('note')?.trim() || null;
  const v = (params.get('v') || 'mindmap').trim();
  const q = safeDecode(params.get('q')).trim();

  switch (v) {
    case 'trash':
      return { filter: { type: 'trash' }, selectedId: note };
    case 'moments':
      return {
        filter: q ? { type: 'moments', q } : { type: 'moments' },
        selectedId: null,
      };
    case 'globe':
    case 'mindmap':
    case 'all':
    case 'search':
    case 'notebook':
    case 'favorite':
    default:
      // 默认 / 旧全部笔记、搜索、笔记本等 → 思维导图
      return { filter: { type: 'mindmap' }, selectedId: note };
  }
}

/** 将视图状态写入地址栏 */
export function writeViewRoute(
  state: ViewRouteState,
  mode: 'push' | 'replace' = 'replace'
): void {
  const params = new URLSearchParams();
  const { filter, selectedId } = state;

  switch (filter.type) {
    case 'trash':
      params.set('v', 'trash');
      break;
    case 'moments':
      params.set('v', 'moments');
      if (filter.q?.trim()) params.set('q', filter.q.trim());
      break;
    case 'globe':
    case 'mindmap':
    case 'all':
    case 'search':
    case 'notebook':
    default:
      params.set('v', 'mindmap');
      break;
  }

  if (selectedId && filter.type !== 'moments') {
    params.set('note', selectedId);
  }

  const qs = params.toString();
  const next = qs ? `${window.location.pathname}?${qs}` : window.location.pathname;
  const cur = `${window.location.pathname}${window.location.search}`;
  if (cur === next) return;

  if (mode === 'push') {
    window.history.pushState(null, '', next);
  } else {
    window.history.replaceState(null, '', next);
  }
}

/** 比较两个视图状态是否等价（避免无意义写 URL） */
export function viewRouteEqual(a: ViewRouteState, b: ViewRouteState): boolean {
  if (a.selectedId !== b.selectedId) return false;
  if (a.filter.type !== b.filter.type) return false;
  if (a.filter.type === 'moments' && b.filter.type === 'moments') {
    return (a.filter.q || '') === (b.filter.q || '');
  }
  return true;
}
