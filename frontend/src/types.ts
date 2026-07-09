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

export type Tag = {
  id: string;
  name: string;
  color: string;
  noteCount?: number;
  createdAt?: string;
};

export type NoteListItem = {
  id: string;
  notebookId: string | null;
  title: string;
  preview?: string;
  isFavorite: boolean;
  isLocked: boolean;
  deletedAt: string | null;
  sortOrder: number;
  tags: Tag[];
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
  | { type: 'tag'; id: string }
  | { type: 'search'; q: string };
