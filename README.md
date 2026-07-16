# MyNote

自托管私有笔记 / 知识库，可部署在你自己的服务器上。

设计思路参考 [nowen-note](https://github.com/cropflre/nowen-note)：三栏布局、多级笔记本、Markdown、收藏、回收站、全文搜索、Docker 一键部署。

## 功能

| 功能 | 说明 |
| --- | --- |
| 用户登录 | JWT 鉴权，可修改密码 |
| 暗色主题 | 浅色 / 深色 / 跟随系统 |
| 多级笔记本 | 无限层级树形组织 |
| Markdown 编辑 | 预览 / 编辑 / 分栏，自动保存 |
| 图片 | 工具栏上传、粘贴、拖拽；存于 `data/uploads` |
| 收藏 | 快速收藏重要笔记 |
| 回收站 | 软删除、恢复、永久删除、清空 |
| 全文搜索 | 即时搜索、关键字高亮（SQLite FTS5） |
| Docker 部署 | 数据卷持久化 |

## 快速开始（Docker，推荐）

```bash
# 1. 进入项目目录
cd myNote

# 2. （可选）复制环境变量并修改密钥与默认密码
cp .env.example .env
# 编辑 JWT_SECRET、ADMIN_PASS 等

# 3. 启动
docker compose up -d --build

# 4. 浏览器访问
# http://你的服务器IP:3001
```

默认账号：`admin` / `admin123`（**首次登录后请立即修改密码**）

数据目录：`./data`（挂载到容器 `/app/data`）

## 本地开发

需要 **Node.js 20+**。

```bash
npm run install:all

# 终端 1：后端 :3001
npm run dev:backend

# 终端 2：前端 :5173（已代理 /api）
npm run dev:frontend
```

访问 <http://localhost:5173>

## 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `PORT` | `3001` | 服务端口 |
| `DB_PATH` | `./data/mynote.db` | SQLite 路径 |
| `JWT_SECRET` | 内置开发密钥 | **生产务必修改** |
| `ADMIN_USER` | `admin` | 首次初始化管理员用户名 |
| `ADMIN_PASS` | `admin123` | 首次初始化管理员密码 |
| `TZ` | `Asia/Shanghai` | 时区 |
| `STATIC_DIR` | — | 前端静态目录（Docker 内置） |

> 管理员仅在数据库不存在对应用户时创建一次。之后改 `ADMIN_PASS` 环境变量不会覆盖已有密码，请在应用「设置」中修改。

## 技术栈

- **前端**：React 18 + Vite + TypeScript + Tailwind CSS + `@uiw/react-md-editor`
- **后端**：Hono + better-sqlite3 + jose (JWT)
- **部署**：Docker multi-stage + docker-compose

## 目录结构

```
myNote/
├── backend/          # API 服务
├── frontend/         # Web 界面
├── data/             # 运行时数据（gitignore）
├── docker-compose.yml
├── Dockerfile
└── README.md
```

## API 概览

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| POST | `/api/auth/login` | 登录 |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/change-password` | 改密 |
| CRUD | `/api/notebooks` | 笔记本 |
| CRUD | `/api/notes` | 笔记（含 trash/restore） |
| POST | `/api/uploads` | 上传图片（需登录） |
| GET | `/uploads/*` | 访问已上传图片 |
| GET | `/api/health` | 健康检查 |

## 从 Flatnotes / Markdown 导入

1. 备份原 Markdown 数据目录。  
2. 登录 MyNote → **设置** → **导入 Markdown**。  
3. **选择文件夹**（保留目录结构为笔记本）或 **选择 .md 文件**。  
4. 等待进度完成，侧边栏会自动刷新。

## 与 nowen-note 的差异

本项目定位为**轻量可维护的核心笔记服务**，便于二次开发和长期自托管。未包含：AI 助手、思维导图、任务中心、Yjs 实时协作、Electron/移动端、对象存储等。若需要完整生态，可直接使用 [nowen-note](https://github.com/cropflre/nowen-note)。

## License

MIT
