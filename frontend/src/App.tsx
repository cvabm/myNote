import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { MomentsFeed } from './components/MomentsFeed';
import { MindMap } from './components/MindMap';
import { SettingsModal } from './components/SettingsModal';
import { readViewRoute, writeViewRoute } from './lib/viewRoute';
import type { Note, NoteListItem, ViewFilter } from './types';

const NOTES_PAGE_SIZE = 30;

/** 默认思维导图；旧 all/search/notebook 回退到 mindmap */
function normalizeFilter(f: ViewFilter): ViewFilter {
  if (
    f.type === 'all' ||
    f.type === 'search' ||
    f.type === 'notebook' ||
    f.type === 'globe'
  ) {
    return { type: 'mindmap' };
  }
  return f;
}

function getInitialRoute() {
  if (typeof window === 'undefined') {
    return { filter: { type: 'mindmap' as const }, selectedId: null as string | null };
  }
  const r = readViewRoute();
  return { filter: normalizeFilter(r.filter), selectedId: r.selectedId };
}

function toListItem(note: Note): NoteListItem {
  return {
    id: note.id,
    notebookId: note.notebookId,
    title: note.title,
    preview: (note.content || '').slice(0, 160).replace(/\s+/g, ' ').trim(),
    deletedAt: note.deletedAt,
    sortOrder: note.sortOrder,
    createdAt: note.createdAt,
    updatedAt: note.updatedAt,
  };
}

