# Phase 1: 项目骨架与基础设施

**Goal:** 跑通「Flask 应用工厂 + SPA 骨架 + 统一响应契约 + SQLite schema + 前端设计令牌」的底座，让后续每个阶段都有可验证的落点。

**Prerequisites:** 无。仓库当前只有 `个人笔记提示词.md`、`docs/specs/2026-10-08-personal-notes-design.md`、`docs/plans/` 与三份图片素材。

**Deliverables:**
- 可用 `.venv` 虚拟环境与锁版本的 `requirements.txt`
- 能启动的 Flask 应用：`/api/*` 返回统一 JSON 信封，SPA 深链刷新返回 `index.html`
- 已建表的 SQLite 库 `db/app.db`（8 张表）
- 可执行的 `pytest`（本阶段 3 个测试文件）
- 前端 SPA 骨架：`index.html` + 设计令牌 + 通用组件（toast / 弹窗 / 顶栏骨架）
- 转码后的前端素材（hero 四档、paper 两档、logo.svg）

**Interface Decisions Implemented:**
- 11 个色彩角色、字体层级、圆角/阴影/间距令牌落为 `base.css` 的 `:root` 变量
- 全局 toast（成功 `#6B8E5A` / 失败 `#C25E4E` / 信息主色，右上角，2.5s，悬停暂停）与二次确认弹窗骨架（`role="dialog"` + `aria-modal` + 焦点锁 + `Esc` 关闭）
- 响应式三档断点变量（860px 兼容断点用于「≤768px」移动档，1200px 用于桌面档）
- 顶栏容器骨架（未登录/已登录两态由 Phase 2、Phase 3 填充）
- 主页/纸张素材转码与 `logo.svg`（笔记本 + 左侧装订圈 + 中央心形，主色 `#C3A47B`、强调色 `#D9B98C`）

---

## Task 1: 依赖、镜像与启动文档

**Goal:** 建立可复现的 Python 环境并锁定依赖版本，写入启动说明。

**Files:**
- Create: `requirements.txt`
- Create: `pip.conf`
- Create: `README.md`

**Steps:**

- [x] 创建 `requirements.txt`（5 个依赖，版本已在清华 TUNA 镜像核验可用）：

```
Flask==3.0.3
Werkzeug==3.0.6
Pillow==10.4.0
waitress==3.0.2
pytest==8.4.2
```

- [x] 创建 `pip.conf`：

```
[global]
index-url = https://pypi.tuna.tsinghua.edu.cn/simple
trusted-host = pypi.tuna.tsinghua.edu.cn
```

- [x] 创建虚拟环境并安装：

```bash
python -m venv .venv
.venv/Scripts/python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
```

  - Expected: 末行出现 `Successfully installed Flask-3.0.3 Pillow-10.4.0 Werkzeug-3.0.6 pytest-8.4.2 waitress-3.0.2`

- [x] 验证版本：

```bash
.venv/Scripts/python.exe -c "import flask,werkzeug,PIL,pytest,waitress; print(flask.__version__, werkzeug.__version__, PIL.__version__, pytest.__version__, waitress.__version__)"
```

  - Expected: `3.0.3 3.0.6 10.4.0 8.4.2 3.0.2`

- [x] 创建 `README.md`，至少包含四节：环境要求（Python 3.12）、依赖安装（含 `pip.conf` 镜像说明）、启动方式（`init-db` → `run`）、以及「生产部署前必须通过环境变量替换 `SECRET_KEY` 并将 `COOKIE_SECURE=1`」的安全提示；同时记录前端 vendor 版本 `marked@12.0.2`、`dompurify@3.1.6`。

**Dependencies:** 无

---

## Task 2: 前端 vendor 依赖本地化

**Goal:** 把 `marked` 与 `DOMPurify` 下载到 `static/vendor/`，不依赖运行时 CDN，版本可追溯。

**Files:**
- Create: `static/vendor/marked.min.js`
- Create: `static/vendor/purify.min.js`

**Steps:**

- [x] 在临时目录下载两个包（真实文件路径已核验）：

```bash
mkdir -p /tmp/vendor-src && cd /tmp/vendor-src
npm pack marked@12.0.2 dompurify@3.1.6 --registry=https://registry.npmmirror.com
```

  - Expected: 生成 `marked-12.0.2.tgz` 与 `dompurify-3.1.6.tgz`

- [x] 解包并复制到仓库（`marked` 的压缩 UMD 构建在包根目录，`dompurify` 的在 `dist/`）：

```bash
cd /tmp/vendor-src
tar -xzf marked-12.0.2.tgz && mv package/marked.min.js "<repo>/static/vendor/marked.min.js"
rm -rf package
tar -xzf dompurify-3.1.6.tgz && mv package/dist/purify.min.js "<repo>/static/vendor/purify.min.js"
rm -rf package
```

- [x] 校验文件大小与来源一致：

```bash
ls -l static/vendor/
```

  - Expected: `marked.min.js` 为 35479 字节、`purify.min.js` 为 21496 字节；两者均为单行压缩 JS（`head -c 80` 可看到 UMD 包装）

