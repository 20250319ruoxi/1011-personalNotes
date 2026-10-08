# 个人笔记 · 项目需求与设计文档

- 版本：v1.0
- 日期：2026-10-08
- 状态：待 master 评审
- 素材依据：`个人笔记提示词.md`、`个人笔记主页.jpg`、`图片素材/个人笔记-主页截图.jpg`、`个人笔记-笔记背景.jpg`

---

## Context

当前目录尚无任何代码，只有需求提示词与两张视觉素材（主页写真图、笔记纸张背景图），因此本文档同时承担「需求确认」与「系统设计」两个职责，作为后续实施计划的唯一依据。

要实现的是一个可部署到公网的在线个人笔记应用：用户可以注册登录、撰写与保存 Markdown 笔记、以草稿/私密/公开分享三种状态管理笔记、通过链接（可选密码）把笔记分享给他人、收藏自己或他人分享的笔记、对笔记发表评论，并在个人主页回顾自己的笔记与浏览足迹。

技术栈由需求固定为「前端 html+js+css / 后端 Python+Flask / 数据库 SQLite」，并强制两条规范：统一错误响应体 `{ "code", "message" }`（前端展示中文 message）与依赖国内镜像且锁定版本。

## Goals

- 交付一个可本机启动、按公网标准加固的完整笔记应用，覆盖提示词列出的全部功能点。
- 前端所有请求走统一 JSON API，错误提示一律取后端 `message`，前端不自行编造中文文案。
- 主视觉严格对齐已确认的主页设计稿；笔记区使用纸张背景塑造「书写」氛围且保证长文可读。
- 公私边界清晰：草稿仅本人可见，私密仅本人可见，公开笔记仅能通过带 token 的分享链接访问，首页不做任何曝光。
- 后端仅依赖标准库与两个第三方包（Flask、Pillow），版本全部锁定并使用国内镜像安装。

## Non-Goals

- **AI 润色功能本期不做**（`提示词/ai润色提示词.txt` 描述的功能整体延后），不预留右键菜单入口。
- 不做邮箱验证、不做找回密码。
- 不做评论的嵌套回复与楼层，只做一级扁平评论。
- 不做公开笔记广场、推荐流、他人主页。
- 不做笔记历史版本回溯、回收站还原。
- 不做暗色模式、多语言、导出 PDF/Word、协同编辑。
- 不做富文本所见即所得编辑器，仅 Markdown 源码 + 实时预览。

## Recommended Approach

采用 **单页应用（静态前端）+ Flask JSON API + 原生 sqlite3** 的组合：

- 前端 `index.html` 承载全部路由，用 History API 切换视图，所有数据经 `fetch` 调用 `/api/*`；Flask 提供 catch-all 兜底返回 `index.html`，使 `/notes/12`、`/s/<token>` 可直接刷新访问。
- 数据访问层只用标准库 `sqlite3` 配一层轻量 DAO（参数化 SQL、`Row` 工厂、开启外键与 WAL），把第三方依赖压到 `Flask` + `Pillow` 两个，最贴合「锁定依赖版本」的规范。
- Markdown 在前端用本地 vendor 的 `marked` 渲染、`DOMPurify` 清洗，使「写笔记」页面的分栏实时预览零延迟。
- 登录态使用 Flask Session Cookie（`HttpOnly` + `SameSite=Lax`）配合 CSRF Token 请求头，同源 SPA 天然适配且支持服务端注销。

## Alternatives Considered

| 方案 | 优点 | 缺点 | 决策 |
|------|------|------|------|
| 纯静态 SPA + JSON API | URL 干净、无整页刷新、与 `{code,message}` 约定天然契合 | 需要 catch-all 兜底与前端路由 | **采用** |
| Jinja2 模板服务端渲染 | 首屏即可见内容、SEO 友好 | 页面跳转整页刷新，与 JSON 错误约定割裂 | 否决 |
| 前后端混合渲染 | 兼顾 | 两套渲染逻辑并存，维护成本翻倍 | 否决 |
| 原生 sqlite3 + 轻量 DAO | 依赖最少、SQL 透明可控 | 需手写映射与 SQL | **采用** |
| Flask-SQLAlchemy | 模型清晰、关系管理方便 | 依赖链变长，SQLite 场景偏重 | 否决 |
| 前端 marked + DOMPurify | 实时预览零延迟、后端轻量 | 依赖前端清洗库 | **采用** |
| 后端 python-markdown + bleach | 输出统一可控 | 每字输入都要请求后端，破坏实时预览 | 否决 |
| 前后端双渲染 | 体验与可控兼顾 | 两套渲染器需保持行为一致，风险高 | 否决 |
| Session Cookie + CSRF Token | 可服务端注销、无需前端存凭证 | 需实现 CSRF 校验 | **采用** |
| JWT | 无状态、可跨域 | 无法服务端注销、前端存储放大 XSS 风险 | 否决 |
| Hash 路由（`#/notes`） | 无需服务端配置 | URL 丑陋、分享链接带 `#` 不美观 | 否决 |
| History API 路由 | URL 干净、分享链接为 `/s/<token>` | 需要 Flask catch-all 兜底 | **采用** |

---

## Architecture

### 运行时形态

```
浏览器 (静态 SPA, History API 路由)
   │  fetch /api/*  ·  Cookie: session  ·  Header: X-CSRF-Token
   ▼
Flask 应用（蓝图拆分）
   ├── /api/*        JSON 接口，统一 ok()/fail() 响应
   ├── /s/<token> 等  catch-all → 返回 index.html
   └── /static/*     静态资源（含 static/uploads 用户图片）
   ▼
core/db.py（连接管理 + DAO）→ SQLite (db/app.db, WAL, 外键开启)
```

单进程即可运行；生产环境建议置于 WSGI 服务器与反向代理之后（见 Rollout）。

### 目录结构

