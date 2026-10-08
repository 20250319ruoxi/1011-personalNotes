# 个人笔记（personalNodes）

一个可部署到公网的在线个人笔记应用：注册登录、Markdown 笔记的草稿／私密／公开三态管理、
带密码的链接分享、评论、收藏与浏览足迹。

**技术栈一句话**：纯静态 SPA（原生 HTML + CSS + JavaScript，History API 路由）调用
Flask 3（蓝图拆分，统一 `{code, message, data}` JSON）后端，数据落 SQLite 单文件；
Markdown 在前端用本地 vendor 的 `marked` 渲染、`DOMPurify` 清洗，不依赖任何运行时 CDN。

### 功能点清单（需求文档 10 项 → 交付物对照，均为「已实现」）

| # | 功能点 | 状态 | 主要交付物 |
|---|--------|------|------------|
| 1 | 主页 | 已实现 | `static/js/home.js`、`static/css/home.css`、`static/img/hero*.{jpg,webp}` |
| 2 | 注册 | 已实现 | `api/auth.py`（`POST /api/auth/register`）、`static/js/auth.js` |
| 3 | 登录 | 已实现 | `api/auth.py`（`POST /api/auth/login`）、`static/js/auth.js`、`core/auth.py` 会话 |
| 4 | 个人主页（信息／我的笔记／收藏／足迹） | 已实现 | `static/js/profile.js`、`api/users.py`、`api/favorites.py`、`api/history.py` |
| 5 | 笔记管理（写／存草稿／列表／详情） | 已实现 | `api/notes.py`、`static/js/notes.js`、`static/js/editor.js` |
| 6 | 链接分享（可选密码） | 已实现 | `api/share.py`、`static/js/share.js`、`core/security.py` |
| 7 | 评论 | 已实现 | `api/comments.py`、`static/js/comments.js` |
| 8 | 收藏 | 已实现 | `api/favorites.py`、`static/js/ui.js favoriteButton()` |
| 9 | 关于页 | 已实现 | `static/js/about.js`、`static/css/about.css` |
| 10 | Markdown 渲染 | 已实现 | `static/js/markdown.js`（唯一 HTML 出口）、`static/vendor/{marked,purify}.min.js` |

---

## 1. 项目简介

- **定位**：单用户可注册的多用户在线笔记，支持草稿／私密／公开三态与带密码的链接分享。
- **形态**：后端 Flask JSON API + 前端静态 SPA，单进程即可运行，无外部服务依赖。
- **安全基调**：所有响应附加安全头与严格 CSP（不含 `'unsafe-inline'`）；会话 Cookie
  `HttpOnly + SameSite=Lax`（生产可开 `Secure`）；写操作强制 `X-CSRF-Token`；上传走
  白名单 + 真实解码 + UUID 重命名；分享 token 使用高熵随机串。

## 2. 技术栈

| 层 | 选型 | 版本 |
|----|------|------|
| 语言／运行时 | Python | 3.12（开发环境 3.12.7；3.10+ 理论可用，未验证） |
| Web 框架 | Flask | 3.0.3 |
| WSGI 工具库 | Werkzeug | 3.0.6 |
| 图像处理 | Pillow | 10.4.0（上传真实解码校验） |
| 生产 WSGI 服务器 | waitress | 3.0.2（Windows 友好） |
| 测试框架 | pytest | 8.4.2 |
| 数据库 | SQLite（标准库 `sqlite3`） | 开发环境 3.45.3 |
| 前端 | 原生 HTML + CSS + JavaScript（History API 单页应用） | — |
| Markdown 渲染 | `marked`（本地 vendor，全局 `window.marked`） | 12.0.2 |
| HTML 清洗 | `DOMPurify`（本地 vendor，全局 `window.DOMPurify`） | 3.1.6 |
| 镜像 | pip：清华 TUNA；npm：npmmirror | — |

> 前端在浏览器侧渲染，**不依赖任何在线 CDN**：`marked` 与 `DOMPurify` 以 `<script>` 从
> `static/vendor/` 本地加载。Node.js 仅在「需要重新下载 vendor 包」时使用，运行应用不需要。

## 3. 目录结构

