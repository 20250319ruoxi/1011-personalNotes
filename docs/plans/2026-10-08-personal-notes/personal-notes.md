# 个人笔记 Implementation Plan

**Created:** 2026-10-08
**Status:** In Progress
**Source Spec:** `docs/specs/2026-10-08-personal-notes-design.md`

## Overview

**Goal:** 交付一个可公网部署的个人笔记应用：注册登录、Markdown 笔记的草稿/私密/公开三态管理、带密码的链接分享、评论、收藏与浏览足迹，视觉严格对齐已确认的主页设计稿。

**Architecture:** 纯静态 SPA（History API 路由）调用 Flask JSON API（蓝图拆分，统一 `{code,message,data}` 响应）；数据层用标准库 `sqlite3` 加一层轻量 DAO；Markdown 在前端用本地 vendor 的 `marked` 渲染、`DOMPurify` 清洗；登录态用 Flask Session Cookie 配合 `X-CSRF-Token` 请求头。

**Tech Stack:** Python 3.12.7 / Flask 3.0.3 / Werkzeug 3.0.6 / Pillow 10.4.0 / waitress 3.0.2 / SQLite 3.45.3（标准库 `sqlite3`）/ pytest 8.4.2 / 原生 HTML+CSS+JS / marked 12.0.2 / DOMPurify 3.1.6。

## Files and Responsibilities