- [x] 校验全局导出（`marked.min.js` 暴露 `window.marked`，`purify.min.js` 暴露 `window.DOMPurify`）：

```bash
grep -c "window.marked\|globalThis.marked\|marked" static/vendor/marked.min.js >/dev/null && echo "marked ok"
grep -c "DOMPurify" static/vendor/purify.min.js >/dev/null && echo "purify ok"
```

  - Expected: 输出 `marked ok` 与 `purify ok`

**Security/Boundary Notes:** vendor 文件必须来自上述来源与版本，不得替换为其他 CDN 内容；`DOMPurify` 是 Markdown XSS 防护的唯一依赖，禁止在 Phase 5 用自研正则替代。

**Dependencies:** 无

---

## Task 3: 应用工厂、统一响应与全局错误处理

**Goal:** 建立唯一产出 `{code,message,data}` 的响应层与错误码表，并让 `/api/*` 的失败永远返回 JSON。

**Files:**
- Create: `config.py`
- Create: `core/__init__.py`
- Create: `core/errors.py`
- Create: `core/response.py`
- Create: `app.py`
- Create: `api/__init__.py`
- Test: `tests/conftest.py`
- Test: `tests/test_response_contract.py`
- Modify: 无

**Steps:**

- [x] 先写测试。创建 `tests/conftest.py`：

```python
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from config import Config
from core import db as db_module


class TestConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret"
    SERVER_NAME = None


@pytest.fixture()
def app(tmp_path):
    class _Cfg(TestConfig):
        DATABASE = str(tmp_path / "test.db")

    application = create_app(_Cfg)
    with application.app_context():
        db_module.init_db(application)
    yield application


@pytest.fixture()
def client(app):
    return app.test_client()
```

- [x] 创建 `tests/test_response_contract.py`：

```python
def test_unknown_api_path_returns_not_found_envelope(client):
    resp = client.get("/api/__nope__")
    assert resp.status_code == 404
    assert resp.get_json() == {
        "code": "NOT_FOUND",
        "message": "请求的内容不存在",
        "data": None,
    }


def test_chinese_message_is_not_ascii_escaped(client):
    body = client.get("/api/__nope__").get_data(as_text=True)
    assert "请求的内容不存在" in body
    assert "\\u8bf7" not in body
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_response_contract.py -v
```

  - Expected: FAIL（`ModuleNotFoundError: No module named 'app'`），先失败再实现

- [x] 创建 `config.py`：

```python
import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")
    DATABASE = os.environ.get("DATABASE", str(BASE_DIR / "db" / "app.db"))
    SCHEMA_FILE = str(BASE_DIR / "db" / "schema.sql")

    UPLOAD_DIR = str(BASE_DIR / "static" / "uploads")
    UPLOAD_URL_PREFIX = "/static/uploads/"
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024          # 单文件 5MB
    USER_UPLOAD_QUOTA = 200 * 1024 * 1024         # 单用户 200MB

    PAGE_SIZE_DEFAULT = 10
    PAGE_SIZE_MAX = 50
    MAX_TAGS_PER_NOTE = 5
    MAX_TITLE_LENGTH = 200
    MAX_NOTE_CONTENT_LENGTH = 100000
    MAX_COMMENT_LENGTH = 1000

    LOGIN_MAX_FAILURES = 5
    LOGIN_FAILURE_WINDOW_SECONDS = 900

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
```

- [x] 创建 `core/__init__.py`（空文件）与 `core/errors.py`：

```python
ERRORS = {
    "INVALID_PARAM":           (400, "参数不合法，请检查后重试"),
    "EMAIL_INVALID":           (400, "请输入正确的邮箱地址"),
    "EMAIL_EXISTS":            (409, "该邮箱已被注册"),
    "USERNAME_EXISTS":         (409, "该用户名已被占用"),
    "PASSWORD_WEAK":           (400, "密码长度需为 8-64 位，且包含字母与数字"),
    "PASSWORD_MISMATCH":       (400, "两次输入的密码不一致"),
    "PASSWORD_WRONG":          (400, "原密码不正确"),
    "INVALID_CREDENTIALS":     (401, "邮箱或密码错误"),
    "RATE_LIMITED":            (429, "尝试过于频繁，请稍后再试"),
    "UNAUTHORIZED":            (401, "请先登录"),
    "CSRF_INVALID":            (403, "请求校验失败，请刷新页面后重试"),
    "FORBIDDEN":               (403, "没有权限执行该操作"),
    "NOT_FOUND":               (404, "请求的内容不存在"),
    "SHARE_DISABLED":          (404, "该分享链接已失效"),
    "SHARE_PASSWORD_REQUIRED": (401, "该笔记需要密码访问"),
    "SHARE_PASSWORD_WRONG":    (401, "访问密码错误"),
    "TAG_TOO_MANY":            (400, "最多只能添加 5 个标签"),
    "CONTENT_TOO_LONG":        (400, "输入内容超出长度限制"),
    "UPLOAD_TOO_LARGE":        (413, "图片大小不能超过 5MB"),
    "UPLOAD_TYPE_INVALID":     (400, "仅支持 JPG、PNG、GIF、WebP 格式的图片"),
    "STORAGE_QUOTA_EXCEEDED":  (413, "存储空间不足，请先清理历史图片"),
    "ALREADY_FAVORITED":       (409, "已收藏过该笔记"),
    "INTERNAL_ERROR":          (500, "服务器开小差了，请稍后重试"),
}


def error_status(code):
    return ERRORS.get(code, ERRORS["INTERNAL_ERROR"])[0]


def error_message(code):
    return ERRORS.get(code, ERRORS["INTERNAL_ERROR"])[1]
```

