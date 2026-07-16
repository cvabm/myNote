import type { Note, NoteListItem, Notebook, User } from './types';

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
    return request<{ ok: boolean }>('/api/auth/change-password', {
      method: 'POST',
      body: JSON.stringify({ oldPassword, newPassword }),
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

  listNotes(params: Record<string, string | undefined> = {}) {
    const qs = new URLSearchParams();
    Object.entries(params).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, v);
    });
    const q = qs.toString();
    return request<NoteListItem[]>(`/api/notes${q ? `?${q}` : ''}`);
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
      isFavorite: boolean;
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
