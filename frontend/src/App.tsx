import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from './api';
import { useAuth } from './context/AuthContext';
import { LoginPage } from './components/LoginPage';
import { Sidebar } from './components/Sidebar';
import { NoteList } from './components/NoteList';
import { NoteEditor } from './components/NoteEditor';
import { SettingsModal } from './components/SettingsModal';
import type { Note, NoteListItem, Notebook, ViewFilter } from './types';

export default function App() {
  const { user, loading, logout } = useAuth();
  const [notebooks, setNotebooks] = useState<Notebook[]>([]);
  const [notes, setNotes] = useState<NoteListItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [current, setCurrent] = useState<Note | null>(null);
  /** 新建后打开为分栏编辑；从列表点开为预览 */
  const [openInEditMode, setOpenInEditMode] = useState(false);
  const [filter, setFilter] = useState<ViewFilter>({ type: 'all' });
  const [saving, setSaving] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [searching, setSearching] = useState(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPatch = useRef<Record<string, unknown>>({});
  const searchSeq = useRef(0);

  const loadMeta = useCallback(async () => {
    const nbs = await api.listNotebooks();
    setNotebooks(nbs);
  }, []);

  const listParams = useMemo(() => {
    const params: Record<string, string | undefined> = {};
    if (filter.type === 'notebook') params.notebookId = filter.id;
    if (filter.type === 'favorite') params.favorite = '1';
    if (filter.type === 'trash') params.trash = '1';
    if (filter.type === 'search') params.q = filter.q;
    return params;
  }, [filter]);

  const loadNotes = useCallback(async () => {
    const isSearch = filter.type === 'search';
    const seq = ++searchSeq.current;
    if (isSearch) setSearching(true);
    try {
      const list = await api.listNotes(listParams);
      if (seq !== searchSeq.current) return;
      setNotes(list);
    } finally {
      if (seq === searchSeq.current) setSearching(false);
    }
  }, [listParams, filter.type]);

  useEffect(() => {
    if (!user) return;
    void loadMeta().catch(console.error);
  }, [user, loadMeta]);

  useEffect(() => {
    if (!user) return;
    void loadNotes().catch(console.error);
  }, [user, loadNotes]);

  useEffect(() => {
    if (!selectedId || !user) {
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
  }, [selectedId, user]);

  const flushSave = useCallback(async () => {
    if (!selectedId) return;
    const patch = pendingPatch.current;
    if (Object.keys(patch).length === 0) return;
    pendingPatch.current = {};
    setSaving(true);
    try {
      const updated = await api.updateNote(selectedId, patch as Parameters<typeof api.updateNote>[1]);
      setCurrent(updated);
      await Promise.all([loadNotes(), loadMeta()]);
    } catch (e) {
      console.error(e);
      alert(e instanceof Error ? e.message : '保存失败');
    } finally {
      setSaving(false);
    }
  }, [selectedId, loadNotes, loadMeta]);

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
      const note = await api.createNote({
        title: '未命名笔记',
        content: '',
        notebookId,
      });
      await loadNotes();
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
    isLocked?: boolean;
  }) {
    if (!current) return;

    setCurrent({
      ...current,
      title: patch.title ?? current.title,
      content: patch.content ?? current.content,
      notebookId: patch.notebookId !== undefined ? patch.notebookId : current.notebookId,
      isFavorite: patch.isFavorite ?? current.isFavorite,
      isLocked: patch.isLocked ?? current.isLocked,
    });

    const apiPatch: Record<string, unknown> = {};
    if (patch.title !== undefined) apiPatch.title = patch.title;
    if (patch.content !== undefined) apiPatch.content = patch.content;
    if (patch.notebookId !== undefined) apiPatch.notebookId = patch.notebookId;
    if (patch.isFavorite !== undefined) apiPatch.isFavorite = patch.isFavorite;
    if (patch.isLocked !== undefined) apiPatch.isLocked = patch.isLocked;
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
    setSelectedId(null);
    setCurrent(null);
    await loadNotes();
    await loadMeta();
  }

  async function handleRestore() {
    if (!selectedId) return;
    await api.restoreNote(selectedId);
    setSelectedId(null);
    setCurrent(null);
    await loadNotes();
    await loadMeta();
  }

  async function handleDeleteForever() {
    if (!selectedId) return;
    if (!window.confirm('永久删除后无法恢复，确定？')) return;
    await api.deleteNote(selectedId);
    setSelectedId(null);
    setCurrent(null);
    await loadNotes();
  }

  async function handleEmptyTrash() {
    if (!window.confirm('清空回收站？此操作不可撤销。')) return;
    await api.emptyTrash();
    setSelectedId(null);
    setCurrent(null);
    await loadNotes();
  }

  if (loading) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-slate-400">
        加载中…
      </div>
    );
  }

  if (!user) return <LoginPage />;

  const mobileShowEditor = !!selectedId;

  return (
    <div className="relative flex h-full overflow-hidden">
      {sidebarOpen && (
        <button
          type="button"
          className="fixed inset-0 z-40 bg-slate-900/40 backdrop-blur-[1px] md:hidden"
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
            setFilter((prev) => (prev.type === 'search' ? { type: 'all' } : prev));
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

      <div className="flex min-w-0 flex-1 overflow-hidden">
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
          <div className="flex h-full min-w-0 flex-1 items-center justify-center bg-white text-sm text-slate-400">
            加载笔记…
          </div>
        ) : (
          <div className="hidden h-full min-w-0 flex-1 flex-col items-center justify-center bg-white text-slate-400 md:flex">
            <div className="mb-2 text-5xl opacity-20">✎</div>
            <p className="px-6 text-center text-sm">选择或新建一篇笔记开始书写</p>
          </div>
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