| File/Module | Action | Responsibility | Notes |
|-------------|--------|----------------|-------|
| `requirements.txt` | Create | 锁定 5 个后端依赖版本 | 版本已在清华镜像核验可用 |
| `pip.conf` | Create | 配置清华 TUNA 镜像源 | |
| `README.md` | Create | 启动步骤、依赖安装、vendor 版本、`SECRET_KEY` 替换说明 | |
| `config.py` | Create | 常量配置，读环境变量覆盖 | 单例 `Config` 类 |
| `app.py` | Create | 应用工厂、蓝图注册、全局错误处理、SPA catch-all、`init-db`/`run` CLI | catch-all 不得吞 `/api/*`、`/static/*` |
| `db/schema.sql` | Create | 8 张表的幂等 DDL | 幂等，可重复执行 |
| `core/db.py` | Create | 连接生命周期、PRAGMA、`Row` 工厂、8 张表的 DAO 函数 | 全部参数化 SQL；不含 HTTP 语义 |
| `core/errors.py` | Create | 23 个错误码 → (HTTP 状态, 中文文案) 映射 | 唯一文案来源 |
| `core/response.py` | Create | `ok()` / `fail()` | 唯一产出 `{code,message,data}` 的地方 |
| `core/markdown.py` | Create | `to_plain_text(md, limit)`：剥离 Markdown 语法生成列表摘要 | 不承担渲染职责 |
| `core/auth.py` | Create | `login_required`、CSRF 校验、Origin 校验、当前用户解析、分享解锁态 | 装饰器顺序：CSRF → 鉴权 |
| `core/validators.py` | Create | 邮箱/用户名/密码/标题/正文/评论/标签/分页参数校验 | 返回 `(ok, code)` |
| `core/security.py` | Create | 密码哈希、`share_token` 生成、`auth_attempts` 限流记录与判定 | token 用 `secrets.token_urlsafe(24)` |
| `api/auth.py` | Create | 注册、登录、登出、`/auth/me` | 注册成功即写 Session |
| `api/users.py` | Create | 个人资料读写、修改密码 | |
| `api/notes.py` | Create | 笔记 CRUD、草稿/发布、筛选搜索排序分页、标签绑定 | 每次操作校验归属 |
| `api/tags.py` | Create | 当前用户标签及计数 | |
| `api/share.py` | Create | 开启/关闭分享、公开读取、密码校验解锁 | 关闭分享须清空 token 与密码哈希 |
| `api/comments.py` | Create | 评论增删查 | 删除权限 = 评论作者 或 笔记作者 |
| `api/favorites.py` | Create | 收藏增删查、可访问性判定 | 收藏前校验目标可访问 |
| `api/history.py` | Create | 足迹记录（去重更新）、查询、清除 | 仅记录已登录用户 |
| `api/uploads.py` | Create | 图片上传、白名单 + 真实解码校验、UUID 重命名、配额检查 | Pillow 校验 |
| `index.html` | Create | SPA 入口，挂载 `#app`，按顺序引入 vendor 与模块脚本 | |
| `static/vendor/marked.min.js` | Create | marked 12.0.2 UMD 构建（35,479 字节） | 全局 `window.marked` |
| `static/vendor/purify.min.js` | Create | DOMPurify 3.1.6 压缩构建（21,496 字节） | 全局 `window.DOMPurify` |
| `static/img/hero.jpg` `hero-960.jpg` `hero.webp` `hero-960.webp` | Create | 主页写真多格式多尺寸 | 由 `个人笔记主页.jpg` 转码 |
| `static/img/paper.jpg` `paper.webp` | Create | 笔记纸张背景 | 由 `个人笔记-笔记背景.jpg` 转码 |
| `static/img/logo.svg` | Create | 笔记本 + 心形线性标识 | 对齐设计稿 |
| `static/uploads/.gitkeep` | Create | 用户上传目录占位 | 目录缺失时启动自动创建 |
| `static/css/base.css` | Create | 设计令牌（CSS 变量）、重置、按钮/输入/卡片/toast/弹窗/顶栏 | 令牌是唯一颜色与间距来源 |
| `static/css/home.css` `about.css` `auth.css` `notes.css` `editor.css` `share.css` `profile.css` | Create | 各页面样式 | 不得硬编码色值 |
| `static/js/store.js` | Create | 当前用户、CSRF Token、编辑器草稿态的内存状态 | 不写 `localStorage` |
| `static/js/api.js` | Create | fetch 封装、CSRF 头注入、统一错误拦截与 toast、`UNAUTHORIZED` 跳登录 | 文案只取后端 `message` |
| `static/js/ui.js` | Create | `renderHeader()`、`toast()`、`confirmDialog()`、骨架片、空态、日期格式化 | 通用组件唯一来源 |
| `static/js/markdown.js` | Create | `renderMarkdown()` = marked 渲染 + DOMPurify 清洗 + `try/catch` 降级为 `<pre>` | 详情页与预览共用 |
| `static/js/markdown.js` | Create | `renderMarkdown()` = marked 渲染 + DOMPurify 清洗 + `try/catch` 降级为 `<pre>`；`markdownToPlainText()` | 详情页、分享页与编辑器预览共用；全项目唯一输出 HTML 的入口 |
| `static/js/comments.js` | Create | `renderComments()`：评论列表、发表、删除、空态、未登录态、加载更多 | 详情页与分享页共用 |
| `static/js/router.js` | Create | History API 路由、视图挂载/卸载、登录守卫、回跳记录、脏数据拦截 | |
| `static/js/home.js` `about.js` `auth.js` `notes.js` `editor.js` `share.js` `profile.js` | Create | 各路由页面渲染与事件绑定 | 只消费 API 返回 |
| `tests/conftest.py` | Create | `app`/`client` fixture、临时数据库、`auth_client` 登录夹具、CSRF 头夹具 | 每用例独立临时库 |
| `tests/test_response_contract.py` | Create | 响应体契约、404/500 处理、SPA catch-all | |
| `tests/test_db_basics.py` | Create | 建表幂等、外键生效、WAL 开启、时间源、用户查询 DAO | |
| `tests/test_validators.py` | Create | 各字段校验规则 | |
| `tests/test_security.py` | Create | 哈希、token、限流窗口 | |
| `tests/test_auth_api.py` | Create | 注册/登录/登出/me、重复邮箱与用户名、限流、CSRF 拒绝 | |
| `tests/test_users_api.py` | Create | 资料读写、改密、越权 | |
| `tests/test_rate_limit.py` | Create | 登录与分享密码限流阈值、窗口、互不影响 | |
| `tests/test_error_copy_sync.py` | Create | 强制前端字段级文案与 `core/errors.py` 逐字一致 | |
| `tests/test_markdown.py` | Create | Markdown 摘要剥离语法、截断、HTML 标签 | |
| `tests/test_notes_dao.py` | Create | 创建/更新/软删除、标签绑定、搜索通配符转义、发布时间 | |
| `tests/test_notes_api.py` | Create | CRUD、草稿与三态、越权、标签与长度校验 | |
| `tests/test_notes_list.py` | Create | 筛选、搜索、排序、分页边界、载荷不含正文 | |
| `tests/test_tags_api.py` | Create | 标签计数、软删除排除、归属隔离 | |
| `tests/test_uploads_api.py` | Create | 类型伪装、真实格式、体积、配额、命名空间 | |
| `tests/test_share_api.py` | Create | 分享开关、密码、失效、限流、草稿无公开面 | |
| `tests/test_comments_api.py` | Create | 评论增删查、三种删除权限、设密需解锁、分页 | |
| `tests/test_favorites_api.py` | Create | 收藏可访问性、去重、失效态、分页 | |
| `tests/test_history_api.py` | Create | 去重更新时间戳、清空、失效态、分页与倒序 | |
| `tests/test_security_headers.py` | Create | 安全响应头、Cookie 属性、CSP 无 `unsafe-inline` | |
| `tests/test_authz_matrix.py` | Create | 22 个受保护接口的未登录矩阵、伪造 token、路径穿越、跨会话 CSRF | |
| `tests/manual/xss-fixtures.md` | Create | 6 个 Markdown/HTML 注入手工样例与期望结果 | 浏览器手工执行 |
| `tests/manual/visual-checklist.md` | Create | 视觉与交互验收清单（路由 × 视口 × 状态） | 逐项勾选 |
| `tests/manual/end-to-end-walkthrough.md` | Create | 35 步端到端场景脚本 + 全量视觉矩阵 | 最终验收记录 |

