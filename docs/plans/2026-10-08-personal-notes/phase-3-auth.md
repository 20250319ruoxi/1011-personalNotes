# Phase 3: 用户体系

**Goal:** 完成注册、登录、登出、当前用户、个人资料与改密的后端接口与 CSRF/Origin 防护，前端交付登录页、注册页、会话恢复与登录守卫，并补全顶栏已登录态。

**Prerequisites:** Phase 1、Phase 2 完成。

**Deliverables:**
- `core/validators.py`、`core/security.py`、`core/auth.py` 三个基础模块
- `api/auth.py`、`api/users.py` 两组接口
- 全局 CSRF 与 Origin 校验
- 登录页、注册页、会话恢复（`/auth/me` 引导）、登录守卫与回跳
- 顶栏已登录态 + 头像下拉 + 退出确认
- 5 个测试文件：`test_validators.py`、`test_security.py`、`test_auth_api.py`、`test_users_api.py`、`test_rate_limit.py`、`test_error_copy_sync.py`

**Interface Decisions Implemented:**
- 表单 `AuthForm` 全部状态：默认 / 输入中 / 提交 loading / 字段级错误 / 请求失败 toast
- 顶栏已登录态：`写笔记 / 我的主页 / 头像菜单（个人主页、退出登录）`
- 退出登录使用二次确认弹窗
- 文案基调：第二人称、口语化；前端字段级文案与后端 `core/errors.py` 逐字一致（由测试强制校验）

---

## Task 1: 校验与安全基础模块

**Goal:** 以测试先行方式实现字段校验、密码哈希、分享 token 生成与失败计数限流。

**Files:**
- Create: `core/validators.py`
- Create: `core/security.py`
- Test: `tests/test_validators.py`
- Test: `tests/test_security.py`

**Steps:**

- [x] 创建 `tests/test_validators.py`：

```python
import pytest

from core import validators as v


@pytest.mark.parametrize("email", ["a@b.co", "user.name+tag@sub.example.com"])
def test_valid_email_accepted(email):
    assert v.validate_email(email) == (True, None)


@pytest.mark.parametrize("email", ["", "a@b", "a b@c.com", "a@@b.com", "@b.com"])
def test_invalid_email_rejected(email):
    assert v.validate_email(email) == (False, "EMAIL_INVALID")


@pytest.mark.parametrize("name", ["abc", "中文名", "user_1", "a1234567890123456789"])
def test_valid_username_accepted(name):
    assert v.validate_username(name) == (True, None)


@pytest.mark.parametrize("name", ["ab", "a" * 21, "has space", "has-dash", "has.dot"])
def test_invalid_username_rejected(name):
    assert v.validate_username(name) == (False, "INVALID_PARAM")


@pytest.mark.parametrize("password", ["passw0rd", "a1" * 4, "X" * 63 + "1"])
def test_valid_password_accepted(password):
    assert v.validate_password(password) == (True, None)


@pytest.mark.parametrize("password", ["short1", "a" * 8, "1" * 8, "p" * 65 + "1"])
def test_weak_password_rejected(password):
    assert v.validate_password(password) == (False, "PASSWORD_WEAK")


def test_note_title_and_content_limits():
    assert v.validate_title("x" * 200) == (True, None)
    assert v.validate_title("x" * 201) == (False, "CONTENT_TOO_LONG")
    assert v.validate_content("x" * 100000) == (True, None)
    assert v.validate_content("x" * 100001) == (False, "CONTENT_TOO_LONG")


def test_comment_limit():
    assert v.validate_comment("好") == (True, None)
    assert v.validate_comment("") == (False, "INVALID_PARAM")
    assert v.validate_comment("x" * 1001) == (False, "CONTENT_TOO_LONG")


def test_tags_normalized_deduped_and_limited():
    assert v.validate_tags([" 生活 ", "生活", "work"]) == (True, ["生活", "work"])
    assert v.validate_tags([]) == (True, [])
    assert v.validate_tags(["a", "b", "c", "d", "e", "f"]) == (False, "TAG_TOO_MANY")
    assert v.validate_tags(["x" * 21]) == (False, "CONTENT_TOO_LONG")
    assert v.validate_tags("不是列表") == (False, "INVALID_PARAM")


def test_status_whitelist():
    assert v.validate_status("draft") == (True, None)
    assert v.validate_status("private") == (True, None)
    assert v.validate_status("public") == (True, None)
    assert v.validate_status("weird") == (False, "INVALID_PARAM")


def test_pagination_bounds():
    assert v.parse_pagination({}, default=10, maximum=50) == (1, 10)
    assert v.parse_pagination({"page": "3", "page_size": "20"}, default=10, maximum=50) == (3, 20)
    assert v.parse_pagination({"page": "0", "page_size": "999"}, default=10, maximum=50) == (1, 50)
    assert v.parse_pagination({"page": "abc"}, default=10, maximum=50) == (1, 10)
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_validators.py -v
```

  - Expected: FAIL（`No module named 'core.validators'`）

- [x] 创建 `core/validators.py`：

