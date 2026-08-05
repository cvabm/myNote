import type { ReactNode } from 'react';
import { createElement, Fragment } from 'react';
import type { Notebook } from './types';

export function formatRelativeTime(iso: string) {
  const date = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z');
  const diff = Date.now() - date.getTime();
  const sec = Math.floor(diff / 1000);
  if (Number.isNaN(sec) || sec < 0) return iso;
  if (sec < 60) return '刚刚';
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} 分钟前`;
  const hour = Math.floor(min / 60);
  if (hour < 24) return `${hour} 小时前`;
  const day = Math.floor(hour / 24);
  if (day < 30) return `${day} 天前`;
  return date.toLocaleDateString('zh-CN');
}

export type NotebookTreeNode = Notebook & { children: NotebookTreeNode[] };

export function buildNotebookTree(list: Notebook[]): NotebookTreeNode[] {
  const map = new Map<string, NotebookTreeNode>();
  list.forEach((nb) => map.set(nb.id, { ...nb, children: [] }));
  const roots: NotebookTreeNode[] = [];
  map.forEach((node) => {
    if (node.parentId && map.has(node.parentId)) {
      map.get(node.parentId)!.children.push(node);
    } else {
      roots.push(node);
    }
  });
  const sortRec = (nodes: NotebookTreeNode[]) => {
    nodes.sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'zh'));
    nodes.forEach((n) => sortRec(n.children));
  };
  sortRec(roots);
  return roots;
}

export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let t: ReturnType<typeof setTimeout> | null = null;
  return (...args: Parameters<T>) => {
    if (t) clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

/**
 * 复制文本。HTTP 非 localhost 下 navigator.clipboard 常为 undefined，需 execCommand 降级。
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
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

export function flashCopyButton(btn: HTMLButtonElement, ok: boolean) {
  const label = btn.textContent || '复制';
  btn.textContent = ok ? '已复制' : '失败';
  if (ok) btn.classList.add('is-copied');
  window.setTimeout(() => {
    btn.textContent = label === '已复制' || label === '失败' ? '复制' : label;
    btn.classList.remove('is-copied');
  }, 1500);
}

/**
 * 处理 md-preview 内 `.code-copy-btn` 点击。
 * @returns 是否已处理（是复制按钮）
 */
export function handleCodeCopyClick(target: EventTarget | null): boolean {
  const el = target instanceof Element ? target : null;
  const copyBtn = el?.closest('.code-copy-btn');
  if (!(copyBtn instanceof HTMLButtonElement)) return false;

  const block = copyBtn.closest('.code-block');
  const raw = block?.querySelector('textarea.code-raw') as HTMLTextAreaElement | null;
  let text = raw?.value ?? '';
  // 兜底：若 raw 为空则从可见代码取文本
  if (!text && block) {
    const code = block.querySelector('pre code') || block.querySelector('pre');
    text = code?.textContent ?? '';
  }
  void copyTextToClipboard(text).then((ok) => flashCopyButton(copyBtn, ok));
  return true;
}

function escapeRegExp(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 将文本按关键字拆分并高亮（不区分大小写，多词均高亮） */
export function highlightText(text: string, query: string): ReactNode {
  if (!text) return text;
  const terms = query
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);
  if (terms.length === 0) return text;

  const pattern = terms.map(escapeRegExp).join('|');
  if (!pattern) return text;
  const re = new RegExp(`(${pattern})`, 'gi');
  const parts = text.split(re);
  if (parts.length === 1) return text;

  const lowerTerms = new Set(terms.map((t) => t.toLowerCase()));
  return createElement(
    Fragment,
    null,
    ...parts.map((part, i) => {
      if (lowerTerms.has(part.toLowerCase())) {
        return createElement(
          'mark',
          {
            key: i,
            className:
              'rounded-sm bg-amber-200/90 px-0.5 font-medium text-amber-950 not-italic dark:bg-amber-500/30 dark:text-amber-100',
          },
          part
        );
      }
      return part;
    })
  );
}