## Interface Implementation Map

| Design Decision | Source（spec 章节） | Implementation Surface | Verification |
|-----------------|---------------------|------------------------|--------------|
| 主页旅程：未登录 → 开始记录 → 登录后回跳 `/notes/new` | 主要旅程 1 | `static/js/home.js`、`router.js`（回跳记录）、`auth.js` | Phase 3 走查：点「开始记录」→ 登录 → 落在 `/notes/new` |
| 写笔记分栏实时预览 | 主要旅程 2、Layout | `static/js/editor.js`、`editor.css`、`markdown.js` | Phase 5：输入 Markdown 右侧 200ms 内更新；≤768px 切为「编辑/预览」标签 |
| 分享链接与密码锁屏 | 主要旅程 4、6 | `api/share.py`、`static/js/share.js`、`share.css` | Phase 6：无密直接读、有密走锁屏、关闭后失效 |
| 路由表与访问控制（10 条路由） | 信息架构与路由 | `static/js/router.js`、`app.py` catch-all | 每条路由直链刷新不 404；未登录访问 `/notes` 跳登录 |
| 顶栏未登录 / 已登录两态 | Components `AppHeader` | `static/js/ui.js` `renderHeader()`、`base.css` | 两态截图；≤768px 汉堡抽屉展开 |
| 主页 Hero 布局与文案 | Layout 主页线框图 | `static/js/home.js`、`home.css` | 1440×900 与 375×812 截图对照 `图片素材/个人笔记-主页截图.jpg` |
| 纸张容器（签名元素） | Visual System 签名元素 | `notes.css`、`editor.css`、`share.css`、`paper.jpg` | 三处容器视觉一致；正文区叠加暖白层后纹理不干扰阅读 |
| 11 个色彩角色 + 字体层级 + 圆角/阴影/间距令牌 | Visual System 色彩与字体 | `static/css/base.css` `:root` 变量 | grep 确认其他 css 无硬编码色值；DevTools 计算样式抽查 |
| 主按钮对比度修正（深色文字 + 按下加深底色） | Accessibility 对比度 | `base.css` 按钮样式 | 用对比度工具核算 ≥ 4.5:1 |
| 组件状态：骨架 / 空态 / loading / 字段错误 / 失效占位 | Components 表 | `ui.js`、`notes.js`、`editor.js`、`share.js`、`profile.js` | Phase 8 逐项截图核对 |
| 全局 toast 与二次确认弹窗 | Components `Toast` / `ConfirmDialog` | `ui.js`、`base.css` | 删除笔记/评论/关闭分享/退出登录均弹确认 |
| 文案基调与错误文案来源 | Components 文案基调 | `core/errors.py`、`api.js` | grep 前端无中文错误文案字典 |
| 无障碍：语义标签、焦点环、`aria-modal`、焦点锁、`Esc` 关闭 | Accessibility | `ui.js`、`base.css` | 键盘走查：Tab 可达、弹窗焦点锁定、`Esc` 关闭 |
| `prefers-reduced-motion` 降级 | Visual System 动效 | `base.css` | DevTools 模拟该媒体特性后动效消失 |
| 响应式三档断点 | Layout 响应式表 | `home.css`、`editor.css`、`notes.css`、`base.css` | 375 / 1024 / 1440 三档截图 |
| hero 与纸张素材转码 | Visual System 图片 | Pillow 转码脚本步骤（Phase 1 Task 4） | 文件尺寸与像素宽度核对 |