```python
import re

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
USERNAME_RE = re.compile(r"^\w{3,20}$")
STATUSES = ("draft", "private", "public")
MAX_TAG_LENGTH = 20


def validate_email(email):
    if not isinstance(email, str) or not EMAIL_RE.match(email.strip()):
        return False, "EMAIL_INVALID"
    return True, None


def validate_username(username):
    if not isinstance(username, str) or not USERNAME_RE.match(username.strip()):
        return False, "INVALID_PARAM"
    return True, None


def validate_password(password):
    if not isinstance(password, str) or not 8 <= len(password) <= 64:
        return False, "PASSWORD_WEAK"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return False, "PASSWORD_WEAK"
    return True, None


def validate_title(title):
    if not isinstance(title, str):
        return False, "INVALID_PARAM"
    if len(title) > 200:
        return False, "CONTENT_TOO_LONG"
    return True, None


def validate_content(content):
    if not isinstance(content, str):
        return False, "INVALID_PARAM"
    if len(content) > 100000:
        return False, "CONTENT_TOO_LONG"
    return True, None


def validate_comment(content):
    if not isinstance(content, str) or not content.strip():
        return False, "INVALID_PARAM"
    if len(content) > 1000:
        return False, "CONTENT_TOO_LONG"
    return True, None


def validate_status(status):
    if status not in STATUSES:
        return False, "INVALID_PARAM"
    return True, None


def validate_tags(tags):
    if tags is None:
        return True, []
    if not isinstance(tags, list):
        return False, "INVALID_PARAM"
    cleaned = []
    for raw in tags:
        if not isinstance(raw, str):
            return False, "INVALID_PARAM"
        name = raw.strip()
        if not name:
            continue
        if len(name) > MAX_TAG_LENGTH:
            return False, "CONTENT_TOO_LONG"
        if name not in cleaned:
            cleaned.append(name)
    if len(cleaned) > 5:
        return False, "TAG_TOO_MANY"
    return True, cleaned


def parse_pagination(args, default=10, maximum=50):
    def _int(value, fallback):
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback

    page = max(1, _int(args.get("page"), 1))
    page_size = _int(args.get("page_size"), default)
    page_size = min(max(page_size, 1), maximum)
    return page, page_size
```

- [x] 创建 `tests/test_security.py`：

```python
from datetime import datetime, timedelta, timezone

from core import security
from core.db import get_db, now_iso


def test_password_hash_roundtrip():
    digest = security.hash_password("passw0rd")
    assert digest != "passw0rd"
    assert digest.startswith("pbkdf2:sha256")
    assert security.verify_password(digest, "passw0rd") is True
    assert security.verify_password(digest, "wrong") is False


def test_share_token_is_url_safe_and_unique():
    tokens = {security.generate_share_token() for _ in range(50)}
    assert len(tokens) == 50
    assert all(len(t) >= 30 and " " not in t for t in tokens)


def test_rate_limit_counts_within_window(app):
    with app.app_context():
        conn = get_db()
        for _ in range(4):
            security.record_failure(conn, "login", "a@b.com")
        assert security.is_rate_limited(conn, "login", "a@b.com", 5, 900) is False
        security.record_failure(conn, "login", "a@b.com")
        assert security.is_rate_limited(conn, "login", "a@b.com", 5, 900) is True


def test_rate_limit_ignores_old_failures(app):
    with app.app_context():
        conn = get_db()
        for _ in range(5):
            security.record_failure(conn, "login", "a@b.com")
        old = (datetime.now(timezone.utc) - timedelta(seconds=1000)).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute("UPDATE auth_attempts SET created_at = ? WHERE key = 'a@b.com'", (old,))
        conn.commit()
        assert security.is_rate_limited(conn, "login", "a@b.com", 5, 900) is False


def test_clear_failures(app):
    with app.app_context():
        conn = get_db()
        security.record_failure(conn, "login", "a@b.com")
        security.clear_failures(conn, "login", "a@b.com")
        assert security.is_rate_limited(conn, "login", "a@b.com", 1, 900) is False
```

- [x] 确认 `core/db.py` 已含本任务需要的 `now_iso`、`get_user_by_id`、`get_user_by_email`、`get_user_by_username`（Phase 1 Task 4 已交付），本任务无需改动 `core/db.py`。若缺失，先补齐后再继续。

- [x] 创建 `core/security.py`：

```python
import secrets
from datetime import datetime, timedelta, timezone

from werkzeug.security import check_password_hash, generate_password_hash


def hash_password(password):
    return generate_password_hash(password, method="pbkdf2:sha256")


def verify_password(password_hash, password):
    return check_password_hash(password_hash, password)


def generate_share_token():
    return secrets.token_urlsafe(24)


def generate_csrf_token():
    return secrets.token_urlsafe(32)


def record_failure(conn, scope, key):
    conn.execute(
        "INSERT INTO auth_attempts (scope, key, created_at) VALUES (?, ?, ?)",
        (scope, key, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
    )
    conn.commit()


def _window_start(window_seconds):
    return (datetime.now(timezone.utc)
            - timedelta(seconds=window_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_rate_limited(conn, scope, key, max_failures, window_seconds):
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM auth_attempts "
        "WHERE scope = ? AND key = ? AND created_at >= ?",
        (scope, key, _window_start(window_seconds)),
    ).fetchone()
    return row["n"] >= max_failures


def clear_failures(conn, scope, key):
    conn.execute("DELETE FROM auth_attempts WHERE scope = ? AND key = ?", (scope, key))
    conn.commit()
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_validators.py tests/test_security.py -v
```

  - Expected: 全部 passed（`test_validators.py` 约 30 项参数化用例、`test_security.py` 5 项）

**Security/Boundary Notes:**
- 用户名规则 3–20 位、`\w`（含中文、字母、数字、下划线）为本计划的默认值，已记录在计划索引的 Deferred Decisions。
- 限流只在时间窗内计数，窗口外旧记录不参与判定（已由测试覆盖）。
- `hash_password` 使用 `pbkdf2:sha256`，禁止在任何响应或日志中出现 `password_hash`。

**Dependencies:** Phase 1 Task 4（`core/db.py`）

---

## Task 2: 注册、登录、登出与当前用户接口

**Goal:** 交付四个认证接口，包含会话建立、唯一性校验与登录限流。

**Files:**
- Create: `api/auth.py`
- Create: `core/auth.py`（本任务先实现会话与用户序列化部分）
- Modify: `app.py`（`register_blueprints` 已按名导入，无需改动）
- Modify: `tests/conftest.py`（追加两个夹具）
- Test: `tests/test_auth_api.py`

**Steps:**

- [x] 在 `tests/conftest.py` 追加：

