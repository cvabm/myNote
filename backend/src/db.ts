import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';

const DB_PATH = process.env.DB_PATH || './data/mynote.db';
const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'admin123';

fs.mkdirSync(path.dirname(path.resolve(DB_PATH)), { recursive: true });

export const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      display_name TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS notebooks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      parent_id TEXT,
      name TEXT NOT NULL,
      color TEXT NOT NULL DEFAULT '#6366f1',
      icon TEXT NOT NULL DEFAULT 'folder',
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (parent_id) REFERENCES notebooks(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS notes (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      notebook_id TEXT,
      title TEXT NOT NULL DEFAULT '未命名笔记',
      content TEXT NOT NULL DEFAULT '',
      content_html TEXT NOT NULL DEFAULT '',
      is_favorite INTEGER NOT NULL DEFAULT 0,
      is_locked INTEGER NOT NULL DEFAULT 0,
      deleted_at TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
      FOREIGN KEY (notebook_id) REFERENCES notebooks(id) ON DELETE SET NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS notes_fts USING fts5(
      note_id UNINDEXED,
      title,
      content,
      tokenize = 'unicode61'
    );

    CREATE INDEX IF NOT EXISTS idx_notes_user ON notes(user_id);
    CREATE INDEX IF NOT EXISTS idx_notes_notebook ON notes(notebook_id);
    CREATE INDEX IF NOT EXISTS idx_notes_deleted ON notes(deleted_at);
    CREATE INDEX IF NOT EXISTS idx_notes_favorite ON notes(is_favorite);
    CREATE INDEX IF NOT EXISTS idx_notebooks_user ON notebooks(user_id);
    CREATE INDEX IF NOT EXISTS idx_notebooks_parent ON notebooks(parent_id);

    -- 说说（类似 QQ 空间 / 推特的短动态）
    CREATE TABLE IF NOT EXISTS moments (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      images TEXT NOT NULL DEFAULT '[]',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_moments_user ON moments(user_id);
    CREATE INDEX IF NOT EXISTS idx_moments_created ON moments(user_id, created_at DESC);
  `);

  // 历史版本曾有标签表，启动时清理
  db.exec(`
    DROP TABLE IF EXISTS note_tags;
    DROP TABLE IF EXISTS tags;
  `);

  const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(ADMIN_USER) as
    | { id: string }
    | undefined;

  if (!existing) {
    const userId = nanoid();
    const hash = bcrypt.hashSync(ADMIN_PASS, 10);
    db.prepare(
      'INSERT INTO users (id, username, password_hash, display_name) VALUES (?, ?, ?, ?)'
    ).run(userId, ADMIN_USER, hash, '管理员');

    const defaultNb = nanoid();
    db.prepare(
      `INSERT INTO notebooks (id, user_id, parent_id, name, color, icon, sort_order)
       VALUES (?, ?, NULL, ?, ?, ?, 0)`
    ).run(defaultNb, userId, '默认笔记本', '#6366f1', 'book');

    const welcomeId = nanoid();
    const welcomeTitle = '欢迎使用 MyNote';
    const welcomeContent = `# 欢迎使用 MyNote

这是一款可自托管部署的私有笔记工具，灵感来自 [nowen-note](https://github.com/cropflre/nowen-note)。

## 功能

- **多级笔记本**：无限层级组织你的知识
- **Markdown 编辑**：所见即所得式预览
- **说说**：像 QQ 空间 / 推特一样发短动态
- **收藏 / 回收站**
- **全文搜索**：快速找到任意笔记
- **Docker 一键部署**

## 快速上手

1. 在左侧创建笔记本或笔记
2. 用 Markdown 书写内容
3. 用顶部搜索框全文检索
4. 首次登录后请立即修改密码

---

*默认账号：\`admin\` / \`admin123\`*
`;
    db.prepare(
      `INSERT INTO notes (id, user_id, notebook_id, title, content, sort_order)
       VALUES (?, ?, ?, ?, ?, 0)`
    ).run(welcomeId, userId, defaultNb, welcomeTitle, welcomeContent);

    db.prepare(
      `INSERT INTO notes_fts (note_id, title, content) VALUES (?, ?, ?)`
    ).run(welcomeId, welcomeTitle, welcomeContent);

    console.log(`[init] 已创建管理员: ${ADMIN_USER} / ${ADMIN_PASS}`);
  }
}

export function syncNoteFts(noteId: string, title: string, content: string) {
  db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(noteId);
  db.prepare('INSERT INTO notes_fts (note_id, title, content) VALUES (?, ?, ?)').run(
    noteId,
    title,
    content
  );
}

export function removeNoteFts(noteId: string) {
  db.prepare('DELETE FROM notes_fts WHERE note_id = ?').run(noteId);
}
