import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { MomentsFeed } from './components/MomentsFeed';
import { SettingsModal } from './components/SettingsModal';
import { readViewRoute, writeViewRoute } from './lib/viewRoute';
import type { Note, NoteListItem, Notebook, ViewFilter } from './types';

const NOTES_PAGE_SIZE = 30;

/** 首屏从地址栏恢复，避免刷新总回到首页 */
function getInitialRoute() {
  if (typeof window === 'undefined') {
    return { filter: { type: 'all' as const }, selectedId: null as string | null };
  }
  return readViewRoute();
}

function toListItem(note: Note): NoteListItem {
  return {
    id: note.id,
    notebookId: note.notebookId,
    title: note.title,
    preview: (note.content || '').slice(0, 160).replace(/\s+/g, ' ').trim(),
    isFavorite: note.isFavorite,
    deletedAt: note.deletedAt,
    sortOrder: note.sortOrder,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export default function App() {
  const { user, loading, logout } = useAuth();
  const initialRoute = useMemo(() => getInitialRoute(), []);
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [notesHasMore, setNotesHasMore] = useState(false);
  const [notesLoadingMore, setNotesLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialRoute.selectedId);
  const [current, setCurrent] = useState<Note | null>(null);
  /** 新建后打开为分栏编辑；从列表点开为预览 */
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [filter, setFilter] = useState<ViewFilter>(initialRoute.filter);
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Record<string, unknown>>({});
  const searchSeq = useRef(0);
  const notesLoadingMoreRef = useRef(false);
  /** 浏览器后退/前进写入状态时，跳过下一轮 URL 同步，避免打架 */
  const skipNextUrlWrite = useRef(false);

  const loadMeta = useCallback(async () => {
    const nbs = await api.listNotebooks();
    setNotebooks(nbs);
  }, []);

  const isMoments = filter.type === 'moments';
  const momentsQuery = filter.type === 'moments' ? filter.q || '' : '';

  const listParams = useMemo(() => {
    const params: Record<string, string | undefined> = {};
    if (filter.type === 'notebook') params.notebookId = filter.id;
    if (filter.type === 'favorite') params.favorite = '1';
    if (filter.type === 'trash') params.trash = '1';
    if (filter.type === 'search') params.q = filter.q;
    return params;
  }, [filter]);

  /** 重新加载第一页 */
  const loadNotes = useCallback(async () => {
    if (filter.type === 'moments') return;
    const isSearch = filter.type === 'search';
    const seq = ++searchSeq.current;
    if (isSearch) setSearching(true);
    else setSearching(false);
    try {
      const page = await api.listNotes({
        ...listParams,
        limit: NOTES_PAGE_SIZE,
        offset: 0,
      });
      if (seq !== searchSeq.current) return;
      setNotes(page.items);
      setNotesHasMore(page.hasMore);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, [listParams, filter.type]);

  /** 滚动到底加载下一页 */
  const loadMoreNotes = useCallback(async () => {
    if (filter.type === 'moments') return;
    if (!notesHasMore || notesLoadingMoreRef.current) return;
    notesLoadingMoreRef.current = true;
    setNotesLoadingMore(true);
    const seq = searchSeq.current;
    try {
      const page = await api.listNotes({
        ...listParams,
        limit: NOTES_PAGE_SIZE,
        offset: notes.length,
      });
      if (seq !== searchSeq.current) return;
      setNotes((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        const extra = page.items.filter((n) => !seen.has(n.id));
        return [...prev, ...extra];
      });
      setNotesHasMore(page.hasMore);
    } catch (e) {
      console.error(e);
    } finally {
      notesLoadingMoreRef.current = false;
      setNotesLoadingMore(false);
    }
  }, [filter.type, listParams, notesHasMore, notes.length]);

  useEffect(() => {
    if (!user) return;
    void loadMeta().catch(console.error);
  }, [user, loadMeta]);

  useEffect(() => {
    if (!user) return;
    setNotes([]);
    setNotesHasMore(false);
    void loadNotes().catch(console.error);
  }, [user, loadNotes]);

  // 视图 / 选中笔记 → 写入地址栏（刷新可恢复）
  useEffect(() => {
    if (!user) return;
    if (skipNextUrlWrite.current) {
      skipNextUrlWrite.current = false;
      return;
    }
    writeViewRoute(
      {
        filter,
        selectedId: isMoments ? null : selectedId,
      },
      'replace'
    );
  }, [user, filter, selectedId, isMoments]);

  // 浏览器后退 / 前进
  useEffect(() => {
    const onPopState = () => {
      const route = readViewRoute();
      skipNextUrlWrite.current = true;
      setFilter(route.filter);
      setSelectedId(route.selectedId);
      setOpenInEditMode(false);
      setSidebarOpen(false);
    };
    window.addEventListener('popstate', onPopState);
    return () => window.removeEventListener('popstate', onPopState);
  }, []);

  useEffect(() => {
    if (!selectedId || !user || isMoments) {
      setCurrent(null);
      return;
    }
    let cancelled = false;
    api
      .getNote(selectedId)
      .then((note) => {
        if (!cancelled) setCurrent(note);
      })
      .catch(() => {
        if (!cancelled) {
          setCurrent(null);
          setSelectedId(null);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [selectedId, user, isMoments]);

  const flushSave = useCallback(async () => {
    if (!selectedId) return;
    const patch = pendingPatch.current;
    if (Object.keys(patch).length === 0) return;
    pendingPatch.current = {};
    setSaving(true);
    try {
      const updated = await api.updateNote(selectedId, patch as Parameters<typeof api.updateNote>[1]);
      setCurrent(updated);
      // 就地更新列表项，避免自动保存时重置分页滚动位置
      const item = toListItem(updated);
      setNotes((prev) => {
        const rest = prev.filter((n) => n.id !== item.id);
        // 非搜索视图：按更新时间置顶
        if (filter.type !== 'search') {
          return [item, ...rest];
        }
        return prev.map((n) => (n.id === item.id ? { ...n, ...item } : n));
      });
      await loadMeta();
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [selectedId, loadMeta, filter.type]);

  const scheduleSave = useCallback(
    (patch: Record<string, unknown>) => {
      pendingPatch.current = { ...pendingPatch.current, ...patch };
      if (saveTimer.current) clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => {
        void flushSave();
      }, 500);
    },
    [flushSave]
  );

  useEffect(() => {
    return () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
    };
  }, []);

  async function handleCreateNote() {
    try {
      // 当前在某笔记本视图 → 用该本；否则默认「默认笔记本」
      let notebookId: string | null = null;
      if (filter.type === 'notebook') {
        notebookId = filter.id;
      } else {
        const def = notebooks.find((n) => n.name === '默认笔记本');
        notebookId =
          def?.id ??
          notebooks.find((n) => !n.parentId)?.id ??
          notebooks[0]?.id ??
          null;
      }
      // 从「说说」新建笔记时切回笔记视图
      if (filter.type === 'moments') {
        setFilter({ type: 'all' });
      }
      const note = await api.createNote({
        title: '未命名笔记',
        content: '',
        notebookId,
      });
      const item = toListItem(note);
      // 在「全部 / 对应笔记本」视图下直接插入顶部；其它视图重载第一页
      if (
        filter.type === 'all' ||
        filter.type === 'moments' ||
        (filter.type === 'notebook' && filter.id === notebookId)
      ) {
        setNotes((prev) => [item, ...prev.filter((n) => n.id !== item.id)]);
      } else {
        await loadNotes();
      }
      await loadMeta();
      setOpenInEditMode(true);
      setSelectedId(note.id);
    } catch (e) {
      alert(e instanceof Error ? e.message : '创建失败');
    }
  }

  async function handleCreateNotebook(parentId?: string | null) {
    const name = window.prompt('笔记本名称', '新建笔记本');
    if (!name?.trim()) return;
    try {
      await api.createNotebook({ name: name.trim(), parentId: parentId ?? null });
      await loadMeta();
    } catch (e) {
      alert(e instanceof Error ? e.message : '创建失败');
    }
  }

  async function handleDeleteNotebook(id: string) {
    if (!window.confirm('删除笔记本后，其中的笔记将移入回收站。确定？')) return;
    try {
      await api.deleteNotebook(id);
      if (filter.type === 'notebook' && filter.id === id) {
        setFilter({ type: 'all' });
      }
      await loadMeta();
      await loadNotes();
    } catch (e) {
      alert(e instanceof Error ? e.message : '删除失败');
    }
  }

  function handleNoteChange(patch: {
    title?: string;
    content?: string;
    notebookId?: string | null;
    isFavorite?: boolean;
  }) {
    if (!current) return;

    setCurrent({
      ...current,
      title: patch.title ?? current.title,
      content: patch.content ?? current.content,
      notebookId: patch.notebookId !== undefined ? patch.notebookId : current.notebookId,
      isFavorite: patch.isFavorite ?? current.isFavorite,
    });

    const apiPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) apiPatch.title = patch.title;
    if (patch.content !== undefined) apiPatch.content = patch.content;
    if (patch.notebookId !== undefined) apiPatch.notebookId = patch.notebookId;
    if (patch.isFavorite !== undefined) apiPatch.isFavorite = patch.isFavorite;
    scheduleSave(apiPatch);
  }

  async function handleTrash() {
    if (!selectedId) return;
    if (!window.confirm('确定将笔记移入回收站？')) return;
    if (saveTimer.current) {
      clearTimeout(saveTimer.current);
      await flushSave();
    }
    await api.trashNote(selectedId);
    setNotes((prev) => prev.filter((n) => n.id !== selectedId));
    setSelectedId(null);
    setCurrent(null);
    await loadMeta();
  }

  async function handleRestore() {
    if (!selectedId) return;
    await api.restoreNote(selectedId);
    setNotes((prev) => prev.filter((n) => n.id !== selectedId));
    setSelectedId(null);
    setCurrent(null);
    await loadMeta();
  }

  async function handleDeleteForever() {
    if (!selectedId) return;
    if (!window.confirm('永久删除后无法恢复，确定？')) return;
    await api.deleteNote(selectedId);
    setNotes((prev) => prev.filter((n) => n.id !== selectedId));
    setSelectedId(null);
    setCurrent(null);
  }

  async function handleEmptyTrash() {
    if (!window.confirm('清空回收站？此操作不可撤销。')) return;
    await api.emptyTrash();
    setNotes([]);
    setNotesHasMore(false);
    setSelectedId(null);
    setCurrent(null);
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center bg-surface-50 text-sm text-slate-400 dark:bg-surface-950">
        加载中…
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const mobileShowEditor = !!selectedId;

  return (
    <div className="relative flex h-full min-h-0 overflow-hidden bg-surface-50 dark:bg-surface-950">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-900/50 backdrop-blur-[1px] md:hidden"
          aria-label="关闭菜单"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <Sidebar
        notebooks={notebooks}
        filter={filter}
        onFilterChange={(f) => {
          setFilter(f);
          setSelectedId(null);
          setSidebarOpen(false);
        }}
        onCreateNotebook={handleCreateNotebook}
        onDeleteNotebook={handleDeleteNotebook}
        onCreateNote={handleCreateNote}
        onSearch={(q) => {
          if (!q) {
            setFilter((prev) => {
              if (prev.type === 'search') return { type: 'all' };
              if (prev.type === 'moments') return { type: 'moments' };
              return prev;
            });
          } else if (filter.type === 'moments') {
            // 在说说页内搜索说说
            setFilter({ type: 'moments', q });
          } else {
            setFilter({ type: 'search', q });
          }
          setSelectedId(null);
        }}
        onLogout={logout}
        onOpenSettings={() => {
          setSettingsOpen(true);
          setSidebarOpen(false);
        }}
        username={user.displayName || user.username}
        mobileOpen={sidebarOpen}
        onMobileClose={() => setSidebarOpen(false)}
        searching={searching}
      />

      <div className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
        {isMoments ? (
          <MomentsFeed
            username={user.displayName || user.username}
            searchQuery={momentsQuery}
            onSearchingChange={setSearching}
            onOpenSidebar={() => setSidebarOpen(true)}
          />
        ) : (
          <>
            <NoteList
              notes={notes}
              selectedId={selectedId}
              onSelect={(id) => {
                setOpenInEditMode(false);
                setSelectedId(id);
                setSidebarOpen(false);
              }}
              isTrash={filter.type === 'trash'}
              onEmptyTrash={handleEmptyTrash}
              onOpenSidebar={() => setSidebarOpen(true)}
              onCreateNote={handleCreateNote}
              mobileHidden={mobileShowEditor}
              highlightQuery={filter.type === 'search' ? filter.q : ''}
              searching={searching}
              hasMore={notesHasMore}
              loadingMore={notesLoadingMore}
              onLoadMore={() => {
                void loadMoreNotes();
              }}
            />
            {selectedId && current ? (
              <NoteEditor
                note={current}
                notebooks={notebooks}
                saving={saving}
                onChange={handleNoteChange}
                onTrash={handleTrash}
                onRestore={handleRestore}
                onDeleteForever={handleDeleteForever}
                onClose={() => {
                  setOpenInEditMode(false);
                  setSelectedId(null);
                }}
                initialEditorMode={openInEditMode ? 'split' : 'preview'}
              />
            ) : selectedId ? (
              <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-white text-sm text-slate-400 dark:bg-slate-950">
                加载笔记…
              </div>
            ) : (
              <div className="hidden h-full min-w-0 flex-1 flex-col items-center justify-center bg-white text-slate-400 dark:bg-slate-950 md:flex">
                <div className="mb-2 text-5xl opacity-20">✎</div>
                <p className="px-6 text-center text-sm">选择或新建一篇笔记开始书写</p>
              </div>
            )}
          </>
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onImported={() => {
          void loadMeta();
          void loadNotes();
        }}
      />
    </div>
  );
}