```python
@pytest.fixture()
def alice(client):
    """返回 (client, csrf_headers)，已注册并登录 alice。"""
    resp = client.post("/api/auth/register", json={
        "email": "alice@example.com", "username": "alice",
        "password": "passw0rd", "confirm_password": "passw0rd",
    })
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return client, {"X-CSRF-Token": resp.get_json()["data"]["csrf_token"]}


@pytest.fixture()
def bob_raw(client):
    """在独立客户端中注册 bob，用于越权测试。"""
    other = client.application.test_client()
    resp = other.post("/api/auth/register", json={
        "email": "bob@example.com", "username": "bob",
        "password": "passw0rd", "confirm_password": "passw0rd",
    })
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return other, {"X-CSRF-Token": resp.get_json()["data"]["csrf_token"]}
```

- [x] 创建 `tests/test_auth_api.py`：

```python
def test_register_returns_user_and_csrf_without_password_hash(client):
    resp = client.post("/api/auth/register", json={
        "email": "New@Example.com", "username": "newbie",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    body = resp.get_json()
    assert resp.status_code == 200 and body["code"] == "OK"
    assert body["data"]["user"]["email"] == "new@example.com"
    assert body["data"]["csrf_token"]
    assert "password_hash" not in body["data"]["user"]


def test_register_rejects_duplicate_email(client, alice):
    resp = client.post("/api/auth/register", json={
        "email": "alice@example.com", "username": "alice2",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "EMAIL_EXISTS"


def test_register_rejects_duplicate_username(client, alice):
    resp = client.post("/api/auth/register", json={
        "email": "other@example.com", "username": "alice",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "USERNAME_EXISTS"


def test_register_rejects_weak_password_and_mismatch(client):
    weak = client.post("/api/auth/register", json={
        "email": "x@example.com", "username": "xxxx",
        "password": "abcdefgh", "confirm_password": "abcdefgh"})
    assert weak.get_json()["code"] == "PASSWORD_WEAK"

    mismatch = client.post("/api/auth/register", json={
        "email": "x@example.com", "username": "xxxx",
        "password": "passw0rd", "confirm_password": "passw0rd2"})
    assert mismatch.get_json()["code"] == "PASSWORD_MISMATCH"


def test_login_is_case_insensitive_and_returns_csrf(client, alice):
    client.post("/api/auth/logout", headers={"X-CSRF-Token": "x"})
    client.post("/api/auth/register", json={
        "email": "case@example.com", "username": "caser",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    fresh = client.application.test_client()
    resp = fresh.post("/api/auth/login", json={"email": "CASE@example.com", "password": "passw0rd"})
    assert resp.status_code == 200
    assert resp.get_json()["data"]["user"]["username"] == "caser"
    assert resp.get_json()["data"]["csrf_token"]


def test_login_wrong_password(client, alice):
    fresh = client.application.test_client()
    resp = fresh.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrongpass1"})
    assert resp.status_code == 401
    assert resp.get_json()["code"] == "INVALID_CREDENTIALS"


def test_me_returns_null_when_anonymous(client):
    body = client.get("/api/auth/me").get_json()
    assert body["code"] == "OK"
    assert body["data"]["user"] is None


def test_me_returns_current_user(client, alice):
    body = client.get("/api/auth/me").get_json()
    assert body["data"]["user"]["username"] == "alice"
    assert body["data"]["csrf_token"]


def test_logout_clears_session(client, alice):
    c, headers = alice
    assert c.post("/api/auth/logout", headers=headers).get_json()["code"] == "OK"
    assert c.get("/api/auth/me").get_json()["data"]["user"] is None
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_auth_api.py -v
```

  - Expected: FAIL（无 `api.auth` 模块）

- [x] 创建 `core/auth.py`：

```python
import secrets
from functools import wraps

from flask import g, session

from core import db as db_module
from core.response import fail
from core.security import generate_csrf_token


def serialize_user(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "avatar": row["avatar"],
        "bio": row["bio"],
        "created_at": row["created_at"],
    }


def ensure_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = generate_csrf_token()
        session["csrf_token"] = token
    return token


def start_session(user):
    session.clear()
    session["user_id"] = user["id"]
    session.permanent = False


def current_user():
    if "current_user" in g:
        return g.current_user
    user_id = session.get("user_id")
    g.current_user = db_module.get_user_by_id(db_module.get_db(), user_id) if user_id else None
    return g.current_user


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return fail("UNAUTHORIZED")
        return view(*args, **kwargs)
    return wrapper
```

- [x] 创建 `api/auth.py`：