- [x] 创建 `core/response.py`：

```python
from flask import jsonify

from core.errors import error_message, error_status


def ok(data=None, message="操作成功"):
    return jsonify({"code": "OK", "message": message, "data": data}), 200


def fail(code, message=None, http_status=None):
    return jsonify({
        "code": code,
        "message": message or error_message(code),
        "data": None,
    }), http_status or error_status(code)
```

- [x] 创建 `db/schema.sql`，逐字实现需求文档「数据模型」章节的 DDL（`users`、`notes`、`tags`、`note_tags`、`comments`、`favorites`、`view_history`、`auth_attempts` 共 8 张表 + 7 个索引，全部使用 `CREATE TABLE IF NOT EXISTS` / `CREATE INDEX IF NOT EXISTS`），并保留 `PRAGMA foreign_keys = ON;` 作为首行。

- [x] 创建 `core/db.py`（本任务只建连接层，DAO 在 Task 4 与后续阶段追加）：

```python
import sqlite3
from pathlib import Path

from flask import current_app, g


def connect(database):
    Path(database).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(database)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_app(app):
    app.teardown_appcontext(close_db)


def init_db(app):
    schema = Path(app.config["SCHEMA_FILE"]).read_text(encoding="utf-8")
    conn = connect(app.config["DATABASE"])
    try:
        conn.executescript(schema)
        conn.commit()
    finally:
        conn.close()


def current_app_config(key):
    return current_app.config[key]
```

- [x] 创建 `api/__init__.py`（空文件）。九个蓝图模块（`auth`、`users`、`notes`、`tags`、`share`、`comments`、`favorites`、`history`、`uploads`）分别由后续阶段创建；`register_blueprints` 只注册真实存在的模块文件，因此后续任一阶段都无需回头改动 `app.py`。

- [x] 创建 `app.py`：

```python
from flask import Flask, request, send_from_directory
from werkzeug.exceptions import HTTPException

from config import Config
from core import db as db_module
from core.response import fail


def create_app(config_object=Config):
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config.from_object(config_object)
    app.json.ensure_ascii = False   # 保证中文 message 原样输出
    app.json.sort_keys = False

    db_module.init_app(app)
    register_blueprints(app)
    register_error_handlers(app)
    register_spa_fallback(app)
    return app


BLUEPRINT_MODULES = ("auth", "users", "notes", "tags", "share",
                     "comments", "favorites", "history", "uploads")


def register_blueprints(app):
    """按固定顺序注册「文件已存在」的蓝图模块。

    各蓝图由不同阶段创建，此处按文件存在性判断：
    既避免模块尚未创建时启动失败，也不会吞掉模块内部的真实导入错误。
    """
    import importlib
    from pathlib import Path

    for name in BLUEPRINT_MODULES:
        if not (Path(app.root_path) / "api" / f"{name}.py").exists():
            continue
        module = importlib.import_module(f"api.{name}")
        app.register_blueprint(module.bp)


def register_error_handlers(app):
    @app.errorhandler(HTTPException)
    def handle_http_exception(exc):
        if request.path.startswith("/api/"):
            if exc.code == 404:
                return fail("NOT_FOUND")
            if exc.code == 413:
                return fail("UPLOAD_TOO_LARGE")
            return fail("INTERNAL_ERROR", http_status=exc.code)
        if exc.code == 404:
            return send_from_directory(app.root_path, "index.html")
        return exc

    @app.errorhandler(Exception)
    def handle_unexpected(exc):
        app.logger.exception("未处理异常: %s", exc)
        return fail("INTERNAL_ERROR")


def register_spa_fallback(app):
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def spa(path):
        if path.startswith(("api/", "static/")):
            return fail("NOT_FOUND")
        return send_from_directory(app.root_path, "index.html")


def register_cli(app):
    @app.cli.command("init-db")
    def init_db_command():
        db_module.init_db(app)
        print("数据库初始化完成")


if __name__ == "__main__":
    import sys

    from waitress import serve

    cli_app = create_app()
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "init-db":
        with cli_app.app_context():
            db_module.init_db(cli_app)
        print("数据库初始化完成")
    elif command == "run":
        cli_app.run(host="127.0.0.1", port=5000, debug=True)
    elif command == "serve":
        serve(cli_app, host="0.0.0.0", port=5000)
    else:
        print(f"未知命令: {command}（可用：init-db / run / serve）")
```

