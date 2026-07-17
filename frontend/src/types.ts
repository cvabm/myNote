export type User = {
  id: string;
  username: string;
  displayName: string;
};

export type Notebook = {
  id: string;
  parentId: string | null;
  name: string;
  color: string;
  icon: string;
  sortOrder: number;
  noteCount: number;
  createdAt: string;
  updatedAt: string;
};

export type NoteListItem = {
  id: string;
  notebookId: string | null;
  title: string;
  preview?: string;
  isFavorite: boolean;
  deletedAt: string | null;
  sortOrder: number;
  createdAt: string;
  updatedAt: string;
};

export type Note = NoteListItem & {
  content: string;
  contentHtml: string;
};

export type ViewFilter =
  | { type: 'all' }
  | { type: 'notebook'; id: string }
  | { type: 'favorite' }
  | { type: 'trash' }
  | { type: 'search'; q: string }
  /** 说说；可选 q 为正文搜索关键字 */
  | { type: 'moments'; q?: string };

/** 说说（类似 QQ 空间 / 推特的短动态） */
export type Moment = {
  id: string;
  content: string;
  images: string[];
  createdAt: string;
  updatedAt: string;
};

/** 列表分页响应 */
export type PageResult<T> = {
  items: T[];
  hasMore: boolean;
};
