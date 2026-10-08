# 个人笔记（personalNodes）

一个可部署到公网的在线个人笔记应用：注册登录、Markdown 笔记的草稿／私密／公开三态管理、
带密码的链接分享、评论、收藏与浏览足迹。

- 后端：Python + Flask（蓝图拆分，统一 `{code, message, data}` JSON 响应）+ 标准库 `sqlite3`
- 前端：原生 HTML + CSS + JavaScript 的单页应用（History API 路由），Markdown 在前端渲染并清洗
- 数据库：SQLite 单文件（`db/app.db`，WAL 模式、外键开启）

---

## 1. 环境要求

| 项目 | 版本 | 说明 |
|------|------|------|
| Python | 3.12 | 开发与验证环境为 3.12.7；3.10+ 理论可用，未做验证 |
| SQLite | 标准库 `sqlite3` 自带（开发环境 3.45.3） | 无需单独安装 |
| Git Bash | Windows 下执行本文命令 | 路径统一使用正斜杠 |
| Node.js / npm | 24.13.0 / 11.6.2 | **仅**在需要重新下载前端 vendor 包时使用，运行应用不需要 |

运行应用本身**不依赖**任何在线 CDN、外部服务或邮件服务。

---

## 2. 依赖安装

依赖清单锁版本写在 `requirements.txt`：

```
Flask==3.0.3
Werkzeug==3.0.6
Pillow==10.4.0
waitress==3.0.2
pytest==8.4.2
```

### 镜像说明

仓库根目录的 `pip.conf` 已配置清华 TUNA 镜像（国内网络下无需额外参数）：

```ini
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
```

若 `pip` 没有自动读取该文件，请在安装命令中显式指定镜像：

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
```

安装完成后可校验版本：

```bash
.venv/Scripts/python.exe -c "import flask,werkzeug,PIL,pytest,waitress; print(flask.__version__, werkzeug.__version__, PIL.__version__, pytest.__version__, waitress.__version__)"
# 期望输出：3.0.3 3.0.6 10.4.0 8.4.2 3.0.2
```

> Windows 下虚拟环境可执行文件位于 `.venv/Scripts/`；Linux/macOS 下为 `.venv/bin/`。

### 前端 vendor 依赖

`marked` 与 `DOMPurify` 已下载到 `static/vendor/`，以本地 `<script>` 引用，**不依赖运行时 CDN**：

| 文件 | 包与版本 | 全局导出 |
|------|----------|----------|
| `static/vendor/marked.min.js` | `marked@12.0.2` | `window.marked` |
| `static/vendor/purify.min.js` | `dompurify@3.1.6` | `window.DOMPurify` |

需要重新获取时（版本必须保持一致）：

```bash
mkdir -p /tmp/vendor-src && cd /tmp/vendor-src
npm pack marked@12.0.2 dompurify@3.1.6 --registry=https://registry.npmmirror.com
tar -xzf marked-12.0.2.tgz   && cp package/marked.min.js "<repo>/static/vendor/marked.min.js"
tar -xzf dompurify-3.1.6.tgz && cp package/dist/purify.min.js "<repo>/static/vendor/purify.min.js"
```

> `DOMPurify` 是 Markdown 渲染的 XSS 防护唯一依赖，不得替换为其他来源的内容，也不得用自研正则替代。

### 用户上传目录

`static/uploads/` 存放用户上传的图片（由 `static/uploads/.gitkeep` 占位保留）。该目录**需可写**，
且必须按静态资源返回，**禁止执行脚本**。

---

## 3. 启动方式

```bash
# 1) 初始化数据库（幂等，可重复执行；读取 db/schema.sql 建表）
.venv/Scripts/python.exe app.py init-db

# 2) 启动开发服务器（默认 http://127.0.0.1:5000）
.venv/Scripts/python.exe app.py run

# 生产环境使用 WSGI 服务器（waitress）
.venv/Scripts/python.exe app.py serve
```

`app.py` 支持三个命令：

| 命令 | 作用 |
|------|------|
| `init-db` | 读取 `db/schema.sql` 幂等建表 |
| `run` | Flask 开发服务器，`127.0.0.1:5000`，开启 debug |
| `serve` | waitress 生产服务器，`0.0.0.0:5000` |

### 运行测试

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

---

## 4. 安全提示（生产部署前必读）

- ⚠️ **必须替换 `SECRET_KEY`**。`config.py` 中的默认值 `dev-only-change-me` 仅用于本地开发，
  生产环境务必通过环境变量注入高强度随机值，例如：

  ```bash
  export SECRET_KEY="$(.venv/Scripts/python.exe -c 'import secrets;print(secrets.token_urlsafe(48))')"
  ```

- ⚠️ **必须设置 `COOKIE_SECURE=1`**。启用 HTTPS 后用该环境变量打开 Session Cookie 的 `Secure` 属性，
  避免 Cookie 在明文连接上泄露。

- 反向代理层需启用 HTTPS，并对 `/api/auth/login`、`/api/share/*/verify` 追加请求频率限制。
- `db/app.db` 与 `static/uploads/` 需纳入定期备份。

### 可用环境变量

| 变量 | 默认值 | 说明 |
|------|--------|------|
| `SECRET_KEY` | `dev-only-change-me` | **生产必须替换** |
| `DATABASE` | `db/app.db` | SQLite 数据库文件路径 |
| `COOKIE_SECURE` | `0` | 设为 `1` 时 Session Cookie 带 `Secure` |