```
personalNodes/
├── app.py                    # 应用工厂、蓝图注册、安全响应头、全局错误处理、SPA catch-all、CLI
├── config.py                 # 密钥、上传限制、分页大小、会话配置（读环境变量）
├── requirements.txt          # 锁定版本的依赖清单
├── pip.conf                  # 国内镜像配置（清华 TUNA）
├── README.md                 # 本文件
├── db/
│   └── schema.sql            # 幂等建表语句
├── core/
│   ├── db.py                 # 连接获取/释放、Row 工厂、PRAGMA、各表 DAO
│   ├── response.py           # ok(data, message) / fail(code, message, http_status)
│   ├── errors.py             # 错误码常量与「code → HTTP 状态 + 中文文案」映射
│   ├── auth.py               # login_required、CSRF/Origin 校验、当前用户、分享解锁态
│   ├── validators.py         # 邮箱/用户名/密码/标题/标签/评论/分享密码校验
│   ├── security.py           # 密码哈希、share_token 生成、限流记录与判定
│   └── markdown.py           # 服务端摘要/纯文本（不做 HTML 渲染）
├── api/
│   ├── auth.py  users.py  notes.py  tags.py
│   └── share.py  comments.py  favorites.py  history.py  uploads.py
├── static/
│   ├── css/   base.css home.css about.css auth.css notes.css editor.css share.css profile.css
│   ├── js/    store.js api.js ui.js markdown.js router.js comments.js
│   │          + 页面模块 home.js about.js auth.js notes.js editor.js share.js profile.js
│   ├── vendor/ marked.min.js  purify.min.js        # 锁定版本，本地引用
│   ├── img/   hero.jpg hero-960.jpg hero.webp hero-960.webp paper.jpg paper.webp logo.svg
│   └── uploads/                 # 用户上传图片（运行时生成，静态返回，禁止脚本执行）
├── index.html                # SPA 入口，挂载 #app / #app-header / toast 与弹窗根节点
├── tests/                    # pytest 套件
│   ├── test_*.py             # 后端契约、前端契约、安全、对比度等
│   ├── js/                   # Node 最小 DOM 双端渲染 harness（*.mjs）
│   └── manual/               # 手工清单：xss-fixtures.md、visual-checklist.md、
│                             #   end-to-end-walkthrough.md、check_contrast.py、walkthrough_probe.py
└── docs/
    ├── specs/                # 设计文档
    └── plans/                # 分阶段实施计划
```

## 4. 快速开始

```bash
# 1) 创建虚拟环境（Windows / Git Bash）
python -m venv .venv

# 2) 安装依赖（见第 5 节的镜像说明）
.venv/Scripts/python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt

# 3) 初始化数据库（幂等，可重复执行；读取 db/schema.sql 建表）
.venv/Scripts/python.exe app.py init-db

# 4) 启动开发服务器
.venv/Scripts/python.exe app.py run
```

浏览器打开 <http://127.0.0.1:5000> 即可。

`app.py` 支持三个命令：

| 命令 | 作用 |
|------|------|
| `init-db` | 读取 `db/schema.sql` 幂等建表 |
| `run` | Flask 开发服务器，`127.0.0.1:5000`，开启 debug |
| `serve` | waitress 生产服务器，`0.0.0.0:5000` |

> Windows 下虚拟环境可执行文件位于 `.venv/Scripts/`；Linux/macOS 下为 `.venv/bin/`。
> 使用默认 `SECRET_KEY` 启动时会打印一条警告，提示生产部署前替换（见第 7、9 节）。

## 5. 镜像与依赖锁定

- **Python 依赖**：`requirements.txt` 精确锁版本；仓库根目录 `pip.conf` 指向清华 TUNA 镜像：

  ```ini
  [global]
  index-url = https://pypi.tuna.tsinghua.edu.cn/simple
  trusted-host = pypi.tuna.tsinghua.edu.cn
  ```

  若 `pip` 未自动读取该文件，请在安装命令中显式指定 `-i https://pypi.tuna.tsinghua.edu.cn/simple`。
  安装后可校验解析到的版本：

  ```bash
  .venv/Scripts/python.exe -c "from importlib.metadata import version; print(version('Flask'), version('Werkzeug'), version('Pillow'), version('waitress'), version('pytest'))"
  # 期望输出：3.0.3 3.0.6 10.4.0 3.0.2 8.4.2
  ```

- **前端 vendor**：从 npmmirror 下载指定版本后放入 `static/vendor/`，版本号必须保持一致：

  ```bash
  mkdir -p /tmp/vendor-src && cd /tmp/vendor-src
  npm pack marked@12.0.2 dompurify@3.1.6 --registry=https://registry.npmmirror.com
  tar -xzf marked-12.0.2.tgz   && cp package/marked.min.js "<repo>/static/vendor/marked.min.js"
  tar -xzf dompurify-3.1.6.tgz && cp package/dist/purify.min.js "<repo>/static/vendor/purify.min.js"
  ```

  | 文件 | 包与版本 | 全局导出 |
  |------|----------|----------|
  | `static/vendor/marked.min.js` | `marked@12.0.2` | `window.marked` |
  | `static/vendor/purify.min.js` | `dompurify@3.1.6` | `window.DOMPurify` |

  > `DOMPurify` 是 Markdown 渲染的 XSS 防护唯一依赖，**不得替换来源，也不得用自研正则替代**。

