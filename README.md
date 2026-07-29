# MyNote

自托管私有笔记 / 知识库，可部署在你自己的服务器上。

设计思路参考 [nowen-note](https://github.com/cropflre/nowen-note)：三栏布局、多级笔记本、Markdown、回收站、全文搜索、Docker 一键部署。

## 功能

| 功能 | 说明 |
| --- | --- |
| 用户登录 | JWT 鉴权；改密 / 退出其它设备会使旧 token 失效；登录限流 |
| 暗色主题 | 浅色 / 深色 / 跟随系统 |
| 思维导图 | 主入口：结构浏览、搜索、预览与编辑笔记 |
| Markdown 编辑 | 预览 / 编辑 / 分栏，自动保存 |
| 图片 | 工具栏上传、粘贴、拖拽；预览可删除（正文+文件）；存于 `data/uploads` |
| 说说 | 类似 QQ 空间 / 推特的短动态：文字 + 最多 9 图、编辑删除、正文搜索 |
| 思维导图 | 按笔记本层级展开的思维导图；点击折叠/展开，点笔记打开编辑 |
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
| `DB_PATH` | `./data/mynote.db` | SQLite 路径（相对路径相对**仓库根目录**，不是 `backend/` 工作目录） |
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
| POST | `/api/auth/login` | 登录（失败限流） |
| GET | `/api/auth/me` | 当前用户 |
| POST | `/api/auth/change-password` | 改密（其它设备 JWT 失效，返回新 token） |
| POST | `/api/auth/logout-all` | 退出其它/全部登录（`keepCurrent`） |
| POST | `/api/auth/logout-all` | 退出其它/全部登录（`keepCurrent`） |
| CRUD | `/api/notebooks` | 笔记本 |
| CRUD | `/api/notes` | 笔记（含 trash/restore；列表支持 `limit`/`offset` 分页） |
| CRUD | `/api/moments` | 说说（短动态；列表支持 `limit`/`before` 游标分页） |
| GET/POST | `/api/graph` | 知识图全量数据 / 强制重建 |
| CRUD | `/api/graph/nodes` | 图节点（游离概念创建/改/删；位置固定） |
| CRUD | `/api/graph/edges` | 手动连线（wiki/系统边由同步生成） |
| POST | `/api/uploads` | 上传图片（需登录） |
| GET | `/uploads/*` | 访问已上传图片 |
| GET | `/api/health` | 健康检查 |

## 从 Flatnotes / Markdown 导入

1. 备份原 Markdown 数据目录。  
2. 登录 MyNote → **设置** → **导入 Markdown**。  
3. **选择文件夹**（子目录→笔记本；根目录文件→默认笔记本）或 **选择 .md 文件**。  
4. 等待进度完成，侧边栏会自动刷新。

## 与 nowen-note 的差异

本项目定位为**轻量可维护的核心笔记服务**，便于二次开发和长期自托管。已包含知识地球（图视图 + wiki 链）。未包含：AI 助手、任务中心、Yjs 实时协作、Electron/移动端、对象存储等。若需要完整生态，可直接使用 [nowen-note](https://github.com/cropflre/nowen-note)。

### 思维导图

1. 侧栏进入 **思维导图**（默认首页）。  
2. 点击分类展开/折叠；点击笔记预览；右键/长按可新建、重命名、删除。  
3. 顶栏搜索支持标题与正文（Ctrl+F 聚焦搜索框）。

## License

MIT