## Phases

### Phase 1: 项目骨架与基础设施
**File:** [phase-1-skeleton.md](phase-1-skeleton.md)
**Goal:** 跑通「Flask 应用工厂 + SPA 骨架 + 统一响应契约 + SQLite schema」的底座，为后续所有阶段提供可验证的落点。
**Tasks:** 6
**Status:** Done
**Completion:** √

### Phase 2: 静态主页与关于页
**File:** [phase-2-home-page.md](phase-2-home-page.md)
**Goal:** 交付与设计稿一致的静态主页与关于页（未登录态），并把设计令牌落实为可复用的通用组件。
**Tasks:** 4
**Status:** Not Started

### Phase 3: 用户体系
**File:** [phase-3-auth.md](phase-3-auth.md)
**Goal:** 完成注册、登录、登出、当前用户、资料与改密，以及 CSRF/Origin 防护，前端交付登录注册页与登录守卫。
**Tasks:** 6
**Status:** Not Started

### Phase 4: 笔记后端
**File:** [phase-4-notes-backend.md](phase-4-notes-backend.md)
**Goal:** 完成笔记 CRUD、草稿/私密/公开三态、标签绑定、筛选搜索排序分页，以及图片上传接口。
**Tasks:** 5
**Status:** Not Started

### Phase 5: 笔记前端
**File:** [phase-5-notes-frontend.md](phase-5-notes-frontend.md)
**Goal:** 交付笔记列表页、分栏实时预览编辑器、笔记详情页与 Markdown 渲染清洗模块。
**Tasks:** 5
**Status:** Not Started

### Phase 6: 分享与评论
**File:** [phase-6-share-comments.md](phase-6-share-comments.md)
**Goal:** 完成带密码的分享链接全流程与评论功能，前端交付公开分享页、密码锁屏与评论区。
**Tasks:** 5
**Status:** Not Started

### Phase 7: 收藏、足迹与个人主页
**File:** [phase-7-profile.md](phase-7-profile.md)
**Goal:** 完成收藏与浏览足迹的前后端，并把个人主页四个 Tab 组装完成。
**Tasks:** 4
**Status:** Not Started

### Phase 8: 安全加固与全量验收
**File:** [phase-8-hardening.md](phase-8-hardening.md)
**Goal:** 补齐限流、安全响应头、上传配额，按视觉与交互清单做全量端到端验收并收尾文档与部署说明。
**Tasks:** 4
**Status:** Not Started

## Dependencies

- **阶段顺序**：Phase 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 严格串行。Phase 3 的登录守卫是 Phase 5–7 所有受保护页面的前置；Phase 4 的上传接口是 Phase 5 编辑器插图的前置；Phase 6 的分享解锁态是 Phase 7 收藏他人笔记的前置。
- **运行时**：Python 3.12.7（已确认）、Node 24.13.0（仅在 Phase 1 用于下载 vendor 包）、Git Bash（Windows 下执行计划中的 shell 命令）。
- **外部服务**：无。不依赖任何在线 CDN、大模型 API 或邮件服务。
- **镜像与版本**：`pip.conf` 指向 `https://pypi.tuna.tsinghua.edu.cn/simple`；`npm pack` 使用 `https://registry.npmmirror.com`。Flask 3.0.3 / Werkzeug 3.0.6 / Pillow 10.4.0 / waitress 3.0.2 / pytest 8.4.2 / marked 12.0.2 / DOMPurify 3.1.6 均已在对应镜像上核验存在。
- **环境变量**：`SECRET_KEY`（生产必须替换）、`DATABASE`（默认 `db/app.db`）、`COOKIE_SECURE`（生产设为 `1`）。
- **数据**：Phase 1 执行 `init-db` 建库；测试使用各自的临时库文件，不触碰 `db/app.db`。

