import type {
  GraphData,
  GraphEdge,
  GraphNode,
  MindmapData,
  Moment,
  Note,
  NoteListItem,
  Notebook,
  PageResult,
  User,
} from './types';

const TOKEN_KEY = 'mynote_token';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null) {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  const token = getToken();
  if (token) headers.set('Authorization', `Bearer ${token}`);

  const res = await fetch(path, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error || `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  login(username: string, password: string) {
    return request<{ token: string; user: User }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
  },
  me() {
    return request<User>('/api/auth/me');
  },
  changePassword(oldPassword: string, newPassword: string) {
    return request<{ ok: boolean; token?: string }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
    });
  },
  /** 使所有已签发 JWT 失效；keepCurrent 时返回本机新 token */
  logoutAll(keepCurrent = true) {
    return request<{ ok: boolean; token: string | null }>('/api/auth/logout-all', {
      method: 'POST',
      body: JSON.stringify({ keepCurrent }),
    });
  },

  listNotebooks() {
    return request<Notebook[]>('/api/notebooks');
  },
  createNotebook(data: { name: string; parentId?: string | null; color?: string }) {
    return request<Notebook>('/api/notebooks', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateNotebook(id: string, data: Partial<{ name: string; parentId: string | null; color: string }>) {
    return request<Notebook>(`/api/notebooks/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  deleteNotebook(id: string) {
    return request<{ ok: boolean }>(`/api/notebooks/${id}`, { method: 'DELETE' });
  },

  listNotes(params: Record<string, string | number | undefined> = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const q = qs.toString();
    return request<PageResult<NoteListItem>>(`/api/notes${q ? `?${q}` : ''}`);
  },
  getNote(id: string) {
    return request<Note>(`/api/notes/${id}`);
  },
  createNote(data: { title?: string; content?: string; notebookId?: string | null }) {
    return request<Note>('/api/notes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateNote(
    id: string,
    data: Partial<{
      title: string;
      content: string;
      notebookId: string | null;
    }>
  ) {
    return request<Note>(`/api/notes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  trashNote(id: string) {
    return request<{ ok: boolean }>(`/api/notes/${id}/trash`, { method: 'POST' });
  },
  restoreNote(id: string) {
    return request<{ ok: boolean }>(`/api/notes/${id}/restore`, { method: 'POST' });
  },
  deleteNote(id: string) {
    return request<{ ok: boolean }>(`/api/notes/${id}`, { method: 'DELETE' });
  },
  emptyTrash() {
    return request<{ ok: boolean; count: number }>('/api/notes?trash=1', { method: 'DELETE' });
  },

  // —— 说说 ——
  listMoments(params: { limit?: number; before?: string; beforeId?: string; q?: string } = {}) {
    const qs = new URLSearchParams();
    if (params.limit) qs.set('limit', String(params.limit));
    if (params.before) qs.set('before', params.before);
    if (params.beforeId) qs.set('beforeId', params.beforeId);
    if (params.q) qs.set('q', params.q);
    const q = qs.toString();
    return request<PageResult<Moment>>(`/api/moments${q ? `?${q}` : ''}`);
  },
  createMoment(data: { content: string; images?: string[] }) {
    return request<Moment>('/api/moments', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateMoment(id: string, data: Partial<{ content: string; images: string[] }>) {
    return request<Moment>(`/api/moments/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  deleteMoment(id: string) {
    return request<{ ok: boolean }>(`/api/moments/${id}`, { method: 'DELETE' });
  },

  // —— 思维导图 ——
  getMindmap() {
    return request<MindmapData>('/api/mindmap');
  },

  // —— 知识图（旧接口，保留兼容）——
  getGraph() {
    return request<GraphData>('/api/graph');
  },
  rebuildGraph() {
    return request<GraphData>('/api/graph/rebuild', { method: 'POST' });
  },
  createGraphNode(data: {
    title: string;
    color?: string;
    x?: number;
    y?: number;
    pinned?: boolean;
  }) {
    return request<GraphNode>('/api/graph/nodes', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  updateGraphNode(
    id: string,
    data: Partial<{ title: string; color: string; x: number; y: number; pinned: boolean }>
  ) {
    return request<GraphNode>(`/api/graph/nodes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(data),
    });
  },
  deleteGraphNode(id: string) {
    return request<{ ok: boolean }>(`/api/graph/nodes/${id}`, { method: 'DELETE' });
  },
  createGraphEdge(data: { fromId: string; toId: string; relation?: string }) {
    return request<GraphEdge>('/api/graph/edges', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
  deleteGraphEdge(id: string) {
    return request<{ ok: boolean }>(`/api/graph/edges/${id}`, { method: 'DELETE' });
  },

  /** 上传笔记图片，返回可写入 Markdown 的 url */
  async uploadImage(file: File) {
    const headers = new Headers();
    const token = getToken();
    if (token) headers.set('Authorization', `Bearer ${token}`);
    const body = new FormData();
    body.append('file', file);
    const res = await fetch('/api/uploads', { method: 'POST', headers, body });
    const data = (await res.json().catch(() => ({}))) as { error?: string; url?: string };
    if (!res.ok) {
      throw new Error(data.error || `上传失败 (${res.status})`);
    }
    if (!data.url) throw new Error('上传失败：未返回地址');
    return data as { url: string; name: string; size: number };
  },

  /** 删除 data/uploads 下的图片文件 */
  deleteUpload(name: string) {
    const safe = name.replace(/^.*[/\\]/, '');
    return request<{ ok: boolean }>(`/api/uploads/${encodeURIComponent(safe)}`, {
      method: 'DELETE',
    });
  },
};
