import { useCallback, useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import {
  ImagePlus,
  Loader2,
  Menu,
  MessageCircle,
  Pencil,
  Search,
  Send,
  Trash2,
  X,
} from 'lucide-react';
import { api } from '../api';
import type { Moment } from '../types';
import { formatRelativeTime, highlightText } from '../utils';

const MAX_CONTENT = 2000;
const MAX_IMAGES = 9;
const MOMENTS_PAGE_SIZE = 20;

type Props = {
  username: string;
  /** URL / 父组件同步的搜索关键字 */
  searchQuery?: string;
  /** 搜索关键字变更（防抖后写回 filter / URL） */
  onSearchQueryChange?: (q: string) => void;
  onSearchingChange?: (searching: boolean) => void;
  onOpenSidebar?: () => void;
};

function linkify(text: string) {
  const re = /(https?:\/\/[^\s<]+[^\s<.,;:!?'")\]])/g;
  const parts = text.split(re);
  return parts.map((part, i) => {
    if (/^https?:\/\//.test(part)) {
      return (
        <a
          key={i}
          href={part}
          target="_blank"
          rel="noopener noreferrer"
          className="text-brand-600 underline decoration-brand-600/30 underline-offset-2 hover:text-brand-700 dark:text-brand-400 dark:hover:text-brand-300"
        >
          {part}
        </a>
      );
    }
    return part;
  });
}

function ImageGrid({
  images,
  onRemove,
  editable,
}: {
  images: string[];
  onRemove?: (index: number) => void;
  editable?: boolean;
}) {
  if (images.length === 0) return null;
  const cols =
    images.length === 1 ? 'grid-cols-1' : images.length === 2 || images.length === 4 ? 'grid-cols-2' : 'grid-cols-3';

  return (
    <div className={clsx('mt-3 grid gap-1.5', cols, images.length === 1 && 'max-w-sm')}>
      {images.map((src, i) => (
        <div
          key={`${src}-${i}`}
          className={clsx(
            'group relative overflow-hidden rounded-lg bg-slate-100 dark:bg-slate-800',
            images.length === 1 ? 'aspect-auto' : 'aspect-square'
          )}
        >
          <img
            src={src}
            alt=""
            className={clsx(
              'h-full w-full object-cover',
              images.length === 1 && 'max-h-80 w-auto object-contain'
            )}
            loading="lazy"
          />
          {editable && onRemove && (
            <button
              type="button"
              className="absolute right-1.5 top-1.5 rounded-md bg-slate-900/70 p-1 text-white opacity-100 transition hover:bg-red-600 md:opacity-0 md:group-hover:opacity-100"
              onClick={() => onRemove(i)}
              title="移除图片"
              aria-label="移除图片"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

export function MomentsFeed({
  username,
  searchQuery = '',
  onSearchQueryChange,
  onSearchingChange,
  onOpenSidebar,
}: Props) {
  const [moments, setMoments] = useState<Moment[]>([]);
  const [loading, setLoading] = useState(true);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [content, setContent] = useState('');
  const [images, setImages] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [posting, setPosting] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState('');
  const [editImages, setEditImages] = useState<string[]>([]);
  const [savingEdit, setSavingEdit] = useState(false);
  const [lightbox, setLightbox] = useState<string | null>(null);
  /** 输入框即时值；实际请求用防抖后的 searchQuery */
  const [searchInput, setSearchInput] = useState(searchQuery);
  const fileRef = useRef<HTMLInputElement>(null);
  const editFileRef = useRef<HTMLInputElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const searchSeq = useRef(0);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadingMoreRef = useRef(false);
  const q = searchQuery.trim();
  const isSearch = !!q;

  // 外部 URL / filter 变化时同步输入框
  useEffect(() => {
    setSearchInput(searchQuery);
  }, [searchQuery]);

  useEffect(() => {
    return () => {
      if (searchTimer.current) clearTimeout(searchTimer.current);
    };
  }, []);

  /** Ctrl/Cmd + F → 聚焦说说搜索（拦截浏览器默认查找） */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      if (e.key !== 'f' && e.key !== 'F') return;
      e.preventDefault();
      e.stopPropagation();
      const input = searchInputRef.current;
      if (input) {
        input.focus();
        input.select();
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);

  function handleSearchInput(value: string) {
    setSearchInput(value);
    if (searchTimer.current) clearTimeout(searchTimer.current);
    const delay = value.trim() ? 220 : 0;
    searchTimer.current = setTimeout(() => {
      onSearchQueryChange?.(value.trim());
    }, delay);
  }

  function clearSearch() {
    if (searchTimer.current) clearTimeout(searchTimer.current);
    setSearchInput('');
    onSearchQueryChange?.('');
    searchInputRef.current?.focus();
  }

  const load = useCallback(async () => {
    const seq = ++searchSeq.current;
    setLoading(true);
    setMoments([]);
    setHasMore(false);
    if (isSearch) onSearchingChange?.(true);
    try {
      const page = await api.listMoments({
        limit: MOMENTS_PAGE_SIZE,
        q: q || undefined,
      });
      if (seq !== searchSeq.current) return;
      setMoments(page.items);
      setHasMore(page.hasMore);
    } catch (e) {
      if (seq !== searchSeq.current) return;
      console.error(e);
      alert(e instanceof Error ? e.message : '加载说说失败');
    } finally {
      if (seq === searchSeq.current) {
        setLoading(false);
        onSearchingChange?.(false);
      }
    }
  }, [q, isSearch, onSearchingChange]);

  const loadMore = useCallback(async () => {
    if (!hasMore || loadingMoreRef.current || loading) return;
    const last = moments[moments.length - 1];
    if (!last) return;
    loadingMoreRef.current = true;
    setLoadingMore(true);
    const seq = searchSeq.current;
    try {
      const page = await api.listMoments({
        limit: MOMENTS_PAGE_SIZE,
        q: q || undefined,
        before: last.createdAt,
        beforeId: last.id,
      });
      if (seq !== searchSeq.current) return;
      setMoments((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const extra = page.items.filter((m) => !seen.has(m.id));
        return [...prev, ...extra];
      });
      setHasMore(page.hasMore);
    } catch (e) {
      console.error(e);
    } finally {
      loadingMoreRef.current = false;
      setLoadingMore(false);
    }
  }, [hasMore, loading, moments, q]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      onSearchingChange?.(false);
    };
  }, [onSearchingChange]);

  // 滚动到底自动加载更多
  useEffect(() => {
    if (!hasMore || loading) return;
    const el = sentinelRef.current;
    const root = scrollRef.current;
    if (!el || !root) return;

    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          void loadMore();
        }
      },
      { root, rootMargin: '160px', threshold: 0 }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [hasMore, loading, loadMore, moments.length]);

  async function uploadFiles(files: FileList | File[], appendTo: 'compose' | 'edit') {
    const list = Array.from(files).filter((f) => f.type.startsWith('image/'));
    if (list.length === 0) return;

    const current = appendTo === 'compose' ? images : editImages;
    const room = MAX_IMAGES - current.length;
    if (room <= 0) {
      alert(`最多 ${MAX_IMAGES} 张图片`);
      return;
    }
    const toUpload = list.slice(0, room);
    setUploading(true);
    try {
      const urls: string[] = [];
      for (const file of toUpload) {
        const res = await api.uploadImage(file);
        urls.push(res.url);
      }
      if (appendTo === 'compose') setImages((prev) => [...prev, ...urls]);
      else setEditImages((prev) => [...prev, ...urls]);
    } catch (e) {
      alert(e instanceof Error ? e.message : '上传失败');
    } finally {
      setUploading(false);
    }
  }

  async function handlePost() {
    const text = content.trim();
    if (!text && images.length === 0) return;
    if (text.length > MAX_CONTENT) {
      alert(`内容不能超过 ${MAX_CONTENT} 字`);
      return;
    }
    setPosting(true);
    try {
      const created = await api.createMoment({ content: text, images });
      setMoments((prev) => [created, ...prev]);
      setContent('');
      setImages([]);
      textareaRef.current?.focus();
    } catch (e) {
      alert(e instanceof Error ? e.message : '发布失败');
    } finally {
      setPosting(false);
    }
  }

  function startEdit(m: Moment) {
    setEditingId(m.id);
    setEditContent(m.content);
    setEditImages([...m.images]);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditContent('');
    setEditImages([]);
  }

  async function saveEdit() {
    if (!editingId) return;
    const text = editContent.trim();
    if (!text && editImages.length === 0) {
      alert('请输入内容或添加图片');
      return;
    }
    if (text.length > MAX_CONTENT) {
      alert(`内容不能超过 ${MAX_CONTENT} 字`);
      return;
    }
    setSavingEdit(true);
    try {
      const updated = await api.updateMoment(editingId, {
        content: text,
        images: editImages,
      });
      setMoments((prev) => prev.map((m) => (m.id === editingId ? updated : m)));
      cancelEdit();
    } catch (e) {
      alert(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSavingEdit(false);
    }
  }

  async function handleDelete(id: string) {
    if (!window.confirm('确定删除这条说说？')) return;
    try {
      await api.deleteMoment(id);
      setMoments((prev) => prev.filter((m) => m.id !== id));
      if (editingId === id) cancelEdit();
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败');
    }
  }

  const remain = MAX_CONTENT - content.length;
  const canPost = (content.trim().length > 0 || images.length > 0) && remain >= 0 && !posting;

  return (
    <div className="flex h-full min-h-0 min-w-0 flex-1 flex-col bg-white dark:bg-slate-950">
      <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2.5 safe-pt md:px-6 dark:border-slate-800">
        <button
          type="button"
          className="btn-ghost !p-2 md:hidden"
          onClick={onOpenSidebar}
          aria-label="打开菜单"
          title="菜单"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600 dark:text-sky-400">
          <MessageCircle className="h-4 w-4" />
        </div>
        <div className="min-w-0 shrink-0">
          <div className="text-sm font-semibold text-slate-800 dark:text-slate-100">
            {isSearch ? '搜索说说' : '说说'}
          </div>
          <div className="flex items-center gap-1.5 text-xs text-slate-400">
            {(loading || loadingMore) && <Loader2 className="h-3 w-3 animate-spin" />}
            {isSearch ? (
              <span className="truncate max-w-[8rem] sm:max-w-[12rem]">
                “{q}” · {moments.length}
                {hasMore ? '+' : ''} 条
              </span>
            ) : (
              <span>
                {moments.length}
                {hasMore ? '+' : ''} 条
              </span>
            )}
          </div>
        </div>

        {/* 顶部搜索：与思维导图一致，Ctrl+F 聚焦 */}
        <div className="relative mx-1 min-w-0 flex-1 basis-[12rem]" data-search-box>
          <Search
            className={clsx(
              'pointer-events-none absolute left-2.5 top-1/2 z-10 h-3.5 w-3.5 -translate-y-1/2',
              loading && isSearch ? 'animate-pulse text-brand-500' : 'text-slate-400'
            )}
          />
          <input
            ref={searchInputRef}
            className="input w-full py-1.5 pl-8 pr-8 text-sm md:py-1 md:text-xs"
            placeholder="搜索说说… (Ctrl+F)"
            value={searchInput}
            onChange={(e) => handleSearchInput(e.target.value)}
            title="Ctrl+F 聚焦搜索"
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                if (searchInput) clearSearch();
                else (e.target as HTMLInputElement).blur();
              }
            }}
            enterKeyHint="search"
            autoComplete="off"
            spellCheck={false}
          />
          {searchInput && (
            <button
              type="button"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 text-slate-400 hover:bg-slate-100 hover:text-slate-600 dark:hover:bg-slate-800"
              title="清除"
              onClick={clearSearch}
              aria-label="清除搜索"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      <div ref={scrollRef} className="scroll-y flex-1">
        <div className="mx-auto w-full max-w-xl px-3 py-4 md:px-6">
          {/* 发布框：搜索时收起，避免干扰结果 */}
          {!isSearch && (
          <div className="rounded-2xl border border-slate-200 bg-surface-50/80 p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/60 md:p-4">
            <div className="mb-2 flex items-center gap-2">
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                {(username || '?').slice(0, 1).toUpperCase()}
              </div>
              <div className="min-w-0 text-sm font-medium text-slate-700 dark:text-slate-200">
                {username}
              </div>
            </div>
            <textarea
              ref={textareaRef}
              className="input min-h-[5.5rem] resize-y border-0 bg-transparent px-0 py-1 text-[15px] shadow-none focus:border-transparent focus:ring-0"
              placeholder="这一刻想说点什么…"
              value={content}
              maxLength={MAX_CONTENT + 50}
              onChange={(e) => setContent(e.target.value)}
              onKeyDown={(e) => {
                if ((e.ctrlKey || e.metaKey) && e.key === 'Enter' && canPost) {
                  e.preventDefault();
                  void handlePost();
                }
              }}
              onPaste={(e) => {
                const items = e.clipboardData?.items;
                if (!items) return;
                const files: File[] = [];
                for (let i = 0; i < items.length; i++) {
                  const item = items[i];
                  if (item?.type.startsWith('image/')) {
                    const f = item.getAsFile();
                    if (f) files.push(f);
                  }
                }
                if (files.length > 0) {
                  e.preventDefault();
                  void uploadFiles(files, 'compose');
                }
              }}
            />
            <ImageGrid
              images={images}
              editable
              onRemove={(i) => setImages((prev) => prev.filter((_, idx) => idx !== i))}
            />
            <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-slate-200/80 pt-3 dark:border-slate-800">
              <input
                ref={fileRef}
                type="file"
                accept="image/jpeg,image/png,image/gif,image/webp"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) void uploadFiles(e.target.files, 'compose');
                  e.target.value = '';
                }}
              />
              <button
                type="button"
                className="btn-ghost !px-2.5"
                disabled={uploading || images.length >= MAX_IMAGES}
                onClick={() => fileRef.current?.click()}
                title="添加图片"
              >
                {uploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <ImagePlus className="h-4 w-4" />
                )}
                图片
                {images.length > 0 && (
                  <span className="text-xs text-slate-400">
                    {images.length}/{MAX_IMAGES}
                  </span>
                )}
              </button>
              <span
                className={clsx(
                  'ml-auto text-xs tabular-nums',
                  remain < 0
                    ? 'text-red-500'
                    : remain < 100
                      ? 'text-amber-600 dark:text-amber-400'
                      : 'text-slate-400'
                )}
              >
                {remain}
              </span>
              <button
                type="button"
                className="btn-primary"
                disabled={!canPost || uploading}
                onClick={() => void handlePost()}
              >
                {posting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                发布
              </button>
            </div>
          </div>
          )}

          {/* 时间线 */}
          <div className={clsx('space-y-3', !isSearch && 'mt-5')}>
            {loading && (
              <div className="flex items-center justify-center gap-2 py-12 text-sm text-slate-400">
                <Loader2 className="h-4 w-4 animate-spin" />
                {isSearch ? '搜索中…' : '加载中…'}
              </div>
            )}
            {!loading && moments.length === 0 && (
              <div className="rounded-2xl border border-dashed border-slate-200 px-6 py-14 text-center dark:border-slate-800">
                <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-sky-500/10 text-sky-500">
                  <MessageCircle className="h-6 w-6" />
                </div>
                {isSearch ? (
                  <>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">
                      没有匹配 “{q}” 的说说
                    </p>
                    <p className="mt-1 text-xs text-slate-400">换个关键词试试，或清除搜索查看全部</p>
                  </>
                ) : (
                  <>
                    <p className="text-sm font-medium text-slate-600 dark:text-slate-300">还没有说说</p>
                    <p className="mt-1 text-xs text-slate-400">在上面写点什么，记录今天的心情吧</p>
                  </>
                )}
              </div>
            )}
            {moments.map((m) => {
              const isEditing = editingId === m.id;
              return (
                <article
                  key={m.id}
                  className="rounded-2xl border border-slate-200 bg-white p-3 shadow-sm dark:border-slate-800 dark:bg-slate-900/40 md:p-4"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-brand-600 text-sm font-semibold text-white">
                      {(username || '?').slice(0, 1).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                        <span className="text-sm font-semibold text-slate-800 dark:text-slate-100">
                          {username}
                        </span>
                        <time
                          className="text-xs text-slate-400"
                          dateTime={m.createdAt}
                          title={m.createdAt}
                        >
                          {formatRelativeTime(m.createdAt)}
                          {m.updatedAt !== m.createdAt && ' · 已编辑'}
                        </time>
                      </div>

                      {isEditing ? (
                        <div className="mt-2">
                          <textarea
                            className="input min-h-[4.5rem] resize-y text-[15px]"
                            value={editContent}
                            maxLength={MAX_CONTENT + 50}
                            onChange={(e) => setEditContent(e.target.value)}
                          />
                          <ImageGrid
                            images={editImages}
                            editable
                            onRemove={(i) =>
                              setEditImages((prev) => prev.filter((_, idx) => idx !== i))
                            }
                          />
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <input
                              ref={editFileRef}
                              type="file"
                              accept="image/jpeg,image/png,image/gif,image/webp"
                              multiple
                              className="hidden"
                              onChange={(e) => {
                                if (e.target.files?.length)
                                  void uploadFiles(e.target.files, 'edit');
                                e.target.value = '';
                              }}
                            />
                            <button
                              type="button"
                              className="btn-ghost !px-2 text-xs"
                              disabled={uploading || editImages.length >= MAX_IMAGES}
                              onClick={() => editFileRef.current?.click()}
                            >
                              <ImagePlus className="h-3.5 w-3.5" />
                              图片
                            </button>
                            <div className="ml-auto flex gap-1.5">
                              <button type="button" className="btn-ghost text-xs" onClick={cancelEdit}>
                                取消
                              </button>
                              <button
                                type="button"
                                className="btn-primary text-xs"
                                disabled={savingEdit || uploading}
                                onClick={() => void saveEdit()}
                              >
                                {savingEdit ? (
                                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : null}
                                保存
                              </button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <>
                          {m.content && (
                            <div className="mt-1.5 whitespace-pre-wrap break-words text-[15px] leading-relaxed text-slate-800 dark:text-slate-100">
                              {isSearch ? highlightText(m.content, q) : linkify(m.content)}
                            </div>
                          )}
                          {m.images.length > 0 && (
                            <button
                              type="button"
                              className="block w-full text-left"
                              onClick={(e) => {
                                const t = e.target as HTMLElement;
                                if (t.tagName === 'IMG') {
                                  setLightbox((t as HTMLImageElement).src);
                                }
                              }}
                            >
                              <ImageGrid images={m.images} />
                            </button>
                          )}
                          <div className="mt-2.5 flex items-center gap-1 border-t border-slate-100 pt-2 dark:border-slate-800/80">
                            <button
                              type="button"
                              className="btn-ghost !px-2 !py-1 text-xs text-slate-500"
                              onClick={() => startEdit(m)}
                            >
                              <Pencil className="h-3.5 w-3.5" />
                              编辑
                            </button>
                            <button
                              type="button"
                              className="btn-danger !px-2 !py-1 text-xs"
                              onClick={() => void handleDelete(m.id)}
                            >
                              <Trash2 className="h-3.5 w-3.5" />
                              删除
                            </button>
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </article>
              );
            })}

            {/* 无限滚动哨兵 */}
            <div ref={sentinelRef} className="h-1 w-full shrink-0" aria-hidden />
            {loadingMore && (
              <div className="flex items-center justify-center gap-1.5 py-4 text-xs text-slate-400">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                加载更多…
              </div>
            )}
            {!loading && !loadingMore && !hasMore && moments.length > 0 && (
              <div className="py-4 text-center text-[11px] text-slate-400">已经到底了</div>
            )}
          </div>
        </div>
      </div>

      {lightbox && (
        <button
          type="button"
          className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-950/85 p-4 backdrop-blur-sm"
          onClick={() => setLightbox(null)}
          aria-label="关闭预览"
        >
          <img
            src={lightbox}
            alt=""
            className="max-h-full max-w-full rounded-lg object-contain shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          />
          <span className="absolute right-4 top-4 rounded-lg bg-white/10 p-2 text-white hover:bg-white/20">
            <X className="h-5 w-5" />
          </span>
        </button>
      )}
    </div>
  );
}
