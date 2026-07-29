export type User = {
  id: string;
  username: string;
  displayName: string;
  sessionId?: string | null;
};

/** 登录设备 / 会话（不含 IP） */
export type LoginSession = {
  id: string;
  deviceLabel: string;
  userAgent: string;
  createdAt: string;
  lastSeenAt: string;
  current: boolean;
  browser?: string;
  browserVersion?: string;
  os?: string;
  osVersion?: string;
  deviceType?: string;
  engine?: string;
  platform?: string;
  language?: string;
  timezone?: string;
  screen?: string;
  colorDepth?: number | null;
  devicePixelRatio?: number | null;
  maxTouchPoints?: number | null;
  hardwareConcurrency?: number | null;
  deviceMemory?: number | null;
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
  /** @deprecated 笔记本已移除，读链接时回退 all */
  | { type: 'notebook'; id: string }
  | { type: 'trash' }
  | { type: 'search'; q: string }
  /** 说说；可选 q 为正文搜索关键字 */
  | { type: 'moments'; q?: string }
  /** 思维导图（分类节点 + 笔记叶子） */
  | { type: 'mindmap' }
  /** @deprecated 兼容旧链接 ?v=globe */
  | { type: 'globe' };

/** 思维导图节点 */
export type MindNode = {
  id: string;
  type: 'root' | 'notebook' | 'note';
  title: string;
  color?: string;
  refId?: string | null;
  noteCount?: number;
  children: MindNode[];
};

export type MindmapData = {
  root: MindNode;
  noteCount: number;
  notebookCount: number;
};

/** 知识图节点 */
export type GraphNode = {
  id: string;
  type: 'concept' | 'note' | 'notebook';
  refId: string | null;
  title: string;
  color: string;
  x: number;
  y: number;
  pinned: boolean;
  degree?: number;
  clusterId?: string | null;
  createdAt?: string;
  updatedAt?: string;
};

/** 知识图边 */
export type GraphEdge = {
  id: string;
  fromId: string;
  toId: string;
  relation: string;
  source: 'wiki' | 'system' | 'manual';
  weight: number;
  createdAt?: string;
};

export type GraphData = {
  nodes: GraphNode[];
  edges: GraphEdge[];
};

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