```python
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, ensure_csrf_token, serialize_user, start_session
from core.response import fail, ok
from core.security import (clear_failures, hash_password, is_rate_limited,
                           record_failure, verify_password)
from core.validators import validate_email, validate_password, validate_username

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.post("/register")
def register():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    confirm = payload.get("confirm_password") or ""

    for validator, value in ((validate_email, email),
                             (validate_username, username),
                             (validate_password, password)):
        passed, code = validator(value)
        if not passed:
            return fail(code)
    if password != confirm:
        return fail("PASSWORD_MISMATCH")

    conn = db_module.get_db()
    if db_module.get_user_by_email(conn, email):
        return fail("EMAIL_EXISTS")
    if db_module.get_user_by_username(conn, username):
        return fail("USERNAME_EXISTS")

    cursor = conn.execute(
        "INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (email, username, hash_password(password), db_module.now_iso()),
    )
    conn.commit()
    user = db_module.get_user_by_id(conn, cursor.lastrowid)
    start_session(user)
    return ok({"user": serialize_user(user), "csrf_token": ensure_csrf_token()}, "注册成功")


@bp.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    if not email or not password:
        return fail("INVALID_PARAM")

    conn = db_module.get_db()
    if is_rate_limited(conn, "login", email,
                       current_app_config("LOGIN_MAX_FAILURES"),
                       current_app_config("LOGIN_FAILURE_WINDOW_SECONDS")):
        return fail("RATE_LIMITED")

    user = db_module.get_user_by_email(conn, email)
    if user is None or not verify_password(user["password_hash"], password):
        record_failure(conn, "login", email)
        return fail("INVALID_CREDENTIALS")

    clear_failures(conn, "login", email)
    start_session(user)
    return ok({"user": serialize_user(user), "csrf_token": ensure_csrf_token()}, "登录成功")


@bp.post("/logout")
def logout():
    from flask import session
    session.clear()
    return ok(None, "已退出登录")


@bp.get("/me")
def me():
    user = current_user()
    if user is None:
        return ok({"user": None, "csrf_token": None})
    return ok({"user": serialize_user(user), "csrf_token": ensure_csrf_token()})
```

  同文件的导入区补一行 `from core.db import current_app_config`（该助手已在 Phase 1 Task 3 加入 `core/db.py`，避免各蓝图重复书写 `current_app.config[...]`）。

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_auth_api.py -v
```

  - Expected: 9 个用例全部 passed

**Security/Boundary Notes:**
- 注册时邮箱统一转小写存储，保证 `UNIQUE` 约束真正生效并让登录大小写不敏感。
- `start_session()` 先 `session.clear()` 再写 `user_id`，防止会话固定攻击。
- 响应中永不出现 `password_hash`（已由测试断言）。
- `register` 与 `login` 不要求 CSRF（无会话），由 Phase 3 Task 3 的 Origin 校验与登录限流共同防护。

**Dependencies:** Task 1

---

## Task 3: CSRF 与 Origin 校验

**Goal:** 对已登录会话的写操作强制 CSRF Token；对无会话的三个接口（注册、登录、分享密码校验）改用同源校验。

**Files:**
- Modify: `core/auth.py`（追加 `init_app`、`_same_origin`、`_is_exempt`）
- Modify: `app.py`（在 `db_module.init_app(app)` 之后调用 `core.auth.init_app(app)`）
- Test: `tests/test_auth_api.py`（追加 3 项）
- Test: `tests/test_rate_limit.py`

**Steps:**

- [x] 在 `tests/test_auth_api.py` 追加：

```python
def test_write_without_csrf_header_is_rejected(client, alice):
    c, _ = alice
    resp = c.post("/api/auth/logout")
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "CSRF_INVALID"


def test_write_with_wrong_csrf_header_is_rejected(client, alice):
    c, _ = alice
    resp = c.post("/api/auth/logout", headers={"X-CSRF-Token": "forged"})
    assert resp.get_json()["code"] == "CSRF_INVALID"


def test_cross_site_origin_on_login_is_rejected(client):
    resp = client.post("/api/auth/login",
                       json={"email": "a@b.com", "password": "passw0rd"},
                       headers={"Origin": "https://evil.example"})
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "CSRF_INVALID"
```

- [x] 创建 `tests/test_rate_limit.py`：

```python
def test_login_locks_after_five_failures(app, client):
    client.post("/api/auth/register", json={
        "email": "lock@example.com", "username": "locker",
        "password": "passw0rd", "confirm_password": "passw0rd"})

    fresh = client.application.test_client()
    for _ in range(5):
        resp = fresh.post("/api/auth/login",
                          json={"email": "lock@example.com", "password": "wrongpass1"})
        assert resp.get_json()["code"] == "INVALID_CREDENTIALS"

    limited = fresh.post("/api/auth/login",
                         json={"email": "lock@example.com", "password": "passw0rd"})
    assert limited.status_code == 429
    assert limited.get_json()["code"] == "RATE_LIMITED"


def test_successful_login_clears_failure_counter(client):
    client.post("/api/auth/register", json={
        "email": "clear@example.com", "username": "clearer",
        "password": "passw0rd", "confirm_password": "passw0rd"})

    fresh = client.application.test_client()
    for _ in range(3):
        fresh.post("/api/auth/login", json={"email": "clear@example.com", "password": "wrongpass1"})

    assert fresh.post("/api/auth/login",
                      json={"email": "clear@example.com", "password": "passw0rd"}
                      ).get_json()["code"] == "OK"
    for _ in range(4):
        fresh.post("/api/auth/login", json={"email": "clear@example.com", "password": "wrongpass1"})
    assert fresh.post("/api/auth/login",
                      json={"email": "clear@example.com", "password": "passw0rd"}
                      ).get_json()["code"] == "OK"
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_auth_api.py tests/test_rate_limit.py -v
```

  - Expected: `test_write_without_csrf_header_is_rejected` 等 3 项 FAIL（CSRF 尚未实现），`test_rate_limit.py` 2 项 passed

- [x] 在 `core/auth.py` 追加：

```python
import re
from flask import request

CSRF_EXEMPT = (("/api/auth/register", "POST"), ("/api/auth/login", "POST"))
SHARE_VERIFY_RE = re.compile(r"^/api/share/[^/]+/verify$")


def _is_csrf_exempt(path, method):
    if SHARE_VERIFY_RE.match(path):
        return True
    return (path, method) in CSRF_EXEMPT


def _same_origin():
    origin = request.headers.get("Origin") or request.headers.get("Referer")
    if not origin:
        return True          # 非浏览器客户端（如测试与 curl）不带 Origin，放行并由限流兜底
    if "://" not in origin:
        return False
    return origin.split("/")[2] == request.host


def init_app(app):
    @app.before_request
    def _csrf_protect():
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None
        if not request.path.startswith("/api/"):
            return None
        if _is_csrf_exempt(request.path, request.method):
            return None if _same_origin() else fail("CSRF_INVALID")
        token = session.get("csrf_token")
        if token is None:
            # 尚未建立任何会话（未注册/未登录）：不存在可被利用的会话凭证，
            # 交由 login_required 返回统一的 UNAUTHORIZED，避免用状态码差异
            # 暴露「哪些接口带 CSRF 保护」。
            return None
        if request.headers.get("X-CSRF-Token") != token:
            return fail("CSRF_INVALID")
        return None
```

- [x] 在 `app.py` 的 `create_app` 中，`db_module.init_app(app)` 之后加入：

```python
    from core import auth as auth_module
    auth_module.init_app(app)
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 全部 passed