```
personalNodes/
├── app.py                    # 应用入口、蓝图注册、全局错误处理、catch-all、CLI 初始化
├── config.py                 # 密钥、上传限制、分页大小、会话配置（读环境变量）
├── requirements.txt          # 锁定版本的依赖清单
├── pip.conf                  # 国内镜像配置（清华 TUNA）
├── README.md                 # 启动方式与依赖安装说明
├── db/schema.sql             # 幂等建表语句
├── core/
│   ├── db.py                 # 连接获取/释放、Row 工厂、PRAGMA、各表 DAO
│   ├── response.py           # ok(data, message) / fail(code, message, http_status)
│   ├── errors.py             # 错误码常量与「code → HTTP 状态 + 中文文案」映射
│   ├── auth.py               # login_required 装饰器、CSRF 校验、当前用户解析
│   ├── validators.py         # 邮箱/用户名/密码/标题/标签/评论校验
│   ├── security.py           # 密码哈希、share_token 生成、限流记录与判定
│   └── markdown.py           # （仅用于服务端摘要/纯文本预览，不做渲染）
├── api/
│   ├── auth.py  users.py  notes.py  tags.py
│   ├── share.py  comments.py  favorites.py  history.py  uploads.py
├── static/
│   ├── css/   base.css home.css auth.css notes.css editor.css profile.css share.css about.css
│   ├── js/    api.js router.js store.js ui.js
│   │          + 页面模块 home.js auth.js notes.js editor.js profile.js share.js about.js
│   ├── vendor/ marked.min.js  DOMPurify.min.js     # 锁定版本，本地引用
│   ├── img/   hero.jpg（主页写真） paper.jpg（纸张背景） logo.svg
│   └── uploads/                                    # 运行时生成，存放用户图片
└── index.html                # SPA 入口，按路由挂载视图
```

### 认证与会话

- 密码使用 `werkzeug.security.generate_password_hash`（`pbkdf2:sha256`）存储，校验用 `check_password_hash`。
- 登录成功后把 `user_id` 写入 Flask Session；Cookie 固定 `HttpOnly=True`、`SameSite=Lax`，生产环境追加 `Secure`。
- 登录成功或 `GET /api/auth/me` 时下发 CSRF Token（存于 Session），前端存入内存变量；此后所有 `POST/PUT/DELETE` 请求必须带 `X-CSRF-Token` 头，服务端比对失败即返回 `CSRF_INVALID`。
- **无需 CSRF 的接口**：`POST /auth/register`、`POST /auth/login`、`POST /share/<token>/verify` 在调用时可能尚无会话，不要求 CSRF Token，改由校验 `Origin`（缺失时回退 `Referer`）必须同源 + 失败限流共同防护跨站请求。
- 登录失败与分享密码校验失败记录到 `auth_attempts` 表，同一 `key` 15 分钟内失败 ≥ 5 次即返回 `RATE_LIMITED`；成功校验后清除该 key 的记录。

### 数据模型

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  avatar        TEXT,                      -- 头像图片 URL，为空则前端用用户名首字色块
  bio           TEXT,
  created_at    TEXT    NOT NULL           -- ISO8601 UTC
);

CREATE TABLE IF NOT EXISTS notes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               TEXT    NOT NULL DEFAULT '',
  content_md          TEXT    NOT NULL DEFAULT '',
  status              TEXT    NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','private','public')),
  share_token         TEXT    UNIQUE,      -- 仅 status='public' 时存在
  share_password_hash TEXT,                -- 为空表示分享链接无需密码
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  published_at        TEXT,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_owner   ON notes(user_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_status  ON notes(user_id, status, is_deleted);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id, created_at);

CREATE TABLE IF NOT EXISTS favorites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  UNIQUE (user_id, note_id)
);