## 6. 测试

```bash
# 全量套件
.venv/Scripts/python.exe -m pytest tests/ -v

# 聚焦示例
.venv/Scripts/python.exe -m pytest tests/test_security_headers.py tests/test_authz_matrix.py -v
```

- 后端与前端契约测试位于 `tests/`；前端渲染契约复用 `tests/js/dom-shim.mjs` 最小 DOM 双端
  （需 Node.js）。
- **手工清单**位于 `tests/manual/`：
  - `xss-fixtures.md`：Markdown/HTML 注入样例与期望结果；
  - `visual-checklist.md`：路由 × 视口 × 状态的视觉与交互验收清单（含 Phase 8 全量矩阵）；
  - `end-to-end-walkthrough.md`：35 步端到端走查脚本与逐行结论；
  - `check_contrast.py`：从 `base.css` 的 `:root` 核算 WCAG 对比度（退出码 0 = 全部达标），
    由 `tests/test_contrast.py` 纳入自动回归；
  - `walkthrough_probe.py`：走查脚本的可执行子集（Flask test client，退出码 0 = 通过）。

## 7. 环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SECRET_KEY` | `dev-only-change-me` | **生产必填**。会话签名密钥，务必替换为高强度随机值 |
| `COOKIE_SECURE` | `0` | **生产必填为 `1`**。启用 HTTPS 后让 Session Cookie 带 `Secure` |
| `DATABASE` | `db/app.db` | 可选。SQLite 数据库文件路径 |

```bash
# 生成并注入一个强随机 SECRET_KEY（Git Bash）
export SECRET_KEY="$(.venv/Scripts/python.exe -c 'import secrets;print(secrets.token_urlsafe(48))')"
export COOKIE_SECURE=1
```

## 8. 生产部署

- **WSGI 服务器**：使用 waitress 启动：

  ```bash
  .venv/Scripts/python.exe app.py serve     # 监听 0.0.0.0:5000
  ```

  建议置于反向代理（Nginx/Caddy 等）之后并启用 **HTTPS**；Linux 下也可改用 gunicorn。

- **静态上传目录**：`static/uploads/` 必须以**静态资源**返回，**禁止执行脚本**；目录需可写。
  反向代理配置中不要为 `static/uploads/` 开启任何脚本处理器（如 PHP/CGI）。
- **反向代理限流**：在代理层对 `POST /api/auth/login` 与 `POST /api/share/*/verify`
  追加请求频率限制（应用内已对这两处做失败计数限流，代理层限流为额外纵深）。
- **备份**：将 `db/app.db` 与 `static/uploads/` 纳入定期备份；数据库变更前先复制 `db/app.db`。
- **回滚**：应用为单进程无状态（除 Cookie），回滚即替换代码目录。

## 9. 安全清单（部署前逐项确认）

- [ ] 已通过环境变量替换 `SECRET_KEY`（不再是默认 `dev-only-change-me`）。
- [ ] 已设置 `COOKIE_SECURE=1`（HTTPS 下）。
- [ ] CSP 已启用且**不含 `'unsafe-inline'`**；前端无内联 `style`、内联 `<script>` 代码与 `onclick` 属性。
- [ ] 上传白名单（jpg/jpeg/png/gif/webp）+ Pillow 真实解码校验 + UUID 重命名（丢弃原始文件名）生效；
      单文件上限 5MB、单用户总量默认 200MB（`config.USER_UPLOAD_QUOTA`）。
- [ ] 分享 token 使用 `secrets.token_urlsafe(24)`（≥128 位熵），关闭分享即清空 token 与密码哈希。
- [ ] 密码使用 `pbkdf2:sha256` 哈希存储（不通明文、不逆加密）；分享密码同样哈希存储。
- [ ] `static/uploads/` 禁止脚本执行，仅按静态资源返回。
- [ ] 响应附带 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、`Referrer-Policy: no-referrer`。

应用为每条响应附加的安全头（可在浏览器 DevTools 或 `curl -I` 中核对）：

```
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Content-Security-Policy: default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'
```

## 10. 运行时产物（不纳入版本控制）

以下路径由运行/开发过程生成，已在 `.gitignore` 中排除，**不得提交**：

- `db/app.db`（及其 `-wal` / `-shm` 伴生文件）
- `static/uploads/*`（保留 `static/uploads/.gitkeep` 占位）
- `__pycache__/`、`*.pyc`
- `.venv/`