**Security/Boundary Notes:**
- 校验顺序固定：先 CSRF（或豁免接口的同源校验）再业务鉴权，避免接口先做写入再被拦。
- 同源判定在缺少 `Origin` 与 `Referer` 时放行是非浏览器客户端的必要妥协；由于浏览器对跨站 POST 一定会带 `Origin`，该分支不构成 CSRF 绕过路径，且三个豁免接口都有限流兜底。
- `GET/HEAD/OPTIONS` 不做 CSRF 校验，因此所有读接口必须保证无副作用（Phase 4 的列表接口不得写足迹）。

**Dependencies:** Task 2

---

## Task 4: 个人资料与改密接口

**Goal:** 交付个人资料读写与修改密码接口。

**Files:**
- Create: `api/users.py`
- Modify: `core/db.py`（追加 `update_user_profile`、`update_user_password`）
- Test: `tests/test_users_api.py`

**Steps:**

- [x] 创建 `tests/test_users_api.py`：

```python
def test_get_own_profile(alice):
    c, headers = alice
    body = c.get("/api/users/me/profile").get_json()
    assert body["code"] == "OK"
    assert body["data"]["user"]["username"] == "alice"


def test_get_profile_requires_login(client):
    resp = client.get("/api/users/me/profile")
    assert resp.status_code == 401
    assert resp.get_json()["code"] == "UNAUTHORIZED"


def test_update_profile_bio_and_username(alice):
    c, headers = alice
    resp = c.put("/api/users/me/profile",
                 json={"username": "alice2", "bio": "写点东西"}, headers=headers)
    assert resp.get_json()["code"] == "OK"
    assert resp.get_json()["data"]["user"]["bio"] == "写点东西"
    assert c.get("/api/auth/me").get_json()["data"]["user"]["username"] == "alice2"


def test_update_profile_rejects_taken_username(alice, bob_raw):
    c, headers = alice
    resp = c.put("/api/users/me/profile", json={"username": "bob"}, headers=headers)
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "USERNAME_EXISTS"


def test_update_profile_rejects_invalid_username(alice):
    c, headers = alice
    assert c.put("/api/users/me/profile", json={"username": "a"},
                 headers=headers).get_json()["code"] == "INVALID_PARAM"


def test_change_password_happy_path(alice):
    c, headers = alice
    resp = c.put("/api/users/me/password", json={
        "old_password": "passw0rd", "new_password": "newpass1",
        "confirm_password": "newpass1"}, headers=headers)
    assert resp.get_json()["code"] == "OK"
    fresh = c.application.test_client()
    assert fresh.post("/api/auth/login",
                      json={"email": "alice@example.com", "password": "newpass1"}
                      ).get_json()["code"] == "OK"


def test_change_password_rejects_wrong_old(alice):
    c, headers = alice
    resp = c.put("/api/users/me/password", json={
        "old_password": "nope1234", "new_password": "newpass1",
        "confirm_password": "newpass1"}, headers=headers)
    assert resp.get_json()["code"] == "PASSWORD_WRONG"


def test_change_password_rejects_mismatch_and_weak(alice):
    c, headers = alice
    assert c.put("/api/users/me/password", json={
        "old_password": "passw0rd", "new_password": "newpass1",
        "confirm_password": "newpass2"}, headers=headers).get_json()["code"] == "PASSWORD_MISMATCH"
    assert c.put("/api/users/me/password", json={
        "old_password": "passw0rd", "new_password": "abcdefgh",
        "confirm_password": "abcdefgh"}, headers=headers).get_json()["code"] == "PASSWORD_WEAK"
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_users_api.py -v
```

  - Expected: FAIL（无 `api.users` 模块）

- [x] 在 `core/db.py` 追加：

```python
def update_user_profile(conn, user_id, username=None, bio=None, avatar=None):
    fields, values = [], []
    if username is not None:
        fields.append("username = ?"); values.append(username)
    if bio is not None:
        fields.append("bio = ?"); values.append(bio)
    if avatar is not None:
        fields.append("avatar = ?"); values.append(avatar)
    if not fields:
        return
    values.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()


def update_user_password(conn, user_id, password_hash):
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    conn.commit()
```

  - 注：`fields` 片段是代码内写死的字符串常量，不含用户输入；所有值仍走 `?` 占位符，不存在注入面。

- [x] 创建 `api/users.py`：

```python
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, login_required, serialize_user
from core.response import fail, ok
from core.security import hash_password, verify_password
from core.validators import validate_password, validate_username

bp = Blueprint("users", __name__, url_prefix="/api/users")

MAX_BIO_LENGTH = 200
MAX_AVATAR_LENGTH = 300


@bp.get("/me/profile")
@login_required
def get_profile():
    return ok({"user": serialize_user(current_user())})


@bp.put("/me/profile")
@login_required
def update_profile():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    conn = db_module.get_db()

    username = payload.get("username")
    if username is not None:
        username = username.strip()
        passed, code = validate_username(username)
        if not passed:
            return fail(code)
        existing = db_module.get_user_by_username(conn, username)
        if existing and existing["id"] != user["id"]:
            return fail("USERNAME_EXISTS")

    bio = payload.get("bio")
    if bio is not None:
        if not isinstance(bio, str) or len(bio) > MAX_BIO_LENGTH:
            return fail("CONTENT_TOO_LONG")

    avatar = payload.get("avatar")
    if avatar is not None:
        if not isinstance(avatar, str) or len(avatar) > MAX_AVATAR_LENGTH:
            return fail("INVALID_PARAM")
        if avatar and not avatar.startswith(db_module.current_app_config("UPLOAD_URL_PREFIX")):
            return fail("INVALID_PARAM")

    db_module.update_user_profile(conn, user["id"], username, bio, avatar)
    return ok({"user": serialize_user(db_module.get_user_by_id(conn, user["id"]))}, "已保存")


@bp.put("/me/password")
@login_required
def change_password():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    old = payload.get("old_password") or ""
    new = payload.get("new_password") or ""
    confirm = payload.get("confirm_password") or ""

    if not verify_password(user["password_hash"], old):
        return fail("PASSWORD_WRONG")
    passed, code = validate_password(new)
    if not passed:
        return fail(code)
    if new != confirm:
        return fail("PASSWORD_MISMATCH")

    conn = db_module.get_db()
    db_module.update_user_password(conn, user["id"], hash_password(new))
    return ok(None, "密码已修改")
```