CREATE TABLE IF NOT EXISTS view_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  viewed_at TEXT    NOT NULL,
  UNIQUE (user_id, note_id)                -- 重复浏览更新 viewed_at
);
CREATE INDEX IF NOT EXISTS idx_history_user ON view_history(user_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL,                -- 'login' | 'share'
  key        TEXT NOT NULL,                -- 登录为小写邮箱，分享为 share_token
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts ON auth_attempts(scope, key, created_at);
```

**关键设计说明**

- 「草稿 / 私密 / 公开」由 `notes.status` 单一字段表达：`draft` 未发布、`private` 已保存但不对外、`public` 对外分享。
- 关闭分享时清空 `share_token` 与 `share_password_hash`，`status` 回退为 `private`；重新开启分享生成新的 token。不引入额外的 `share_enabled` 冗余状态。
- 笔记与评论采用软删除（`is_deleted = 1`），使收藏、足迹中的失效条目仍可定位并给出「内容已失效」提示。
- 标签为全局共享字典表 + 多对多关联表，支持「灵活分类」。
- 浏览足迹按 `(user_id, note_id)` 去重，重复浏览仅刷新时间；仅记录已登录用户的浏览。

---

## API 契约

### 响应体规范

- 成功：HTTP 200，`{ "code": "OK", "message": "操作成功", "data": <任意> }`
- 失败：HTTP 状态码语义化（400/401/403/404/409/413/429/500），响应体 `{ "code": "<错误码>", "message": "<中文提示>", "data": null }`
- 前端 `static/js/api.js` 统一拦截：无论 HTTP 状态为何，只要 `code !== "OK"` 就用 `message` 弹 toast，并把 `code` 交给调用方做分支处理（如 `SHARE_PASSWORD_REQUIRED` 跳密码锁屏）。前端不维护中文错误文案字典。

### 错误码表

| code | HTTP | message（示例文案） | 触发场景 |
|------|------|--------------------|----------|
| `OK` | 200 | 操作成功 | — |
| `INVALID_PARAM` | 400 | 参数不合法，请检查后重试 | 字段缺失/格式错误 |
| `EMAIL_INVALID` | 400 | 请输入正确的邮箱地址 | 邮箱格式校验失败 |
| `EMAIL_EXISTS` | 409 | 该邮箱已被注册 | 注册邮箱重复 |
| `USERNAME_EXISTS` | 409 | 该用户名已被占用 | 注册用户名重复 |
| `PASSWORD_WEAK` | 400 | 密码长度需为 8-64 位，且包含字母与数字 | 密码强度不足 |
| `PASSWORD_MISMATCH` | 400 | 两次输入的密码不一致 | 确认密码不符 |
| `PASSWORD_WRONG` | 400 | 原密码不正确 | 修改密码时旧密码错误 |
| `INVALID_CREDENTIALS` | 401 | 邮箱或密码错误 | 登录失败 |
| `RATE_LIMITED` | 429 | 尝试过于频繁，请稍后再试 | 登录/分享密码失败次数超限 |
| `UNAUTHORIZED` | 401 | 请先登录 | 未登录访问受保护接口 |
| `CSRF_INVALID` | 403 | 请求校验失败，请刷新页面后重试 | CSRF Token 缺失或不匹配 |
| `FORBIDDEN` | 403 | 没有权限执行该操作 | 操作他人笔记/评论 |
| `NOT_FOUND` | 404 | 请求的内容不存在 | 资源不存在或非本人笔记 |
| `SHARE_DISABLED` | 404 | 该分享链接已失效 | token 无效或分享已关闭 |
| `SHARE_PASSWORD_REQUIRED` | 401 | 该笔记需要密码访问 | 访问设置密码的分享 |
| `SHARE_PASSWORD_WRONG` | 401 | 访问密码错误 | 分享密码校验失败 |
| `TAG_TOO_MANY` | 400 | 最多只能添加 5 个标签 | 标签数量超限 |
| `CONTENT_TOO_LONG` | 400 | 输入内容超出长度限制 | 标题/正文/评论超长 |
| `UPLOAD_TOO_LARGE` | 413 | 图片大小不能超过 5MB | 单文件超限 |
| `UPLOAD_TYPE_INVALID` | 400 | 仅支持 JPG、PNG、GIF、WebP 格式的图片 | 类型/真实解码校验失败 |
| `STORAGE_QUOTA_EXCEEDED` | 413 | 存储空间不足，请先清理历史图片 | 单用户上传总量达到上限 |
| `ALREADY_FAVORITED` | 409 | 已收藏过该笔记 | 重复收藏 |
| `INTERNAL_ERROR` | 500 | 服务器开小差了，请稍后重试 | 未捕获异常 |

### 接口清单

统一前缀 `/api`，除标注「公开」外均需登录。

**认证 `auth`**

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| POST | `/auth/register` | `email, username, password, confirm_password` | `{ user }` 并自动登录 |
| POST | `/auth/login` | `email, password` | `{ user, csrf_token }` |
| POST | `/auth/logout` | — | `null` |
| GET | `/auth/me` | — | `{ user, csrf_token }`，未登录返回 `data.user = null` |

**用户 `users`**

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| GET | `/users/me/profile` | — | `{ user }` |
| PUT | `/users/me/profile` | `username?, bio?, avatar?` | `{ user }` |
| PUT | `/users/me/password` | `old_password, new_password, confirm_password` | `null` |

**笔记 `notes`**

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| GET | `/notes` | `status?`(all/draft/private/public) `q?` `tag?` `sort?`(updated/created) `page?` `page_size?` | `{ items[], total, page, page_size }` |
| POST | `/notes` | `title, content_md, tags[], status` | `{ note }`；`status=draft` 即存草稿 |
| GET | `/notes/<id>` | — | `{ note }`（本人笔记；他人仅在被分享且已通过密码校验时返回） |
| PUT | `/notes/<id>` | `title?, content_md?, tags?, status?` | `{ note }` |
| DELETE | `/notes/<id>` | — | `null`（软删除） |

**标签 `tags`**

| 方法 | 路径 | 返回 |
|------|------|------|
| GET | `/tags` | 当前用户使用过的标签及计数 `{ items[{name, count}] }` |

**分享 `share`**

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| POST | `/notes/<id>/share` | `password?`（空字符串=无密码） | `{ share_url, has_password }` |
| DELETE | `/notes/<id>/share` | — | `null`（关闭分享，状态回退 private） |
| GET | `/share/<token>` | 公开 | 无密码→`{ note, author }`；有密码未校验→`SHARE_PASSWORD_REQUIRED` |
| POST | `/share/<token>/verify` | `password` | 校验通过返回 `{ note, author }`，并在 Session 中记录该 token 已解锁 |

**评论 `comments`**

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| GET | `/notes/<id>/comments` | `page?` `page_size?` | 仅本人笔记；`{ items[], total }` |
| POST | `/notes/<id>/comments` | `content` | `{ comment }`，仅本人笔记 |
| GET | `/share/<token>/comments` | `page?` `page_size?` | 公开（设密需已解锁） |
| POST | `/share/<token>/comments` | `content` | 登录用户可评论；`{ comment }` |
| DELETE | `/comments/<id>` | — | 评论作者或笔记作者可删；软删除 |

**收藏 `favorites`**

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| GET | `/favorites` | `page?` `page_size?` | `{ items[{ note, author, available }], total }` |
| POST | `/favorites` | `note_id` | `null`；目标须为本人笔记或当前用户可访问的分享笔记 |
| DELETE | `/favorites/<note_id>` | — | `null` |

**浏览足迹 `history`**

| 方法 | 路径 | 返回 |
|------|------|------|
| GET | `/history` | `{ items[{ note, author, available, viewed_at }], total }` |
| DELETE | `/history` | `null`（清空全部足迹）；支持 `DELETE /history/<note_id>` 删除单条 |

**上传 `uploads`**

| 方法 | 路径 | 入参 | 返回 |
|------|------|------|------|
| POST | `/uploads/image` | `multipart/form-data: file` | `{ url }`，即 `static/uploads/` 下的相对路径，供 Markdown 引用 |

**统一的失效处理**：`favorites` / `history` 返回的条目若其笔记不可访问（已删除、或他人已关闭分享），返回 `available: false` 且 `note.title` 为 `null`，前端渲染为「内容已失效」占位卡片。

---

## Interface Design Contract

### Experience and Journeys

**目标用户**：习惯用 Markdown 记录日常与思考的个人用户；可能把某几篇笔记通过链接分享给朋友。

**界面最核心的职责**：让「写下 → 保存 → 回看 → 必要时分享」这条链路在四步之内完成，且在视觉上传达「安静的书写感」而非「管理工具的密度」。

**主要旅程**

1. **初次到访 → 开始记录**
   主页（未登录，顶栏 `登录 / 注册 / 关于`）→ 点击「开始记录」→ 未登录则跳转 `/login` 并记录回跳目标 → 登录成功回到 `/notes/new`。
2. **登录 → 写笔记 → 存草稿 → 发布**
   `/notes/new` → 输入标题、正文（左侧源码）、右侧实时预览 → 点「存草稿」→ toast「已保存为草稿」；继续点「发布」→ 弹出轻量确认 → 状态变为 `private`。
3. **回看与管理**
   顶栏「我的主页」→ `/me` →「我的笔记」Tab 按状态/标签/关键词筛选 → 点进详情 → 编辑 / 收藏 / 删除（二次确认）。
4. **分享给朋友**
   笔记详情 →「分享」按钮 → 面板中可选设置密码 → 生成 `/s/<token>` 链接 → 复制。朋友打开链接：无密码直接阅读；有密码先看到居中锁屏卡片，输入正确后进入正文并可在下方评论（需登录）。
5. **发现他人分享的笔记**
   通过链接打开 `/s/<token>` → 登录后点「收藏」→ 该笔记进入 `/me` 的「我的收藏」；同时被记入「浏览足迹」。
6. **失效恢复路径**
   打开的分享链接已被作者关闭 → 显示「该分享链接已失效」空态页并给出「返回首页」按钮；收藏/足迹中的失效条目显示占位卡片 + 「移除」操作。

**信息层级**：主页为单页宣传叙事（标题 → 副文案 → 行动按钮 → 四项特性）；应用内以「顶栏 + 内容区」两层结构，顶栏承载身份与主入口，内容区以纸张卡片为唯一容器承载信息。

### 信息架构与路由

| 路由 | 视图 | 访问控制 | 顶栏状态 |
|------|------|----------|----------|
| `/` | 主页 | 公开 | 未登录：登录 / 注册 / 关于 |
| `/login` | 登录 | 公开（已登录则跳 `/me`） | 同上 |
| `/register` | 注册 | 公开 | 同上 |
| `/about` | 关于 | 公开 | 同上 |
| `/notes` | 笔记列表 | 需登录 | 已登录：写笔记 / 我的主页 / 头像菜单 |
| `/notes/new` | 写笔记 | 需登录 | 同上 |
| `/notes/<id>/edit` | 编辑笔记 | 仅作者 | 同上 |
| `/notes/<id>` | 笔记详情（含分享面板、评论） | 仅作者 | 同上 |
| `/me` | 个人主页（四 Tab） | 需登录 | 同上 |
| `/s/<token>` | 分享页 | 公开（设密需解锁） | 未登录：登录 / 注册 / 关于；已登录：同上 |

个人主页 `/me` 的 Tab：`个人信息`（头像、用户名、邮箱、简介、改密入口）/ `我的笔记`（状态+标签+关键词筛选、分页）/ `我的收藏` / `浏览足迹`。

### Layout and Responsive Behavior

**主页（对齐 `图片素材/个人笔记-主页截图.jpg`）**

```
┌───────────────────────────────────────────────────────┐
│ [◪ logo] 个人笔记              登录   注册   关于      │ 顶栏 72px，白底，底部 1px 分割线
├───────────────────────────────────────────────────────┤
│                                          ╲            │
│   记录生活 · 书写成长 ♡                   ╲  写实背景   │ hero 高度≈视口高减去特性条
│   遇见美好                                 ╲  (hero.jpg) │ 文案区占左侧约 45%
│   ──────                                              │ 标题下 4px 金色短下划线
│   个人笔记是一款简洁优雅的在线笔记应用，                 │
│   帮助你随时随地记录灵感、管理任务、沉淀思考，           │
│   让每一个想法都被珍藏，让每一天都更有意义。             │
│                                                       │
│   [✎ 开始记录]  [▷ 了解更多]                           │ 主按钮填充驼金 / 次按钮描边
│                                                       │
│   ○ 简洁易用   ○ 云端同步   ○ 隐私保护   ○ 灵活分类    │ 特性条：圆底图标 + 标题 + 说明
└───────────────────────────────────────────────────────┘
```

**写笔记 / 详情（纸张容器）**

```
顶栏（同应用内）
┌──────────────── 纸张容器 (paper.jpg + 柔和内阴影) ────────────────┐
│  标题输入框（无边框大字号）            [标签+ ][存草稿][发布/保存]  │
│  ─────────────────────────────────────────────────────────────  │
│  ┌── Markdown 源码 (textarea) ──┬── 实时预览 (marked+DOMPurify) ──┐│
│  │                             │                                ││
│  │  ## 小标题                   │  小标题                         ││
│  │  - 列表项                    │  • 列表项                       ││
│  └─────────────────────────────┴────────────────────────────────┘│
│  底部状态：已保存 · 字数 · 最后更新时间                            │
└──────────────────────────────────────────────────────────────────┘
```

笔记详情为单栏纸张：标题 → 元信息（作者、时间、标签）→ 正文（右对齐最大宽度 720px 保证可读）→ 操作条（收藏 / 分享 / 编辑 / 删除）→ 评论区。

**响应式**

| 断点 | 变化 |
|------|------|
| ≥ 1200px | 主页 hero 文案左半 + 照片右半；编辑器左右分栏各占 50% |
| 768–1199px | hero 文案区放宽至 55%，特性条两列换行；编辑器分栏比例 55/45 |
| ≤ 768px | 顶栏收为汉堡菜单（抽屉展开导航）；hero 改为整幅深色遮罩上图、文案居中左对齐、特性条单列；编辑器取消分栏，改为「编辑 / 预览」顶部切换；笔记详情与列表卡片单列全宽；触摸目标 ≥ 44×44px |

### Visual System

- **视觉方向与理由**：产品主题是「个人书写」，素材中已提供写实生活照（咖啡、笔记本、绿植）与做旧纸张纹理。设计不套用通用仪表盘语言，而是把「纸张」当作画布：主页用照片建立生活场景，进入笔记区切换为米黄纸张，让用户的注意力落在文字本身。视觉强度集中在「纸张质感的容器」这一处，按钮、图标、分割线保持克制。
- **签名元素**：**纸张容器**。所有承载笔记内容的面板使用纸张纹理底 + 1px 暖色描边 + 极轻内阴影，左上角以装饰性小图标（沿用 logo 的笔记本意象）标注意图；正文区叠加半透明暖白层把纹理强度降到 6% 以下，确保长文阅读不疲劳。
- **色彩角色**

  | 角色 | 值 | 用途 |
  |------|-----|------|
  | 页面背景 | `#FAF8F5` | 全局底色 |
  | 卡片/顶栏 | `#FFFFFF` | 顶栏、表单卡片 |
  | 纸张底 | `paper.jpg`，兜底 `#FBF6EA` | 笔记容器 |
  | 主文字 | `#3D3630` | 标题、正文 |
  | 次文字 | `#8C8177` | 元信息、说明 |
  | 主色 | `#C3A47B` | 主按钮、链接、激活态 |
  | 主色悬停 | `#B08F63` | hover / active |
  | 强调色 | `#D9B98C` | 标题下划线、特性图标 |
  | 分割线 | `#EDE7DE` | 边框、分隔 |
  | 危险 | `#C25E4E` | 删除、错误 toast |
  | 成功 | `#6B8E5A` | 成功 toast、已保存态 |

- **字体与字号**：字体栈 `"PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif`；层级 12px（辅助）/ 14px（正文次要）/ 16px（正文，行高 1.75）/ 20px（小标题）/ 28px（页面标题）/ 40px（hero 主标题，字重 600，字间距 0.02em）。笔记正文行高提升至 1.9。
- **形状与阴影**：圆角统一 8px（按钮、输入框、卡片），纸张容器 12px；阴影仅两级——卡片 `0 2px 12px rgba(61,54,48,.06)`、浮层/弹窗 `0 8px 32px rgba(61,54,48,.12)`。边框统一 1px `#EDE7DE`。
- **间距**：4px 基准栅格，常用 8 / 12 / 16 / 24 / 32 / 48 / 64；页面横向安全边距 24px（移动端 16px），内容最大宽度 1200px，笔记正文字栏最大 720px。
- **图标**：统一线性风格、1.5px 描边、主色或次文字着色；logo 沿用设计稿的笔记本 + 心形意象，交付为 `logo.svg`；其余用内联 SVG，不引入图标库。
- **图片与动效**：主页 hero 使用 `个人笔记主页.jpg`（压缩为 WebP + JPG 兜底，宽度 1920 与 960 两档），笔记纸张使用 `个人笔记-笔记背景.jpg`（平铺或拉伸 + 兜底色）；动效只用于状态过渡——hover 0.15s、弹窗 0.2s 淡入上移、编辑预览滚动同步；全部遵循 `prefers-reduced-motion: reduce` 时降级为无动画。

### Components, Content, and States

| 组件 | 内容与文案 | 状态 |
|------|-----------|------|
| 顶栏 `AppHeader` | 未登录：`登录 / 注册 / 关于`；已登录：`写笔记 / 我的主页 / 头像菜单（个人主页、退出登录）` | 默认 / 滚动后加阴影 / 移动端抽屉展开 |
| 主页 Hero `HomeHero` | 标题「记录生活 · 书写成长 / 遇见美好」、副文案（沿用设计稿原文）、按钮「开始记录」「了解更多」、四项特性「简洁易用 / 云端同步 / 隐私保护 / 灵活分类」及其说明文案 | 默认 / 按钮 hover 与 focus |
| 表单 `AuthForm` | 注册：邮箱、用户名、密码、确认密码；登录：邮箱、密码；提交按钮「注册」/「登录」；底部互跳链接「已有账号？去登录」 | 默认 / 输入中 / 提交 loading（按钮禁用+转圈）/ 字段级错误（失焦校验，红色下划线 + 错误文案）/ 请求失败用 toast 展示 `message` |
| 笔记卡片 `NoteCard` | 标题（空则显示「无标题」）、摘要（正文前 80 字纯文本）、标签 chips、状态徽标（草稿/私密/已分享）、更新时间 | 默认 / hover 抬升 / 骨架加载 / 失效占位（`available=false` 时显示「内容已失效」） |
| 列表工具条 `NoteToolbar` | 状态筛选（全部/草稿/私密/已分享）、标签下拉、搜索输入（占位「搜索标题或正文…」）、排序切换 | 默认 / 有筛选条件时显示「清除筛选」/ 无结果空态 |
| 编辑器 `MarkdownEditor` | 左「Markdown 源码」右「预览」、顶部标题输入（占位「请输入标题」）、标签输入、`存草稿` / `发布` 按钮、底部状态「已保存 · 共 N 字 · 更新于 …」 | 默认 / 未保存脏标记（标题前显示圆点 + 离开页面二次确认）/ 保存中 / 已保存 / 保存失败（保留内容并提示重试） |
| 分享面板 `SharePanel` | 开关「开启分享」、密码输入（占位「留空表示不需要密码」）、只读链接框 + 「复制链接」按钮、开启后显示「关闭分享」危险操作 | 默认 / 开启中 loading / 已开启（显示链接与是否设密） / 复制成功提示「链接已复制」 |
| 分享密码锁屏 `ShareLock` | 居中纸张卡片：锁图标、标题「该笔记需要密码访问」、密码输入、按钮「确认访问」 | 默认 / 校验中 / 密码错误（输入框抖动 + 文案「访问密码错误」）/ 达到限流（提示「尝试过于频繁，请稍后再试」） |
| 评论区 `CommentList` | 标题「评论（N）」、输入框占位「写下你的想法…」、提交按钮「发表评论」、每条评论显示用户名首字头像 + 用户名 + 相对时间 + 内容 + 删除（作者/评论者可见） | 加载骨架 / 空态「还没有评论，来说点什么吧」/ 未登录时输入区替换为「登录后可发表评论」+ 登录按钮 / 删除二次确认 |
| 个人主页 `ProfileTabs` | 四 Tab、个人信息卡片（头像 + 用户名 + 邮箱 + 简介 + 「修改密码」按钮）、各列表复用 `NoteCard` | 空态分别为「还没有笔记，去写下第一篇吧」「还没有收藏」「还没有浏览记录」 |
| 关于页 `AboutPage` | 应用介绍、功能清单、技术栈说明（Flask + SQLite + 原生前端）、素材与开源库致谢、联系方式占位（邮箱占位文本，不填真实信息） | 静态 |
| 全局 `Toast` | 成功 `#6B8E5A` / 失败 `#C25E4E` / 信息主色，页面右上角，2.5s 自动消失，悬停暂停 | 单条 / 多条堆叠 |
| 全局 `ConfirmDialog` | 用于删除笔记、删除评论、关闭分享、退出登录：「确定要删除这篇笔记吗？删除后无法恢复。」按钮「取消」/「确定删除」 | 默认 / 确认按钮 loading |

**文案基调**：第二人称、口语化、简短；不使用「数据」「记录已插入」这类实现术语；所有面向用户的报错文案一律来自后端 `message`。

### Accessibility and Visual Verification

- **语义与键盘**：顶栏用 `<nav>`、内容区用 `<main>`、列表用 `<ul>/<li>`；弹窗使用 `role="dialog"` + `aria-modal`，打开时聚焦首个可交互元素并把焦点锁在弹窗内，`Esc` 关闭；Tab 键可达全部交互元素，`:focus-visible` 使用 2px `#B08F63` 描边。
- **对比度**：主文字 `#3D3630` 对 `#FAF8F5` ≈ 11:1、次文字 `#8C8177` ≈ 3.9:1（仅用于 ≥16px 的辅助文字，其余场景改用 `#6E6459`）；主按钮白字对 `#C3A47B` ≈ 2.6:1，因此主按钮文字改用 `#3D3630` 并按需加深按钮底色至 `#B08F63` 以满足 4.5:1。
- **其他**：表单控件均有 `<label>` 或 `aria-label`；图片提供 `alt`；动效尊重 `prefers-reduced-motion`；移动端触摸目标 ≥ 44×44px。
- **视觉验证清单**（实施完成后逐项截图核对）：
  1. 路由 `/`、`/login`、`/register`、`/about`、`/notes`、`/notes/new`、`/notes/<id>`、`/me`（四 Tab）、`/s/<token>`（无密与有密两种）
  2. 视口 1440×900 与 375×812 两档
  3. 状态：加载骨架、空态、后端错误 toast、表单字段校验错误、分享密码锁屏与错误、删除二次确认、笔记卡片失效占位

---

## Components

| 组件 | 职责 | 依赖 | 约束 |
|------|------|------|------|
| `app.py` | 创建应用、注册蓝图、注册错误处理器、catch-all、CLI 初始化数据库 | `config`, `core.*`, `api.*` | catch-all 不得吞掉 `/api/*` 与 `/static/*` |
| `core/db.py` | 每请求连接、关闭、PRAGMA 设置、各实体 DAO 函数 | `sqlite3` | 所有 SQL 必须参数化；DAO 不处理 HTTP 语义 |
| `core/response.py` `core/errors.py` | 统一响应构造与错误码映射 | — | 唯一产出 `{code,message,data}` 的地方，禁止在蓝图中手工拼响应 |
| `core/auth.py` | 登录态校验、CSRF 校验、当前用户解析、分享解锁态校验 | `db`, `errors` | 装饰器顺序固定：先 CSRF 再鉴权 |
| `core/security.py` | 密码哈希、token 生成、失败次数限流 | `db` | token 使用 `secrets.token_urlsafe(24)` |
| `api/auth.py` | 注册、登录、登出、当前用户 | `core.*` | 注册成功即写 Session |
| `api/notes.py` | 笔记 CRUD、草稿与发布、筛选搜索分页、标签绑定 | `db`, `validators` | 每次操作校验 `notes.user_id == 当前用户` |
| `api/share.py` | 开启/关闭分享、公开读取、密码校验与解锁 | `db`, `security` | 关闭分享必须同时清空 token 与密码哈希 |
| `api/comments.py` | 评论增删查 | `db` | 删除权限 = 评论作者 或 笔记作者 |
| `api/favorites.py` | 收藏增删查、可访问性判定 | `db` | 收藏前校验目标可访问 |
| `api/history.py` | 足迹记录（去重更新）、查询、清除 | `db` | 仅记录已登录用户 |
| `api/uploads.py` | 图片上传、类型校验、重命名落盘 | `Pillow` | 白名单扩展名 + 真实解码双校验；返回相对 URL |
| `static/js/api.js` | fetch 封装、CSRF 头注入、统一错误拦截与 toast | `ui.js` | 错误文案只取后端 `message` |
| `static/js/router.js` | History API 路由、视图挂载与卸载、登录守卫 | `store.js` | 未登录访问受保护路由时跳登录并记录回跳 |
| `static/js/store.js` | 当前用户、CSRF Token 的内存状态 | — | 不把凭证写入 `localStorage` |
| 页面模块 `home/auth/notes/editor/profile/share/about.js` | 各自视图的渲染与事件绑定 | `api.js`, `ui.js` | 不直接操作 DB 语义，只消费 API 返回 |
| `static/css/base.css` | 设计令牌（CSS 变量）、重置、通用组件（按钮、输入、卡片、toast、弹窗） | — | 令牌是唯一颜色/间距来源，其他 css 不得硬编码色值 |

## Data Flow

1. **注册/登录**：表单 → `api.js` POST `/auth/register|login` → 服务端校验、写 `users`、写 Session 并下发 CSRF Token → 前端写入 `store`、跳转 `/me` 或回跳目标。
2. **写笔记**：编辑器输入 → 前端 store 维护草稿内容与脏标记 → 点「存草稿/发布」触发 POST/PUT `/notes`（带 `X-CSRF-Token`）→ 服务端校验长度与标签数、写入/更新 `notes` 与 `note_tags` → 返回笔记对象 → 前端更新状态与「已保存」提示；纯前端实时预览由 `marked` + `DOMPurify` 本地完成，不发起请求。
3. **图片插入**：编辑器粘贴或选择图片 → POST `/uploads/image`（multipart）→ 校验大小/类型/真实解码 → UUID 重命名写入 `static/uploads/` → 返回 URL → 前端把 `![](url)` 插入光标处。
4. **列表与筛选**：`/notes` 或 `/me` 切换筛选条件 → GET `/notes` 带 `status/q/tag/sort/page` → DAO 拼参数化 WHERE 与 LIMIT → 返回分页结果 → 渲染卡片列表。
5. **分享**：详情页开启分享（可带密码）→ POST `/notes/<id>/share` → 服务端设 `status='public'`、生成 `share_token`、必要时哈希密码 → 返回完整链接 → 前端展示并可复制。
6. **他人访问分享**：打开 `/s/<token>` → GET `/share/<token>` → 无密码直接返回笔记与作者；有密码且未解锁则返回 `SHARE_PASSWORD_REQUIRED` → 前端渲染 `ShareLock` → POST `/share/<token>/verify` → 校验通过后 Session 记录解锁、返回正文；页面渲染后前端异步 POST 记录足迹（登录时）。
7. **评论**：分享页或详情页提交 → POST 对应 comments 接口 → 校验登录、内容长度、笔记可访问性 → 写入 `comments` → 返回新评论并插入列表。
8. **收藏/足迹**：点击收藏 → POST `/favorites` → 服务端从 `note_id` 反查可访问性 → 写 `favorites`；查询时 LEFT JOIN `notes` 计算 `available`。

## Error Handling

| 失败模式 | 系统响应 |
|----------|----------|
| 请求参数缺失或格式错误 | `INVALID_PARAM` / 字段级错误码，HTTP 400，前端 toast + 表单字段高亮 |
| 未登录访问受保护接口 | `UNAUTHORIZED`，401；`api.js` 统一跳登录并记录回跳目标 |
| CSRF Token 缺失/不匹配 | `CSRF_INVALID`，403；前端提示刷新页面并重新获取 `/auth/me` |
| 操作他人笔记/评论 | `FORBIDDEN`，403；不使用 `NOT_FOUND` 掩盖，便于排障 |
| 资源不存在或已被软删除 | `NOT_FOUND`，404，前端展示空态页 |
| 分享 token 无效或已关闭 | `SHARE_DISABLED`，404，展示「该分享链接已失效」并提供返回首页 |
| 分享需密码 / 密码错误 | `SHARE_PASSWORD_REQUIRED` / `SHARE_PASSWORD_WRONG`，401，前端渲染锁屏与抖动提示 |
| 登录或分享密码连续失败 | `RATE_LIMITED`，429，提示稍后再试并禁止提交按钮 |
| 上传文件超限 | Flask `MAX_CONTENT_LENGTH` 触发 413，全局处理器转为 `UPLOAD_TOO_LARGE` |
| 上传内容非真实图片 | Pillow 解码失败 → `UPLOAD_TYPE_INVALID`，删除临时文件 |
| SQLite 锁定/写入失败 | 记录日志，返回 `INTERNAL_ERROR`，不向用户泄露堆栈 |
| 未捕获异常 | 全局 `errorhandler(Exception)` 记日志，返回 `INTERNAL_ERROR` + 中文提示；`/api/*` 永远返回 JSON，静态路由返回 `index.html` |
| 前端渲染 Markdown 异常 | `marked` 包裹 try/catch，失败时降级为 `<pre>` 纯文本展示原文，不阻塞编辑 |
| 编辑页未保存离开 | 有脏标记时 `beforeunload` 拦截 + 站内路由切换二次确认 |

## Security

面向公网多用户运行，落实以下措施：

- **信任边界**：所有 `/api/*` 入参视为不可信；`status=public` 之外的数据永不通过任何公开接口返回；只有持有 `share_token` 且（如设密）已校验密码的访问者能读到他人笔记内容。
- **鉴权与越权**：`login_required` 装饰器覆盖全部受保护接口；笔记、评论、收藏、足迹的每次读写都校验归属；详情接口对非作者先判断分享是否开启且已解锁。
- **凭证存储**：密码使用 `pbkdf2:sha256` 哈希（不存明文与可逆加密）；分享密码同样哈希存储；`SECRET_KEY` 经环境变量注入，默认值仅用于本地开发并在 README 中标注必须替换。
- **会话与 CSRF**：Cookie `HttpOnly + SameSite=Lax`，生产开启 `Secure`；写操作强制校验 `X-CSRF-Token`；凭证只存于内存，不写 `localStorage`。
- **XSS**：Markdown 渲染后统一经 `DOMPurify` 清洗，禁止 `script`、`iframe`、事件属性与 `javascript:` 协议；用户昵称、评论、标签等所有插值位置使用 `textContent` 或经清洗后再插入 DOM。
- **SQL 注入**：DAO 全部使用参数化占位符，禁止字符串拼接 SQL；动态排序字段使用白名单映射。
- **上传安全**：扩展名白名单（jpg/jpeg/png/gif/webp）+ Pillow 真实解码校验 + UUID 重命名（丢弃原始文件名）+ `MAX_CONTENT_LENGTH = 5MB`；上传目录禁止执行脚本，仅按静态资源返回；同时限制单用户上传总量（默认 200MB，超限返回 `STORAGE_QUOTA_EXCEEDED`）。
- **暴力破解与滥用**：登录与分享密码失败按 key 计数限流；分享 token 使用 `secrets.token_urlsafe(24)` 提供足够熵值防枚举；评论长度限制 1000 字，笔记标题 200 字、正文 100000 字。
- **隐私**：首页与所有无需登录的页面不展示任何用户笔记；`/s/<token>` 页面设置 `Referrer-Policy: no-referrer`，避免链接经外链泄露；响应统一附加 `X-Content-Type-Options: nosniff` 与 `X-Frame-Options: DENY`。
- **日志**：记录异常与限流事件，不记录明文密码、分享密码与完整 Session 内容。

## Boundaries and Dependencies

| 单元 | 拥有 | 不拥有 | 依赖 |
|------|------|--------|------|
| `core/db.py` | 连接生命周期、DAO、PRAGMA | HTTP 语义、权限判断 | `sqlite3` 标准库 |
| `core/auth.py` | 登录态与 CSRF 校验、分享解锁态 | 业务规则 | `db`, `errors` |
| `api/*` 蓝图 | 入参校验编排、调用 DAO、返回统一响应 | 直接拼 SQL、拼响应体 | `core.*` |
| 前端 `api.js` | 请求封装与错误拦截 | 业务分支展示文案 | 后端契约 |
| 前端页面模块 | 视图渲染与交互 | DOM 之外的状态持久化 | `api.js`, `ui.js`, `store.js` |

**外部依赖**

- 后端：`Flask==3.0.3`、`Pillow==10.4.0`（`Werkzeug` 随 Flask 锁定版本）。安装使用清华 TUNA 镜像（`pip.conf` 中配置 `index-url = https://pypi.tuna.tsinghua.edu.cn/simple`）。
- 前端：`marked`、`DOMPurify` 从 npmmirror 下载指定版本后放入 `static/vendor/`，以本地 `<script>` 引用，不依赖运行时 CDN，版本号写入 README。
- 数据库：SQLite 单文件 `db/app.db`，由 `app.py` 的初始化命令读取 `db/schema.sql` 建表（幂等）。
- 假设：目标运行环境为 Python 3.10+；素材图片允许压缩转码后使用（保留原始文件）。

## Testing

- **单元测试（pytest）**：`validators`（邮箱、密码强度、标题/评论长度、标签数量上限）、`security`（哈希与校验、token 生成、限流判定）、`db` DAO（笔记筛选与分页、标签绑定、收藏去重、足迹时间戳更新）。
- **接口集成测试（pytest + Flask test_client，临时库文件）**：
  1. 注册 → 登录 → `/auth/me` 链路与重复邮箱/用户名的 `EMAIL_EXISTS` / `USERNAME_EXISTS`
  2. 未登录访问 `/notes` 返回 `UNAUTHORIZED`；缺失 CSRF 头的写请求返回 `CSRF_INVALID`
  3. 用户 A 无法读取/修改/删除用户 B 的私有笔记（返回 `FORBIDDEN` 或 `NOT_FOUND`）
  4. 分享开启后 `/share/<token>` 可读；设密时未校验返回 `SHARE_PASSWORD_REQUIRED`，错误密码返回 `SHARE_PASSWORD_WRONG`，连续失败触发 `RATE_LIMITED`
  5. 关闭分享后 token 立即失效，原收藏条目返回 `available: false`
  6. 评论删除权限：评论作者可删、笔记作者可删、无关用户返回 `FORBIDDEN`
  7. 上传：非图片文件（改名伪装）返回 `UPLOAD_TYPE_INVALID`；> 5MB 返回 `UPLOAD_TOO_LARGE`
  8. 草稿不会被任何公开接口返回；`status=draft` 的笔记不出现在分享路径中
- **前端手工验证**：按「界面设计契约 / 视觉验证清单」逐条截图，重点核对分享密码锁屏、编辑器脏数据离开提示、Markdown 内嵌 HTML 与 `<script>` 是否被清洗。

## Rollout

- **首次部署**：执行 `python app.py init-db` 读取 `db/schema.sql` 建表（幂等，可重复执行），随后 `python app.py run` 启动开发服务器。
- **兼容性**：本期为从零开始的项目，无历史数据迁移需求；后续若变更表结构，新增幂等 `ALTER` 语句并记录在 `db/schema.sql` 末尾。
- **生产部署建议**：使用 WSGI 服务器（Windows 友好的 `waitress` 或 Linux 下的 `gunicorn`）配合 Nginx 反向代理并启用 HTTPS；`SECRET_KEY` 通过环境变量注入；`static/uploads` 与 `db/app.db` 纳入定期备份；Nginx 层对 `/api/auth/login` 与 `/api/share/*/verify` 追加请求频率限制。
- **回滚**：应用为单进程无状态（除 Cookie），回滚即替换代码目录；数据库变更前先复制 `db/app.db`。

## Deferred Questions

| 待定项 | 暂定默认 |
|--------|----------|
| 生产 WSGI 服务器选型（waitress / gunicorn） | 默认 `waitress`，部署时按目标系统确认 |
| 单用户上传总容量策略的具体数值与提示文案 | 默认 200MB，超限提示「存储空间不足，请先清理历史图片」 |
| 头像上传入口是否开放（本期先支持首字色块） | 默认开放，复用 `/api/uploads/image` |
| 每页条数默认值 | 默认 `page_size = 10`，上限 50 |
| 时间显示方式 | 服务端存 ISO8601 UTC，前端展示浏览器本地时区 + 相对时间（7 天内） |
| 笔记详情是否展示「该笔记被浏览 N 次」 | 默认展示次数汇总，不做浏览者名单 |
| 标签输入方式（回车添加 / 下拉选择已有） | 默认回车添加 + 输入时联想已有标签 |