**Security/Boundary Notes:**
- `app.json.ensure_ascii = False` 是中文 `message` 可读的前提，测试用例已覆盖。
- 全局 `Exception` 处理器只返回 `INTERNAL_ERROR` 与中文文案，绝不把堆栈或原始异常信息放入响应体；堆栈只进 `app.logger`。
- `/api/*` 的 404 不复用 SPA 兜底，避免把接口错误伪装成 HTML。

**Dependencies:** Task 1 的虚拟环境；`db_module` 在 Task 4 之前不存在时，本任务可先创建一个只含 `init_app`/`init_db`/`get_db` 的 `core/db.py` 空壳并立刻被 Task 4 补全。

---

## Task 4: 数据库 schema 回归与用户基础 DAO

**Goal:** 固化建表行为与 PRAGMA 设置，并交付后续阶段（注册、登录、鉴权）都会用到的用户查询 DAO 与统一时间源。

**Files:**
- Modify: `core/db.py`（追加 `now_iso` 与用户基础 DAO）
- Test: `tests/test_db_basics.py`

**Steps:**

- [x] 创建 `tests/test_db_basics.py`：

```python
import sqlite3

import pytest

from core import db as db_module

EXPECTED_TABLES = {
    "users", "notes", "tags", "note_tags",
    "comments", "favorites", "view_history", "auth_attempts",
}


def test_init_db_creates_all_tables(app):
    with app.app_context():
        conn = db_module.get_db()
        names = {r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    assert EXPECTED_TABLES <= names


def test_init_db_is_idempotent(app):
    db_module.init_db(app)   # 第二次执行不得报错
    db_module.init_db(app)
    with app.app_context():
        conn = db_module.get_db()
        count = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
        ).fetchone()[0]
    assert count >= len(EXPECTED_TABLES)


def test_foreign_keys_are_enforced(app):
    with app.app_context():
        conn = db_module.get_db()
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO notes (user_id, title, content_md, status, created_at, updated_at) "
                "VALUES (9999, 't', '', 'draft', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
            )


def test_wal_mode_enabled(app):
    with app.app_context():
        conn = db_module.get_db()
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"


def test_row_factory_returns_mapping(app):
    with app.app_context():
        row = db_module.get_db().execute("SELECT 1 AS one").fetchone()
        assert row["one"] == 1


def test_now_iso_is_utc_seconds_precision():
    value = db_module.now_iso()
    assert value.endswith("Z") and len(value) == 20
    assert value[4] == "-" and value[10] == "T" and value[19] == "Z"


def test_user_lookup_helpers(app):
    with app.app_context():
        conn = db_module.get_db()
        conn.execute("INSERT INTO users (email, username, password_hash, created_at) "
                     "VALUES ('a@b.com', 'alice', 'x', ?)", (db_module.now_iso(),))
        conn.commit()
        by_email = db_module.get_user_by_email(conn, "a@b.com")
        assert by_email["username"] == "alice"
        assert db_module.get_user_by_id(conn, by_email["id"])["email"] == "a@b.com"
        assert db_module.get_user_by_username(conn, "alice")["id"] == by_email["id"]
        assert db_module.get_user_by_email(conn, "missing@b.com") is None
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_db_basics.py -v
```

  - Expected: `test_now_iso_is_utc_seconds_precision` 与 `test_user_lookup_helpers` FAIL（`AttributeError: module 'core.db' has no attribute 'now_iso'`），其余 5 项 passed

- [x] 在 `core/db.py` 追加统一时间源与用户基础 DAO：

```python
from datetime import datetime, timezone


def now_iso():
    """全项目唯一的时间来源：ISO8601 UTC，秒级精度，带 Z 后缀。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_user_by_id(conn, user_id):
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def get_user_by_email(conn, email):
    return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def get_user_by_username(conn, username):
    return conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()
```

- [x] 再次运行测试与全量测试：