- [x] `api/users.py` 的导入区使用 `from core.db import current_app_config`（Phase 1 Task 3 已定义），不在本文件内重复实现。

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_users_api.py -v
```

  - Expected: 8 个用例全部 passed

**Security/Boundary Notes:**
- `avatar` 只接受以 `UPLOAD_URL_PREFIX`（`/static/uploads/`）开头的相对路径，拒绝外部 URL，避免被用作开放重定向或外链追踪载体。
- 改密后不在服务端强制下线：会话仍有效，但下次登录必须用新密码；这是本阶段的有意取舍，已在 Deferred Decisions 记录（如需强制重登，可在 Phase 8 追加 `session.clear()`）。
- `PUT /users/me/profile` 的 `username` 与 `bio` 都会 strip 后入库，空字符串视为清空。

**Dependencies:** Task 2、Task 3

---

## Task 5: 前端登录页、注册页与会话恢复

**Goal:** 交付登录/注册页面、字段级校验、会话恢复引导、登录守卫与顶栏已登录态。

**Files:**
- Create: `static/js/auth.js`
- Create: `static/css/auth.css`
- Modify: `static/js/api.js`（组装 `FIELD_MESSAGES` 用不到，仅确认 CSRF 注入路径已就绪）
- Modify: `static/js/router.js`（注册 `/login`、`/register`，启动时先做会话恢复）
- Modify: `static/js/ui.js`（`renderHeader` 补已登录态与头像菜单）
- Modify: `static/css/base.css`（顶栏已登录态与头像菜单样式）
- Test: `tests/test_error_copy_sync.py`

**Steps:**

- [x] 创建 `static/js/auth.js`，顶部以**合法 JSON 对象字面量**声明字段级文案（键为后端错误码，值必须与 `core/errors.py` 逐字一致）：

```js
import { api } from './api.js';
import { store } from './store.js';
import { navigate } from './router.js';
import { toast } from './ui.js';

export const FIELD_MESSAGES = {
  "EMAIL_INVALID": "请输入正确的邮箱地址",
  "PASSWORD_WEAK": "密码长度需为 8-64 位，且包含字母与数字",
  "PASSWORD_MISMATCH": "两次输入的密码不一致",
  "INVALID_PARAM": "参数不合法，请检查后重试"
};
```

- [x] 同文件实现 `renderLogin(root, params)` 与 `renderRegister(root)`：

  - 卡片结构：`.auth-page > .auth-card`，内含 `<h1>`（「登录」/「注册」）、`<form>`、底部互跳链接（登录页「还没有账号？去注册」→ `/register`；注册页「已有账号？去登录」→ `/login`）。
  - 字段：登录为 `邮箱` + `密码`；注册为 `邮箱` + `用户名` + `密码` + `确认密码`。每个字段为 `<label>` + `<input>` + `<p class="field-error" role="alert">`。
  - 输入类型：邮箱 `type="email"` `autocomplete="email"`；密码 `type="password"` `autocomplete="current-password"` / `new-password`；用户名 `autocomplete="username"`。
  - 失焦校验（`blur` 时执行）：
    - 邮箱：`/^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/`，失败显示 `FIELD_MESSAGES.EMAIL_INVALID`
    - 用户名：`/^\w{3,20}$/`，失败显示 `FIELD_MESSAGES.INVALID_PARAM`
    - 密码：长度 8–64 且含字母与数字，失败显示 `FIELD_MESSAGES.PASSWORD_WEAK`
    - 确认密码：与密码不一致时显示 `FIELD_MESSAGES.PASSWORD_MISMATCH`
    - 校验失败时给输入框加 `.is-invalid`（红色下划线），通过后移除并清空该字段的 `field-error` 文本
  - 提交：任一字段本地校验未通过则不发起请求；全部通过后按钮进入 loading（`disabled` + 转圈，文案改为「提交中…」）。
  - 请求：`api.post('/api/auth/register', {...})` 或 `api.post('/api/auth/login', {...})`。成功后 `store.setUser(data.user, data.csrf_token)`，然后跳转。
  - 跳转目标：读取 `params.redirect` 或 `new URLSearchParams(location.search).get('redirect')`；**只接受以单个 `/` 开头且不以 `//` 开头的相对路径**，否则回退到 `/me`（防开放重定向）。
  - 请求失败：`api.js` 已弹出后端 `message`；若失败码存在于 `FIELD_MESSAGES`，则把该文案同时挂到对应字段上（邮箱类错误挂邮箱字段，密码类挂密码字段）。

- [x] 创建 `static/css/auth.css`：

  - `.auth-page`：`min-height: calc(100vh - var(--header-h)); display:grid; place-items:center; padding: var(--sp-8) var(--gutter); background: var(--c-page);`
  - `.auth-card`：`width: min(420px, 100%); background: var(--c-surface); border-radius: var(--r-2); box-shadow: var(--sd-card); border: var(--bd); padding: var(--sp-8);`
  - `.auth-card h1`：`var(--fs-h2)`、居中、下边距 `var(--sp-6)`
  - `.field`：上边距 `var(--sp-4)`；`label` 用 `var(--fs-sm)` + `var(--c-text-muted-strong)`；`input` 高 44px、圆角 `var(--r-1)`、1px `var(--c-border)`、聚焦时描边 `var(--c-primary-hover)`
  - `.field input.is-invalid`：`border-color: var(--c-danger);`
  - `.field-error`：`var(--fs-xs)` + `var(--c-danger)`，默认为空不占高度变化（`min-height: 1em`）
  - `.auth-card .btn-primary`：`width: 100%; height: 44px;`