export default function App() {
  const { user, loading, logout } = useAuth();
  const initialRoute = useMemo(() => getInitialRoute(), []);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [notesHasMore, setNotesHasMore] = useState(false);
  const [notesLoadingMore, setNotesLoadingMore] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(initialRoute.selectedId);
  const [current, setCurrent] = useState<Note | null>(null);
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
  const skipNextUrlWrite = useRef(false);

  const isMoments = filter.type === 'moments';
  const isTrash = filter.type === 'trash';
  const isMindmap = filter.type === 'mindmap' || filter.type === 'globe' || filter.type === 'all';
  const momentsQuery = filter.type === 'moments' ? filter.q || '' : '';

  /** 仅回收站用列表 */
  const loadTrash = useCallback(async () => {
    if (filter.type !== 'trash') return;
    const seq = ++searchSeq.current;
    setSearching(true);
    try {
      const page = await api.listNotes({
        trash: '1',
        limit: NOTES_PAGE_SIZE,
        offset: 0,
      });
      if (seq !== searchSeq.current) return;
      setNotes(page.items);
      setNotesHasMore(page.hasMore);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, [filter.type]);

  const loadMoreTrash = useCallback(async () => {
    if (filter.type !== 'trash') return;
    if (!notesHasMore || notesLoadingMoreRef.current) return;
    notesLoadingMoreRef.current = true;
    setNotesLoadingMore(true);
    const seq = searchSeq.current;
    try {
      const page = await api.listNotes({
        trash: '1',
        limit: NOTES_PAGE_SIZE,
        offset: notes.length,
      });
      if (seq !== searchSeq.current) return;
      setNotes((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...page.items.filter((n) => !seen.has(n.id))];
      });
      setNotesHasMore(page.hasMore);
    } catch (e) {
      console.error(e);
    } finally {
      notesLoadingMoreRef.current = false;
      setNotesLoadingMore(false);
    }
  }, [filter.type, notesHasMore, notes.length]);

  useEffect(() => {
    if (!user) return;
    if (filter.type === 'trash') {
      setNotes([]);
      setNotesHasMore(false);
      void loadTrash().catch(console.error);
    } else {
      setNotes([]);
      setNotesHasMore(false);
    }
  }, [user, filter.type, loadTrash]);

  useEffect(() => {
    if (!user) return;
    if (skipNextUrlWrite.current) {
      skipNextUrlWrite.current = false;
      return;
    }
    writeViewRoute(
      {
        filter: isMindmap ? { type: 'mindmap' } : filter,
        selectedId: isMoments ? null : selectedId,
      },
      'replace'
    );
  }, [user, filter, selectedId, isMoments, isMindmap]);

  useEffect(() => {
    const onPopState = () => {
      const route = readViewRoute();
      skipNextUrlWrite.current = true;
      setFilter(normalizeFilter(route.filter));
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
      const item = toListItem(updated);
      setNotes((prev) => prev.map((n) => (n.id === item.id ? { ...n, ...item } : n)));
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [selectedId]);

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

  function handleNoteChange(patch: { title?: string; content?: string }) {
    if (!current) return;
    setCurrent({
      ...current,
      title: patch.title ?? current.title,
      content: patch.content ?? current.content,
    });
    const apiPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) apiPatch.title = patch.title;
    if (patch.content !== undefined) apiPatch.content = patch.content;
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
  }

  async function handleRestore() {
    if (!selectedId) return;
    await api.restoreNote(selectedId);
    setNotes((prev) => prev.filter((n) => n.id !== selectedId));
    setSelectedId(null);
    setCurrent(null);
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

  const mobileShowEditor = isTrash && !!selectedId;

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
        filter={filter}
        onFilterChange={(f) => {
          setFilter(normalizeFilter(f));
          setSelectedId(null);
          setSidebarOpen(false);
        }}
        onSearch={(q) => {
          // 仅说说支持侧栏搜索；其它入口用思维导图内搜索
          if (filter.type === 'moments') {
            setFilter(q ? { type: 'moments', q } : { type: 'moments' });
          }
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
        ) : isTrash ? (
          <>
            <NoteList
              notes={notes}
              selectedId={selectedId}
              onSelect={(id) => {
                setOpenInEditMode(false);
                setSelectedId(id);
                setSidebarOpen(false);
              }}
              isTrash
              onEmptyTrash={handleEmptyTrash}
              onOpenSidebar={() => setSidebarOpen(true)}
              mobileHidden={mobileShowEditor}
              searching={searching}
              hasMore={notesHasMore}
              loadingMore={notesLoadingMore}
              onLoadMore={() => {
                void loadMoreTrash();
              }}
            />
            {selectedId && current ? (
              <NoteEditor
                note={current}
                saving={saving}
                onChange={handleNoteChange}
                onTrash={handleTrash}
                onRestore={handleRestore}
                onDeleteForever={handleDeleteForever}
                onClose={() => {
                  setOpenInEditMode(false);
                  setSelectedId(null);
                }}
                initialEditorMode="preview"
              />
            ) : selectedId ? (
              <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-white text-sm text-slate-400 dark:bg-slate-950">
                加载笔记…
              </div>
            ) : (
              <div className="hidden h-full min-w-0 flex-1 flex-col items-center justify-center bg-white text-slate-400 dark:bg-slate-950 md:flex">
                <p className="px-6 text-center text-sm">选择回收站中的笔记</p>
              </div>
            )}
          </>
        ) : (
          // 导图始终挂载，进编辑只隐藏，返回时保留展开/缩放/定位
          <div className="relative flex h-full min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              className={
                selectedId
                  ? 'pointer-events-none invisible absolute inset-0'
                  : 'flex h-full min-h-0 min-w-0 flex-1'
              }
              aria-hidden={!!selectedId}
            >
              <MindMap
                onOpenSidebar={() => setSidebarOpen(true)}
                onOpenNote={(noteId) => {
                  setOpenInEditMode(true);
                  setSelectedId(noteId);
                  setSidebarOpen(false);
                }}
              />
            </div>
            {selectedId && current ? (
              <NoteEditor
                note={current}
                saving={saving}
                onChange={handleNoteChange}
                onTrash={handleTrash}
                onRestore={handleRestore}
                onDeleteForever={handleDeleteForever}
                onClose={() => {
                  setOpenInEditMode(false);
                  setSelectedId(null);
                  setCurrent(null);
                  setFilter({ type: 'mindmap' });
                }}
                initialEditorMode={openInEditMode ? 'split' : 'preview'}
              />
            ) : selectedId ? (
              <div className="relative z-10 flex h-full min-w-0 flex-1 flex-col items-center justify-center gap-3 bg-white text-sm text-slate-400 dark:bg-slate-950">
                <span>加载笔记…</span>
                <button
                  type="button"
                  className="btn-ghost text-sm"
                  onClick={() => {
                    setSelectedId(null);
                    setCurrent(null);
                    setFilter({ type: 'mindmap' });
                  }}
                >
                  返回思维导图
                </button>
              </div>
            ) : null}
          </div>
        )}
      </div>

      <SettingsModal
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onImported={() => {
          if (filter.type === 'trash') void loadTrash();
        }}
      />
    </div>
  );
}