## Success Criteria

- [ ] 需求文档列出的 10 个功能点全部可用：主页、注册、登录、个人主页（信息/我的笔记/收藏/足迹）、笔记管理（写/存草稿/列表/详情）、链接分享（可选密码）、评论、收藏、关于页、Markdown 渲染
- [ ] `GET /api/*` 的成功与失败响应体均符合 `{code, message, data}`，前端不维护任何中文错误文案
- [ ] `.venv/Scripts/python.exe -m pytest tests/ -v` 全部通过（20 个后端测试文件 + 3 个手工清单文件）
- [ ] 草稿与私密笔记不出现在任何公开接口；用户 A 无法读写用户 B 的私有数据
- [ ] 分享关闭后原链接立即失效，收藏与足迹中的引用返回 `available: false`
- [ ] 主页在 1440×900 与 375×812 两档下与设计稿一致；笔记区三处纸张容器视觉统一
- [ ] 键盘可完成登录、写笔记、发布、分享、评论全流程；弹窗焦点锁定且 `Esc` 可关
- [ ] `base.css` 之外无硬编码色值；`prefers-reduced-motion` 下无动画
- [ ] `README.md` 记录启动步骤、镜像配置、vendor 版本与 `SECRET_KEY` 替换要求

## Deferred Decisions

- **生产 WSGI 服务器**：默认 `waitress==3.0.2`（已锁版本，Windows 友好），不引入 Nginx 配置模板；部署到 Linux 时可改为 gunicorn，届时再定。
- **单用户上传配额数值**：默认 200MB（`config.USER_UPLOAD_QUOTA`），文案「存储空间不足，请先清理历史图片」，超限返回 `STORAGE_QUOTA_EXCEEDED`。
- **用户名规则（需求文档未定义）**：默认 3–20 个字符，允许中文、字母、数字、下划线，区分大小写并依赖 UNIQUE 约束去重；实现于 `core/validators.py`，如需更严可在 Phase 3 调整。
- **头像上传入口**：Phase 7 先交付用户名首字色块；`avatar` 字段读写与 `PUT /users/me/profile` 支持传 URL，上传入口复用 `/api/uploads/image`，可在个人主页改造时按需接入。
- **分享密码长度（需求文档未定义）**：默认 4–64 个字符，超出范围返回 `INVALID_PARAM`；实现于 `core/validators.py` 的 `validate_share_password`，如需更强约束可在 Phase 6 调整。
- **修改密码后的会话处理**：默认保留当前会话（不强制重新登录），用户下次登录须使用新密码；如需强制下线，可在 Phase 8 的改密接口中追加 `session.clear()`。
- **浏览足迹的写入位置（需求文档未定义接口）**：需求文档的足迹接口只有查询、清空与单条删除，因此足迹由服务端在「读取笔记详情」与「读取/校验分享」成功时写入；列表接口保持无副作用，绝不在其中写足迹。
- **上传文件的归属标识（需求文档数据模型无上传表）**：文件名固定为 `u{user_id}-{uuid4().hex}{ext}`，配额统计按前缀累加文件大小，不新增数据表。
- **分页默认值**：`page_size = 10`，上限 50。
- **时间显示**：服务端存 ISO8601 UTC，前端展示本地时区 + 7 天内相对时间。
- **笔记详情浏览量**：默认展示 `view_count` 汇总数，展示浏览量时从 `view_history` 聚合，不展示浏览者名单。
- **标签输入方式**：回车添加 + 输入时联想已有标签（`GET /tags`）。
- **`GET /notes` 列表载荷**：items 只返回 `summary`（`core/markdown.py` 剥离 Markdown 后的前 80 字）而不返回 `content_md`，减少载荷并避免草稿正文外泄；详情接口才返回完整 `content_md`。