- [x] 在 `router.js` 中：

  - 追加启动引导

```js
async function bootstrap() {
  try {
    const data = await api.get('/api/auth/me', { silent: true });
    store.setUser(data.user, data.csrf_token);
  } catch (_) {
    store.setUser(null, null);
  }
}
```

  - `render()` 改为 `await bootstrap()`（仅在首次）后再匹配路由；`store.onChange(renderHeaderOnly)` 用于登录态变化时只重绘顶栏。
  - 注册两个路由：

```js
registerRoute('/login',    async (root) => (await import('./auth.js')).renderLogin(root));
registerRoute('/register', async (root) => (await import('./auth.js')).renderRegister(root));
```

- [x] 在 `ui.js` 的 `renderHeader` 中补已登录态：

  - 导航链接改为：`写笔记` → `/notes/new`、`我的主页` → `/me`、`关于` → `/about`。
  - 头像按钮：`.avatar-btn`，内容为用户名首字（`username.trim()[0]`），背景用 `var(--c-accent)`、文字 `var(--c-text)`、圆形 36×36；`aria-haspopup="menu"` `aria-expanded`。
  - 下拉菜单 `.avatar-menu`：两项 `个人主页`（→ `/me`）与 `退出登录`（触发确认弹窗）。
  - 退出登录：`confirmDialog({ title: '退出登录', message: '确定要退出当前账号吗？', confirmText: '退出登录' })`，确认后 `api.post('/api/auth/logout')` → `store.setUser(null, null)` → `toast('已退出登录', 'success')` → `navigate('/')`。
  - `≤768px` 时头像菜单并入抽屉。

- [x] 创建 `tests/test_error_copy_sync.py`（防止前端字段文案与后端漂移）：

```python
import json
import re
from pathlib import Path

from core.errors import ERRORS

AUTH_JS = Path(__file__).resolve().parents[1] / "static" / "js" / "auth.js"


def test_frontend_field_messages_match_backend():
    source = AUTH_JS.read_text(encoding="utf-8")
    match = re.search(r"export const FIELD_MESSAGES = (\{.*?\});", source, re.S)
    assert match, "static/js/auth.js 中未找到 FIELD_MESSAGES 常量"
    frontend = json.loads(match.group(1))
    for code, message in frontend.items():
        assert code in ERRORS, f"前端引用了后端不存在的错误码：{code}"
        assert ERRORS[code][1] == message, f"{code} 的文案前后端不一致"
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 全部 passed（含新增的文案同步用例）

- [x] 手工验证（`python app.py run`）：

  - 访问 `/register` 注册新账号 → 自动登录 → 落到 `/me`（Phase 7 前 `/me` 为占位页，属正常）
  - 首页点「开始记录」→ 跳 `/login?redirect=%2Fnotes%2Fnew` → 登录后落到 `/notes/new`
  - 手动把地址栏改成 `/login?redirect=//evil.example` 登录 → 应落到 `/me` 而非站外
  - 顶栏显示「写笔记 / 我的主页 / 头像」，点头像出现下拉，选「退出登录」弹确认，确认后回首页且顶栏变回未登录态
  - 邮箱框输入 `abc` 后失焦 → 出现红色下划线与「请输入正确的邮箱地址」

**Security/Boundary Notes:**
- `redirect` 参数必须做「单斜杠开头」白名单校验，这是防开放重定向的关键点，已写成明确的判断条件而非「过滤危险字符」。
- 前端密码不做任何本地持久化；`store` 中的 `csrfToken` 只存内存。
- 字段级文案与后端一致性由 `tests/test_error_copy_sync.py` 强制，修改任一侧都会让测试失败。

**Dependencies:** Task 2、Task 3、Task 4

---

## Task 6: 用户体系流程与视觉验收

**Goal:** 在浏览器中走通全部用户体系路径，并把结果追加到验收清单。

**Files:**
- Modify: `tests/manual/visual-checklist.md`

**Steps:**

- [x] 在 `tests/manual/visual-checklist.md` 追加「Phase 3 · 用户体系」表格，逐项填写：

| # | 路由 | 视口 | 状态 | 检查点 | 结果 |
|---|------|------|------|--------|------|
| 1 | `/login` | 1440×900 | 默认 | 卡片居中、宽 420px、两字段与提交按钮 | |
| 2 | `/register` | 1440×900 | 默认 | 四字段、底部「已有账号？去登录」 | |
| 3 | `/register` | 375×812 | 默认 | 卡片宽度不超过视口，输入框高 44px | |
| 4 | `/login` | 1440×900 | 字段错误 | 邮箱 `abc` 失焦后红色下划线 + 「请输入正确的邮箱地址」 | |
| 5 | `/register` | 1440×900 | 字段错误 | 密码 `abcdefgh` 失焦后显示密码强度文案 | |
| 6 | `/login` | 1440×900 | 提交中 | 按钮禁用并显示「提交中…」 | |
| 7 | `/login` | 1440×900 | 请求失败 | 错误密码提交后右上角 toast 显示「邮箱或密码错误」 | |
| 8 | 全局 | 1440×900 | 已登录 | 顶栏为「写笔记 / 我的主页 / 头像」，头像为首字色块 | |
| 9 | 全局 | 375×812 | 已登录 | 抽屉内含三项导航与退出登录 | |
| 10 | 任意页 | 1440×900 | 退出确认 | 弹窗标题「退出登录」，`Esc` 可关且焦点回弹 | |

- [x] 按清单逐项截图核对并填写「结果」列；修复问题后重新截图。

- [x] 额外做三项安全走查并记录结论：
  1. 未登录直接访问 `/notes`、`/me` → 跳到 `/login?redirect=...`，登录后回到原路径
  2. `redirect` 传 `//evil.example`、`https://evil.example`、`/notes` 三种值时的实际落点
  3. DevTools 关闭 Cookie 后访问 `/api/users/me/profile` → 返回 `UNAUTHORIZED` 且前端跳登录

**Visual Verification:** 本任务产出即 Phase 3 验收记录。