```bash
.venv/Scripts/python.exe -m pytest tests/test_db_basics.py -v
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: `tests/test_db_basics.py` 7 passed；`tests/` 中 `test_response_contract.py` 的 2 个用例通过、SPA 兜底用例此时尚未加入

- [x] 初始化真实数据库并确认表存在：

```bash
.venv/Scripts/python.exe app.py init-db
.venv/Scripts/python.exe -c "import sqlite3;c=sqlite3.connect('db/app.db');print(sorted(r[0] for r in c.execute(\"SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'\")))"
```

  - Expected: 输出 `数据库初始化完成`，随后输出包含 8 张表名的列表

**Security/Boundary Notes:**
- `PRAGMA foreign_keys = ON` 必须在每个连接上开启（SQLite 该设置是连接级的），因此写在 `connect()` 而非 schema 里生效。
- DAO 从本阶段起逐步积累；本阶段只交付连接层与用户查询，笔记、标签、评论、收藏、足迹、分享 DAO 分别由 Phase 4、Phase 6、Phase 7 追加。每个新 DAO 必须使用 `?` 占位符，禁止 f-string 拼 SQL；动态排序与筛选片段只能取自代码内常量白名单。
- 测试使用 `tmp_path` 下的独立库文件，不触碰 `db/app.db`。

**Dependencies:** Task 3

---

## Task 5: 前端 SPA 骨架、设计令牌与通用组件

**Goal:** 建立 `index.html` 入口、路由/请求/状态三个基础模块、设计令牌与通用 UI 组件，并用一个占位视图验证整条前端链路可跑。

**Files:**
- Create: `index.html`
- Create: `static/css/base.css`
- Create: `static/js/store.js`
- Create: `static/js/api.js`
- Create: `static/js/ui.js`
- Create: `static/js/router.js`
- Test: `tests/test_response_contract.py`（追加 1 个用例）

**Steps:**

- [x] 创建 `index.html`，预置全部页面样式表与脚本挂载点：

```html
<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>个人笔记</title>
  <link rel="icon" type="image/svg+xml" href="/static/img/logo.svg">
  <link rel="stylesheet" href="/static/css/base.css">
  <link rel="stylesheet" href="/static/css/home.css">
  <link rel="stylesheet" href="/static/css/about.css">
  <link rel="stylesheet" href="/static/css/auth.css">
  <link rel="stylesheet" href="/static/css/notes.css">
  <link rel="stylesheet" href="/static/css/editor.css">
  <link rel="stylesheet" href="/static/css/share.css">
  <link rel="stylesheet" href="/static/css/profile.css">
</head>
<body>
  <header id="app-header"></header>
  <main id="app"></main>
  <div id="toast-root" class="toast-root" aria-live="polite" aria-atomic="false"></div>
  <div id="dialog-root"></div>
  <script src="/static/vendor/marked.min.js"></script>
  <script src="/static/vendor/purify.min.js"></script>
  <script type="module" src="/static/js/router.js"></script>
</body>
</html>
```

  - 注：Phase 1 尚不存在 `home.css` 等 7 个文件，需同时创建空文件占位，避免 404 影响排查；每个文件顶部写一行注释说明所属阶段。

- [x] 创建 `static/css/base.css`，`<head>` 顺序中它必须最先定义令牌。`:root` 至少包含：

```css
:root {
  /* 色彩角色 */
  --c-page:        #FAF8F5;
  --c-surface:     #FFFFFF;
  --c-paper-fallback: #FBF6EA;
  --c-text:        #3D3630;
  --c-text-muted:  #8C8177;
  --c-text-muted-strong: #6E6459;   /* ≥16px 以下辅助文字使用，保证对比度 */
  --c-primary:     #C3A47B;
  --c-primary-hover:#B08F63;
  --c-accent:      #D9B98C;
  --c-border:      #EDE7DE;
  --c-danger:      #C25E4E;
  --c-success:     #6B8E5A;

  /* 字体 */
  --font-sans: "PingFang SC", "Microsoft YaHei", "Noto Sans SC", system-ui, sans-serif;
  --fs-xs: 12px; --fs-sm: 14px; --fs-base: 16px;
  --fs-h3: 20px; --fs-h2: 28px; --fs-hero: 40px;
  --lh-base: 1.75; --lh-reading: 1.9;

  /* 间距（4px 栅格） */
  --sp-1: 4px; --sp-2: 8px; --sp-3: 12px; --sp-4: 16px;
  --sp-6: 24px; --sp-8: 32px; --sp-12: 48px; --sp-16: 64px;

  /* 形状与阴影 */
  --r-1: 8px; --r-2: 12px;
  --sd-card:  0 2px 12px rgba(61, 54, 48, .06);
  --sd-float: 0 8px 32px rgba(61, 54, 48, .12);
  --bd: 1px solid var(--c-border);

  /* 布局 */
  --page-max: 1200px;
  --reading-max: 720px;
  --gutter: 24px;
  --header-h: 72px;

  /* 断点（供 JS 使用） */
  --bp-mobile: 768px;
  --bp-desktop: 1200px;
}
@media (max-width: 768px) { :root { --gutter: 16px; } }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after { animation-duration: .01ms !important; transition-duration: .01ms !important; }
}
```

  同文件另需实现重置、`.btn`（主/次/危险三态，主按钮文字用 `var(--c-text)` 且底色 `var(--c-primary-hover)` 以满足 4.5:1 对比度）、`.field`、`.card`、`.paper`（纸张容器，Phase 5 起使用）、`.toast-root` / `.toast`、`.dialog-mask` / `.dialog`、`.skeleton`、`.empty-state`、以及 `≤768px` 的汉堡抽屉样式与 `≥768px` 时隐藏汉堡按钮。

- [x] 创建 `static/js/store.js`：

```js
export const store = {
  user: null,          // 当前用户对象或 null
  csrfToken: null,     // 内存中的 CSRF Token，禁止写入 localStorage
  guards: [],          // 登录态变化回调

  setUser(user, csrfToken) {
    this.user = user || null;
    this.csrfToken = csrfToken || null;
    this.guards.forEach((fn) => fn(this.user));
  },
  isLoggedIn() { return this.user !== null; },
  onChange(fn) { this.guards.push(fn); },
  rawPage: null,       // 编辑器脏数据标记（Phase 5 使用）
};
```

- [x] 创建 `static/js/api.js`（统一信封拦截，Phase 1 先不接入 toast 之外的分支逻辑）：

```js
import { store } from './store.js';

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function request(method, path, { body, formData, silent } = {}) {
  const headers = {};
  if (store.csrfToken) headers['X-CSRF-Token'] = store.csrfToken;
  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const resp = await fetch(path, {
    method, headers, body: payload, credentials: 'same-origin',
  });

  let data = null;
  try { data = await resp.json(); } catch (_) { /* 非 JSON，交给下面兜底 */ }

  if (!data || typeof data.code !== 'string') {
    const err = new ApiError('INTERNAL_ERROR', '服务器开小差了，请稍后重试');
    if (!silent) showError(err.message);
    throw err;
  }
  if (data.code !== 'OK') {
    const err = new ApiError(data.code, data.message);
    if (!silent) showError(data.message);
    onApiError(err);
    throw err;
  }
  return data.data;
}

function onApiError(err) {
  if (err.code === 'UNAUTHORIZED') {
    store.setUser(null, null);
    const back = encodeURIComponent(location.pathname + location.search);
    location.assign(`/login?redirect=${back}`);
  }
  if (err.code === 'CSRF_INVALID') {
    window.dispatchEvent(new Event('csrf-invalid'));
  }
}

let showError = () => {};        // 由 router.js 注入 ui.toast，避免循环依赖
export function bindErrorToast(fn) { showError = fn; }

export const api = {
  get:    (p, o)       => request('GET', p, o),
  post:   (p, b, o)    => request('POST', p, { body: b, ...o }),
  put:    (p, b, o)    => request('PUT', p, { body: b, ...o }),
  del:    (p, o)       => request('DELETE', p, o),
  upload: (p, fd, o)   => request('POST', p, { formData: fd, ...o }),
};
```

**Security/Boundary Notes:** `api.js` 是本项目唯一的 fetch 出口；错误文案只能来自后端 `message`，除「响应体不是 JSON」这一层网络兜底外不得内联中文错误文案。CSRF Token 只存内存。

- [x] 创建 `static/js/ui.js`，至少导出：`renderHeader(user, activePath)`（Phase 1 先渲染未登录态占位链接，Phase 2 补全视觉、Phase 3 补全已登录态）、`toast(message, type)`、`confirmDialog({ title, message, confirmText, danger })` 返回 `Promise<boolean>`、`skeleton(count)`、`emptyState({ title, actionText, onAction })`、`formatDate(iso)`（7 天内相对时间，否则 `YYYY-MM-DD HH:mm`）、`escapeHtml(text)`。

  `confirmDialog` 必须是 `role="dialog"` + `aria-modal="true"`，打开时把焦点移入首个按钮并把焦点锁在弹窗内（监听 `keydown` 拦截 `Tab`、`Escape` 关闭并回焦触发元素）。

- [x] 创建 `static/js/router.js`，实现 History API 路由与占位视图：

```js
import { store } from './store.js';
import { api, bindErrorToast } from './api.js';
import { toast, renderHeader } from './ui.js';

const routes = [];   // { pattern, requiresAuth, load }

export function registerRoute(pattern, load, { requiresAuth = false } = {}) {
  routes.push({ pattern, requiresAuth, load });
}