**Dependencies:** Task 5

---

## Phase Completion Checklist

- [x] 全部 6 个任务完成
- [x] `.venv/Scripts/python.exe -m pytest tests/ -v` 全部通过（新增 `test_validators.py`、`test_security.py`、`test_auth_api.py`、`test_users_api.py`、`test_rate_limit.py`、`test_error_copy_sync.py`）
- [ ] 注册、登录、登出、`/auth/me`、资料读写、改密六条链路在浏览器中走通
      —— **未勾选**：本环境无浏览器。六条链路已在接口层由 Flask test client 全部断言通过，
      前端交互由 Node 最小 DOM 双端真实执行 `renderLogin`/`renderRegister`/`renderHeader` 验证；
      真实浏览器点击走查已在 `tests/manual/visual-checklist.md` 标注为「待人工确认」。
- [x] 无 CSRF 头的写请求返回 `CSRF_INVALID`；跨站 `Origin` 的登录请求返回 `CSRF_INVALID`
- [x] 登录连续失败 5 次后第 6 次返回 `RATE_LIMITED`
- [x] `redirect` 参数白名单生效，`//evil.example` 与绝对 URL 均被拒绝
- [x] `tests/manual/visual-checklist.md` 中 Phase 3 的 10 行 + 3 项安全走查已填写结论
- [x] 可以进入 Phase 4

---

## 执行记录（主智能体验证）

- **执行日期**：2026-10-08
- **验证命令与结果**：`.venv/Scripts/python.exe -m pytest tests/ -q` → **146 passed**
  （Phase 2 的 62 项 + 本阶段新增 84 项）。
- **对比度工具**：`tests/manual/check_contrast.py` → exit 0，全部达标。
- **鉴权与安全行为独立复验**（Flask test client，临时库）：

  | 场景 | 实测结果 |
  |------|----------|
  | 匿名 `POST /api/auth/logout` | 401 `UNAUTHORIZED`（**已修正，见下**） |
  | 已登录 `POST /api/auth/logout`（带正确 CSRF 头） | 200 `OK` |
  | 登出后再 `POST /api/auth/logout` | 401 `UNAUTHORIZED` |
  | 已登录但缺 `X-CSRF-Token` 的写请求 | 403 `CSRF_INVALID` |
  | 跨站 `Origin` 的 login | 403 `CSRF_INVALID` |
  | 同源 `Origin` 的 login | 200 `OK` |
  | 连续 5 次密码错误后第 6 次 | 429 `RATE_LIMITED` |
  | 注册响应 | 邮箱归一为小写、返回 `csrf_token`、响应体无 `password_hash` |
  | Session Cookie | 含 `HttpOnly` 与 `SameSite=Lax` |
  | `resolveRedirect` 谓词 | 拒绝 `//evil.example`、绝对 URL 与非 `/` 开头值，接受 `/notes`、`/s/<token>`、`/notes?page=2` |
  | 错误方法 `PUT /api/auth/login` | 405 `METHOD_NOT_ALLOWED`（**已修正，见下**） |

**主智能体补充修正（本阶段验证中发现，均已由新增用例钉住）**

1. `api/auth.py` 的 `logout` 缺少 `@login_required`，匿名调用返回 200，违反规格「`/api/*` 除标注公开外
   均需登录」，且与 Phase 8 鉴权矩阵对 `POST /api/auth/logout` 的 401 期望冲突。已加装饰器，
   并新增 `tests/test_auth_api.py::test_logout_requires_login`。
2. `app.py` 的 `handle_http_exception` 把非 404/413 的 HTTPException 一律映射为 `INTERNAL_ERROR`，
   导致 405 等状态码与错误码自相矛盾，违反规格「HTTP 状态码语义化」。现补齐映射：
   400 → `INVALID_PARAM`、405 → `METHOD_NOT_ALLOWED`、415 → `UNSUPPORTED_MEDIA_TYPE`。
   为此在 `core/errors.py` 增加 2 个错误码（规格表 23 码 → 25 码），这是对规格表的有意扩展，
   用于覆盖规格未列举但实际可达的 HTTP 语义。新增
   `tests/test_auth_api.py::test_wrong_method_on_api_returns_method_not_allowed`。

**子智能体的有意偏差（主智能体已复核接受）**

1. `auth.css` 的输入框描边用 `--c-border-strong`、字段错误文案色用 `--c-danger-strong`，而非阶段文件
   字面写的 `--c-border` / `--c-danger`。原因：后者会让交互组件边界与 12px 错误文字回退到 Phase 2 已
   修复的对比度缺陷。属正确取舍。
2. 新增独立 Node 验证脚本 `tests/js/render_auth.mjs`（复用 `dom-shim.mjs`），未改动 Phase 2 依赖的
   `render.mjs` 契约。
3. 额外交付 `tests/test_auth_views.py`（26 项），覆盖登录守卫、未注册路由不崩溃、CSS 契约与前端文案。
4. **已登录顶栏保留「关于」链接**：规格的 `AppHeader` 行对已登录态只列 `写笔记 / 我的主页 / 头像菜单`，
   本实现为 `写笔记 / 我的主页 / 关于 / 头像菜单`。理由：去掉后已登录用户无法从界面进入 `/about`。
   这是对规格组件契约的**有意扩展**，若需严格对齐可在 Phase 8 移除该链接。

**遗留风险（交接后续阶段）**

1. `/notes`、`/me` 本阶段按边界未注册；登录守卫用受保护路由验证通过，但「登录后回跳原路径」需在
   Phase 5/7 注册这两个路由后复验（Phase 8 端到端走查场景 A 覆盖）。
2. 修改密码后不强制下线（计划记录的有意取舍）。
3. 所有浏览器观感、动画与焦点环实测项仍待人工确认，已在 `visual-checklist.md` 显式标注。
4. Phase 2 遗留的 `:focus-visible` 焦点环对比度（2.85:1 < 3:1）未在本阶段处理，仍待 Phase 8 决策。