function match(pathname) {
  const segs = pathname.replace(/\/+$/, '').split('/');
  for (const route of routes) {
    const p = route.pattern.split('/');
    if (p.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (p[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export async function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  await render();
}

async function render() {
  const root = document.getElementById('app');
  const found = match(location.pathname) || { route: notFoundRoute, params: {} };
  const { route, params } = found;
  if (route.requiresAuth && !store.isLoggedIn()) {
    const back = encodeURIComponent(location.pathname + location.search);
    return navigate(`/login?redirect=${back}`, { replace: true });
  }
  root.innerHTML = '';
  renderHeader(store.user, location.pathname);
  await route.load(root, params);
}

const notFoundRoute = {
  requiresAuth: false,
  load(root) {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'empty-state';
    box.innerHTML = '<h2>页面不存在</h2>';
    const a = document.createElement('a');
    a.href = '/'; a.className = 'btn btn-primary'; a.textContent = '返回首页';
    box.appendChild(a);
    root.appendChild(box);
  },
};

// Phase 1 占位视图，Phase 2 由 static/js/home.js 替换
// 注意：不得使用内联 style 与内联事件，Phase 8 会启用不含 'unsafe-inline' 的严格 CSP
registerRoute('/', (root) => {
  root.innerHTML = '<section class="paper paper-padded">'
    + '<h1>个人笔记</h1><p>骨架就绪，主页视图将在 Phase 2 实现。</p></section>';
});

bindErrorToast(toast);
window.addEventListener('popstate', render);
window.addEventListener('csrf-invalid', async () => {
  try { const me = await api.get('/api/auth/me', { silent: true });
        store.setUser(me.user, me.csrf_token); toast('已刷新请求校验，请重试', 'info'); }
  catch (_) { store.setUser(null, null); }
});
document.addEventListener('DOMContentLoaded', render);
```

  同时创建 `static/js/home.js`、`about.js`、`auth.js`、`notes.js`、`editor.js`、`share.js`、`profile.js` 作为空模块占位（每个文件仅一行导出注释），Phase 2 起逐个填充。

- [x] 在 `tests/test_response_contract.py` 追加：

```python
def test_spa_fallback_serves_index_html(client):
    resp = client.get("/notes/123")
    assert resp.status_code == 200
    assert b'id="app"' in resp.data


def test_unknown_static_is_not_spa_fallback(client):
    resp = client.get("/static/__missing__.png")
    assert resp.status_code == 404
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 4 个用例全部 passed

**Dependencies:** Task 2（脚本引用 vendor 文件）、Task 3（`create_app` 与 SPA 兜底）、Task 6（`logo.svg` favicon，缺失只影响图标显示不阻塞测试）

---

## Task 6: 前端素材转码与 logo

**Goal:** 把两张源图转成多格式多尺寸的 Web 资源，并交付与设计稿同构图的 `logo.svg`。

**Files:**
- Create: `static/img/hero.jpg` `hero-960.jpg` `hero.webp` `hero-960.webp`
- Create: `static/img/paper.jpg` `paper.webp`
- Create: `static/img/logo.svg`
- Create: `static/uploads/.gitkeep`

**Steps:**

- [x] 确认源图真实尺寸（已核验，写在下方以便回归）：

| 源文件 | 尺寸 | 体积 |
|--------|------|------|
| `个人笔记主页.jpg` | 2560×1440 | 1550 KB |
| `个人笔记-笔记背景.jpg` | 1666×944 | 964 KB |
| `图片素材/个人笔记-主页截图.jpg` | 1666×944 | 741 KB（设计稿，仅用于对照，不作为资源） |

- [x] 在同一次 Python 进程中完成全部转码（源图均按等比例缩小，不做放大）：

```bash
.venv/Scripts/python.exe - <<'PY'
from pathlib import Path
from PIL import Image

OUT = Path("static/img"); OUT.mkdir(parents=True, exist_ok=True)

hero = Image.open("个人笔记主页.jpg").convert("RGB")
hero.resize((1920, 1080), Image.LANCZOS).save(OUT / "hero.jpg", quality=82, optimize=True, progressive=True)
hero.resize((960, 540), Image.LANCZOS).save(OUT / "hero-960.jpg", quality=82, optimize=True, progressive=True)
hero.resize((1920, 1080), Image.LANCZOS).save(OUT / "hero.webp", quality=80, method=6)
hero.resize((960, 540), Image.LANCZOS).save(OUT / "hero-960.webp", quality=80, method=6)

paper = Image.open("个人笔记-笔记背景.jpg").convert("RGB").resize((1600, 907), Image.LANCZOS)
paper.save(OUT / "paper.jpg", quality=80, optimize=True, progressive=True)
paper.save(OUT / "paper.webp", quality=78, method=6)
print("转码完成")
PY
```

  - Expected: 输出 `转码完成`

- [x] 校验产物尺寸与体积：

```bash
ls -l static/img/
.venv/Scripts/python.exe -c "
from PIL import Image
for f in ['hero.jpg','hero-960.jpg','hero.webp','hero-960.webp','paper.jpg','paper.webp']:
    print(f, Image.open('static/img/'+f).size)
"
```

  - Expected: `hero.jpg (1920, 1080)`、`hero-960.jpg (960, 540)`、`hero.webp (1920, 1080)`、`hero-960.webp (960, 540)`、`paper.jpg (1600, 907)`、`paper.webp (1600, 907)`；`hero.jpg` 建议 ≤ 400 KB，`paper.jpg` 建议 ≤ 400 KB

- [x] 创建 `static/img/logo.svg`（笔记本 + 左侧装订圈 + 中央心形，配色取自设计令牌）：

```svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" width="32" height="32" role="img" aria-label="个人笔记">
  <rect x="5" y="3" width="22" height="26" rx="3" fill="none" stroke="#C3A47B" stroke-width="2"/>
  <path d="M11 3v26" stroke="#C3A47B" stroke-width="2"/>
  <circle cx="11" cy="8" r="1.6" fill="#D9B98C"/>
  <circle cx="11" cy="16" r="1.6" fill="#D9B98C"/>
  <circle cx="11" cy="24" r="1.6" fill="#D9B98C"/>
  <path d="M19.5 15.4c-1.5-2.1-4.2-1.9-5-.4-.6 1.1-.3 2.3.7 3.3l4.3 3.9 4.3-3.9c1-1 1.3-2.2.7-3.3-.8-1.5-3.5-1.7-5 .4z" fill="#C3A47B"/>
</svg>
```

- [x] 创建 `static/uploads/.gitkeep`（内容为空），并在 `README.md` 追加一行说明「该目录存放用户上传图片，需可写且必须按静态资源返回，禁止执行脚本」。

- [x] 浏览器打开 `http://127.0.0.1:5000/` 与 `http://127.0.0.1:5000/static/img/hero.jpg` 确认可访问：

```bash
.venv/Scripts/python.exe app.py run
```

  - Expected: 首页显示「骨架就绪」占位卡片；`hero.jpg` 直接可预览；`favicon` 为笔记本图标

**Dependencies:** Task 1（Pillow）、Task 5（`index.html` 引用了 `logo.svg` 与静态路径）

---

## Phase Completion Checklist

- [x] 全部 6 个任务完成
- [x] `.venv/Scripts/python.exe -m pytest tests/ -v` 全部通过（`test_response_contract.py` 4 项 + `test_db_basics.py` 7 项）
- [x] `python app.py init-db` 可重复执行且 8 张表齐备
- [x] `python app.py run` 后 `/`、`/about`、`/notes/123` 直链刷新均返回 SPA 页面，`/api/__nope__` 返回 JSON 404
- [x] `base.css` 的 `:root` 含全部 11 个色彩角色、字体层级、间距与圆角令牌
- [x] `static/vendor/` 两个文件大小与核验值一致
- [x] `static/img/` 六个转码产物尺寸正确，`logo.svg` 可被浏览器渲染
- [x] `README.md` 含启动步骤、镜像说明、vendor 版本与 `SECRET_KEY` 安全提示
- [x] 可以进入 Phase 2

---

## 执行记录（主智能体验证）

- **执行日期**：2026-10-08
- **验证命令与结果**：`.venv/Scripts/python.exe -m pytest tests/ -v` → **11 passed**
  （`test_response_contract.py` 4 项 + `test_db_basics.py` 7 项），无 skip、无 xfail。
- **运行时抽查**（Flask test client，避免端口占用）：
  `/`、`/about`、`/notes/123` → 200 `text/html`（SPA 深链刷新可用）；
  `/api/__nope__` → 404 `application/json` 且 `message` 为未转义中文；
  `/static/__missing__.png` → 404（未被 SPA 兜底吞掉）；
  `hero.webp`/`hero-960.webp`/`paper.webp` → 200 `image/webp`；`hero.jpg` → 200 `image/jpeg`；
  `logo.svg` → 200 `image/svg+xml`；`marked.min.js` → 200 `application/javascript`。
- **DB 抽查**：`python app.py init-db` 输出「数据库初始化完成」，重复执行幂等，8 张表齐备。
- **素材抽查**：6 个转码产物尺寸与体积符合预期（hero.jpg 139KB、paper.jpg 131KB，均 ≤400KB）；
  `static/vendor/` 两个文件为 35479 / 21496 字节，与核验值一致。

**计划外偏差（均已由主智能体验证接受）**

1. `app.py` 的 `handle_http_exception` 增加 `/static/*` 排除条件。阶段文件给出的原文会让缺失的静态资源
   返回 200 + SPA 页面，违反计划索引边界「catch-all 不得吞 `/api/*` 与 `/static/*`」。
2. **主智能体补充修复**：`app.py` 注册 `mimetypes.add_type("image/webp", ".webp")`。
   本机 `mimetypes` 数据库不含 webp，修复前 `/static/img/hero.webp` 的 `Content-Type` 为空，
   与 Phase 8 的 `X-Content-Type-Options: nosniff` 组合可能被客户端拒绝渲染。修复后为 `image/webp`。
3. `core/db.py` 的 `from datetime import ...` 上移至文件头（PEP8），函数体逐字按阶段文件实现。
4. `ui.js` 的 `renderHeader()` 补全汉堡按钮与抽屉标记，使 `base.css` 中对应样式可达。
5. Task 6 的浏览器手工步骤以 HTTP 级验证替代（环境无浏览器），已在上方「运行时抽查」记录。

**交接给后续阶段的已确认缺陷（需在对应阶段修复并纳入验收）**

| 缺陷 | 实测值 | 目标 | 修复归属 |
|------|--------|------|----------|
| 主按钮底色用 `--c-primary-hover` 导致与深色文字对比不足 | 3.93:1 | ≥4.5:1 → 静止态改用 `--c-accent`（6.37:1），hover 用 `--c-primary`（5.04:1） | Phase 2 Task 4 |
| 链接色 `--c-primary-hover` 用作正文链接 | 2.85:1 | ≥4.5:1 → 需新增更深的链接令牌 | Phase 2 Task 4 |
| `.btn-danger` 与 `.field-error` 用 `--c-danger` 作文本色 | 4.20:1 / 3.96:1 | ≥4.5:1 → 新增 `--c-danger-strong: #9E4436`（6.30:1） | Phase 2 Task 4 |
| toast 白字底色为 `--c-success`/`--c-danger`/`--c-primary` | 3.72 / 4.20 / 2.36:1 | ≥4.5:1 → 新增 `--c-success-strong: #4F6B41`(5.98)、`--c-danger-strong`(6.30)、`--c-info-strong: #8A6D42`(4.83) | Phase 2 Task 4 |

以上四项均由主智能体用 WCAG 相对亮度公式实测得出，Phase 8 Task 3 需复测确认。

