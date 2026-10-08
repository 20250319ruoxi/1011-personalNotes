# Phase 6: 分享与评论

**Goal:** 完成带密码的分享链接全流程与评论功能，前端交付公开分享页、密码锁屏、评论区与作者的分享面板。

**Prerequisites:** Phase 3（登录态、CSRF 豁免与 Origin 校验）、Phase 4（笔记接口）、Phase 5（纸张容器、Markdown 渲染、详情页）。

**Deliverables:**
- `api/share.py` 四个接口、`api/comments.py` 五个接口
- `core/db.py` 分享与评论 DAO、`core/auth.py` 分享解锁态助手
- `static/js/share.js`（公开分享页 + 作者分享面板）、`static/js/comments.js`（评论区组件）、`static/css/share.css`
- 详情页的分享面板与评论区接入
- `tests/test_share_api.py`、`tests/test_comments_api.py`、`tests/test_rate_limit.py`（追加分享密码限流）

**Interface Decisions Implemented:**
- 分享模型：关闭分享即清空 `share_token` 与 `share_password_hash` 并把状态回退为 `private`
- 分享密码锁屏 `ShareLock` 全部状态：默认 / 校验中 / 密码错误（抖动 + 「访问密码错误」）/ 限流提示
- 分享面板 `SharePanel`：开关「开启分享」、密码输入（占位「留空表示不需要密码」）、只读链接框 + 「复制链接」、已开启时显示「关闭分享」危险操作、复制成功提示「链接已复制」
- 评论区 `CommentList`：空态「还没有评论，来说点什么吧」、未登录时输入区替换为「登录后可发表评论」+ 登录按钮、删除二次确认
- 分享页与详情页共用同一评论区组件

---

## Task 1: 分享后端接口与解锁态

**Goal:** 交付开启/关闭分享、公开读取、密码校验四个接口，以及基于 Session 的解锁状态。

**Files:**
- Create: `api/share.py`
- Modify: `core/auth.py`（追加 `mark_share_unlocked`、`is_share_unlocked`、`forget_share_unlocked`）
- Modify: `core/db.py`（追加分享 DAO）
- Modify: `core/validators.py`（追加 `validate_share_password`）
- Test: `tests/test_share_api.py`

**Steps:**

- [ ] 创建 `tests/test_share_api.py`：

```python
def _create_note(c, headers, status="private", title="分享内容"):
    return c.post("/api/notes", json={"title": title, "content_md": "# 正文\n内容",
                                      "status": status, "tags": ["分享"]},
                  headers=headers).get_json()["data"]["note"]["id"]


def test_enable_share_without_password(alice):
    c, headers = alice
    note_id = _create_note(c, headers)
    data = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers).get_json()["data"]
    assert data["has_password"] is False
    assert data["share_url"].startswith("/s/")
    detail = c.get(f"/api/notes/{note_id}").get_json()["data"]["note"]
    assert detail["status"] == "public"
    assert detail["share_token"] in data["share_url"]


def test_public_share_page_is_readable_without_login(client, alice):
    c, headers = alice
    note_id = _create_note(c, headers)
    url = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                 ).get_json()["data"]["share_url"]
    token = url.rsplit("/", 1)[-1]

    anon = client.application.test_client()
    body = anon.get(f"/api/share/{token}").get_json()
    assert body["code"] == "OK"
    assert body["data"]["note"]["content_md"].startswith("# 正文")
    assert body["data"]["note"]["tags"] == ["分享"]
    assert body["data"]["author"]["username"] == "alice"
    assert "share_token" not in body["data"]["note"]


def test_password_protected_share_requires_verify(client, alice):
    c, headers = alice
    note_id = _create_note(c, headers)
    url = c.post(f"/api/notes/{note_id}/share", json={"password": "read1234"},
                 headers=headers).get_json()["data"]["share_url"]
    token = url.rsplit("/", 1)[-1]

    anon = client.application.test_client()
    locked = anon.get(f"/api/share/{token}")
    assert locked.status_code == 401
    assert locked.get_json()["code"] == "SHARE_PASSWORD_REQUIRED"

    assert anon.post(f"/api/share/{token}/verify", json={"password": "wrongpass"}
                     ).get_json()["code"] == "SHARE_PASSWORD_WRONG"

    ok_resp = anon.post(f"/api/share/{token}/verify", json={"password": "read1234"})
    assert ok_resp.get_json()["code"] == "OK"
    assert ok_resp.get_json()["data"]["note"]["title"] == "分享内容"

    assert anon.get(f"/api/share/{token}").get_json()["code"] == "OK"


def test_share_password_rate_limited(client, alice):
    c, headers = alice
    note_id = _create_note(c, headers)
    url = c.post(f"/api/notes/{note_id}/share", json={"password": "read1234"},
                 headers=headers).get_json()["data"]["share_url"]
    token = url.rsplit("/", 1)[-1]

    anon = client.application.test_client()
    for _ in range(5):
        anon.post(f"/api/share/{token}/verify", json={"password": "wrongpass"})
    limited = anon.post(f"/api/share/{token}/verify", json={"password": "read1234"})
    assert limited.status_code == 429
    assert limited.get_json()["code"] == "RATE_LIMITED"


def test_invalid_token_returns_share_disabled(client):
    resp = client.get("/api/share/not-a-real-token")
    assert resp.status_code == 404
    assert resp.get_json()["code"] == "SHARE_DISABLED"


def test_disable_share_revokes_link_and_resets_status(client, alice):
    c, headers = alice
    note_id = _create_note(c, headers)
    url = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                 ).get_json()["data"]["share_url"]
    token = url.rsplit("/", 1)[-1]

    assert c.delete(f"/api/notes/{note_id}/share", headers=headers).get_json()["code"] == "OK"
    detail = c.get(f"/api/notes/{note_id}").get_json()["data"]["note"]
    assert detail["status"] == "private"
    assert detail["share_token"] is None

    anon = c.application.test_client()
    assert anon.get(f"/api/share/{token}").get_json()["code"] == "SHARE_DISABLED"


def test_enabling_share_twice_keeps_token_and_updates_password(alice):
    c, headers = alice
    note_id = _create_note(c, headers)
    first = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                   ).get_json()["data"]
    second = c.post(f"/api/notes/{note_id}/share", json={"password": "newpass1"},
                    headers=headers).get_json()["data"]
    assert first["share_url"] == second["share_url"]
    assert second["has_password"] is True


def test_share_password_length_is_validated(alice):
    c, headers = alice
    note_id = _create_note(c, headers)
    assert c.post(f"/api/notes/{note_id}/share", json={"password": "abc"},
                  headers=headers).get_json()["code"] == "INVALID_PARAM"


def test_only_owner_can_manage_share(alice, bob_raw):
    c, headers = alice
    note_id = _create_note(c, headers)
    other, other_headers = bob_raw
    assert other.post(f"/api/notes/{note_id}/share", json={},
                      headers=other_headers).get_json()["code"] == "NOT_FOUND"
    assert other.delete(f"/api/notes/{note_id}/share",
                        headers=other_headers).get_json()["code"] == "NOT_FOUND"


def test_draft_note_has_no_public_surface(client, alice):
    c, headers = alice
    draft_id = _create_note(c, headers, status="draft")
    detail = c.get(f"/api/notes/{draft_id}").get_json()["data"]["note"]
    assert detail["status"] == "draft"
    assert detail["share_token"] is None
    public_items = c.get("/api/notes?status=public").get_json()["data"]["items"]
    assert all(item["id"] != draft_id for item in public_items)


def test_shared_note_is_readable_by_logged_in_user(alice, bob_raw):
    c, headers = alice
    note_id = _create_note(c, headers)
    url = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                 ).get_json()["data"]["share_url"]
    token = url.rsplit("/", 1)[-1]

    other, _ = bob_raw
    body = other.get(f"/api/share/{token}").get_json()
    assert body["code"] == "OK"
    assert other.get(f"/api/notes/{note_id}").get_json()["code"] == "OK"
```

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_share_api.py -v
```

  - Expected: FAIL（无 `api.share` 模块）

- [ ] 在 `core/validators.py` 追加：

```python
MIN_SHARE_PASSWORD_LENGTH = 4
MAX_SHARE_PASSWORD_LENGTH = 64


def validate_share_password(password):
    if password is None or password == "":
        return True, None
    if not isinstance(password, str):
        return False, "INVALID_PARAM"
    if not MIN_SHARE_PASSWORD_LENGTH <= len(password) <= MAX_SHARE_PASSWORD_LENGTH:
        return False, "INVALID_PARAM"
    return True, None
```

- [ ] 在 `core/db.py` 追加：

```python
MAX_UNLOCKED_TOKENS = 20


def get_note_by_share_token(conn, token):
    return conn.execute(
        "SELECT * FROM notes WHERE share_token = ? AND status = 'public' AND is_deleted = 0",
        (token,),
    ).fetchone()


def set_note_share(conn, note_id, token, password_hash):
    conn.execute(
        "UPDATE notes SET status = 'public', share_token = ?, share_password_hash = ?, "
        "published_at = COALESCE(published_at, ?), updated_at = ? WHERE id = ?",
        (token, password_hash, now_iso(), now_iso(), note_id),
    )
    conn.commit()


def clear_note_share(conn, note_id):
    conn.execute(
        "UPDATE notes SET status = 'private', share_token = NULL, share_password_hash = NULL, "
        "updated_at = ? WHERE id = ?",
        (now_iso(), note_id),
    )
    conn.commit()
```

- [ ] 在 `core/auth.py` 追加：

```python
MAX_UNLOCKED_TOKENS = 20


def mark_share_unlocked(token):
    unlocked = [t for t in (session.get("share_unlocked") or []) if t != token]
    unlocked.append(token)
    session["share_unlocked"] = unlocked[-MAX_UNLOCKED_TOKENS:]


def is_share_unlocked(token):
    return token in (session.get("share_unlocked") or [])


def forget_share_unlocked(token):
    session["share_unlocked"] = [t for t in (session.get("share_unlocked") or []) if t != token]
```

- [ ] 创建 `api/share.py`：

```python
from flask import Blueprint, current_app, request

from core import db as db_module
from core.auth import (current_user, forget_share_unlocked, is_share_unlocked,
                       login_required, mark_share_unlocked)
from core.response import fail, ok
from core.security import (clear_failures, generate_share_token, hash_password,
                           is_rate_limited, record_failure, verify_password)
from core.validators import validate_share_password

bp = Blueprint("share", __name__, url_prefix="/api")


def share_note_payload(note, conn):
    return {
        "note": {
            "id": note["id"],
            "title": note["title"],
            "content_md": note["content_md"],
            "tags": db_module.get_note_tags(conn, note["id"]),
            "published_at": note["published_at"],
            "updated_at": note["updated_at"],
        },
        "author": public_author(conn, note["user_id"]),
    }


def public_author(conn, user_id):
    row = db_module.get_user_by_id(conn, user_id)
    if row is None:
        return {"username": "已注销用户", "avatar": None}
    return {"username": row["username"], "avatar": row["avatar"]}


def load_shared_note(token):
    """返回 (note, error_code)。error_code 非空时表示不可访问。"""
    note = db_module.get_note_by_share_token(db_module.get_db(), token)
    if note is None:
        return None, "SHARE_DISABLED"
    if note["share_password_hash"] is not None and not is_share_unlocked(token):
        return None, "SHARE_PASSWORD_REQUIRED"
    return note, None


@bp.post("/notes/<int:note_id>/share")
@login_required
def enable_share(note_id):
    payload = request.get_json(silent=True) or {}
    password = payload.get("password")
    passed, code = validate_share_password(password)
    if not passed:
        return fail(code)

    conn = db_module.get_db()
    note = db_module.get_note(conn, note_id)
    if note is None or note["is_deleted"] or note["user_id"] != current_user()["id"]:
        return fail("NOT_FOUND")

    token = note["share_token"] or generate_share_token()
    password_hash = hash_password(password) if password else None
    db_module.set_note_share(conn, note_id, token, password_hash)

    return ok({"share_url": f"/s/{token}", "has_password": password_hash is not None},
              "已开启分享")


@bp.delete("/notes/<int:note_id>/share")
@login_required
def disable_share(note_id):
    conn = db_module.get_db()
    note = db_module.get_note(conn, note_id)
    if note is None or note["is_deleted"] or note["user_id"] != current_user()["id"]:
        return fail("NOT_FOUND")

    token = note["share_token"]
    db_module.clear_note_share(conn, note_id)
    if token:
        forget_share_unlocked(token)
    return ok(None, "已关闭分享")


@bp.get("/share/<token>")
def read_shared_note(token):
    note, error = load_shared_note(token)
    if error:
        return fail(error)
    return ok(share_note_payload(note, db_module.get_db()))


@bp.post("/share/<token>/verify")
def verify_share_password(token):
    conn = db_module.get_db()
    note = db_module.get_note_by_share_token(conn, token)
    if note is None:
        return fail("SHARE_DISABLED")

    cfg = current_app.config
    if is_rate_limited(conn, "share", token,
                       cfg["LOGIN_MAX_FAILURES"], cfg["LOGIN_FAILURE_WINDOW_SECONDS"]):
        return fail("RATE_LIMITED")

    payload = request.get_json(silent=True) or {}
    password = payload.get("password") or ""
    if note["share_password_hash"] is None:
        mark_share_unlocked(token)
        return ok(share_note_payload(note, conn))

    if not verify_password(note["share_password_hash"], password):
        record_failure(conn, "share", token)
        return fail("SHARE_PASSWORD_WRONG")

    clear_failures(conn, "share", token)
    mark_share_unlocked(token)
    return ok(share_note_payload(note, conn))
```

- [ ] 在 `api/notes.py` 的 `get_note_detail` 中把非作者分支改为：

```python
    if note["user_id"] != current_user()["id"]:
        if (note["status"] == "public" and note["share_token"]
                and is_share_unlocked(note["share_token"])):
            return ok({"note": note_to_dict(note, db_module.get_note_tags(conn, note_id),
                                            include_share=False)})
        return fail("NOT_FOUND")
```

  并在 `api/notes.py` 顶部补 `from core.auth import is_share_unlocked`。

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_share_api.py -v
```

  - Expected: 11 个用例全部 passed

**Security/Boundary Notes:**
- 公开接口返回的 `note` 载荷不含 `share_token`、不含 `share_password_hash`、不含 `user_id`；作者信息只暴露 `username` 与 `avatar`。
- 分享密码独立限流（`scope='share'`、`key=token`），与登录限流互不影响，避免攻击者用登录失败把分享访问者一起锁死。
- 解锁态存于 Session 且最多保留 20 个 token，避免 Cookie 膨胀；关闭分享时主动清除对应解锁记录。
- 分享链接的 token 校验走 `status='public'` 与 `share_token` 双条件，保证状态回退后旧链接立即失效。

**Dependencies:** Phase 4 Task 2、Phase 3 Task 1/3

---

## Task 2: 评论后端接口与权限矩阵

**Goal:** 交付评论增删查五个接口，并把删除权限、草稿不可评论、设密分享需解锁三条规则落到接口层。

**Files:**
- Create: `api/comments.py`
- Modify: `core/db.py`（追加评论 DAO）
- Test: `tests/test_comments_api.py`

**Steps:**

- [ ] 创建 `tests/test_comments_api.py`：

```python
def _own_note(c, headers, status="private"):
    return c.post("/api/notes", json={"title": "带评论的笔记", "content_md": "正文",
                                      "status": status}, headers=headers
                  ).get_json()["data"]["note"]["id"]


def _shared_note(c, headers, password=None):
    note_id = _own_note(c, headers)
    payload = {"password": password} if password else {}
    url = c.post(f"/api/notes/{note_id}/share", json=payload, headers=headers
                 ).get_json()["data"]["share_url"]
    return note_id, url.rsplit("/", 1)[-1]


def test_owner_can_comment_on_own_note(alice):
    c, headers = alice
    note_id = _own_note(c, headers)
    resp = c.post(f"/api/notes/{note_id}/comments", json={"content": "第一条"}, headers=headers)
    assert resp.get_json()["code"] == "OK"
    comment = resp.get_json()["data"]["comment"]
    assert comment["content"] == "第一条"
    assert comment["author"]["username"] == "alice"
    assert comment["can_delete"] is True


def test_other_user_cannot_read_or_post_owner_comments(alice, bob_raw):
    c, headers = alice
    note_id = _own_note(c, headers)
    other, other_headers = bob_raw
    assert other.get(f"/api/notes/{note_id}/comments").get_json()["code"] == "NOT_FOUND"
    assert other.post(f"/api/notes/{note_id}/comments", json={"content": "越权"},
                      headers=other_headers).get_json()["code"] == "NOT_FOUND"


def test_logged_in_user_can_comment_via_share_link(alice, bob_raw):
    c, headers = alice
    note_id, token = _shared_note(c, headers)
    other, other_headers = bob_raw
    resp = other.post(f"/api/share/{token}/comments", json={"content": "路过点赞"},
                      headers=other_headers)
    assert resp.get_json()["code"] == "OK"
    assert resp.get_json()["data"]["comment"]["author"]["username"] == "bob"
    assert resp.get_json()["data"]["comment"]["can_delete"] is True


def test_anonymous_cannot_comment_on_share(client, alice):
    c, headers = alice
    note_id, token = _shared_note(c, headers)
    anon = client.application.test_client()
    assert anon.post(f"/api/share/{token}/comments", json={"content": "匿名"}
                     ).status_code == 401
    assert anon.get(f"/api/share/{token}/comments").get_json()["code"] == "OK"


def test_password_protected_comments_require_unlock(client, alice):
    c, headers = alice
    note_id, token = _shared_note(c, headers, password="read1234")
    anon = client.application.test_client()
    locked = anon.get(f"/api/share/{token}/comments")
    assert locked.status_code == 401
    assert locked.get_json()["code"] == "SHARE_PASSWORD_REQUIRED"
    anon.post(f"/api/share/{token}/verify", json={"password": "read1234"})
    assert anon.get(f"/api/share/{token}/comments").get_json()["code"] == "OK"


def test_comment_list_shows_both_authors_and_delete_flags(alice, bob_raw):
    c, headers = alice
    note_id, token = _shared_note(c, headers)
    c.post(f"/api/notes/{note_id}/comments", json={"content": "作者的话"}, headers=headers)
    other, other_headers = bob_raw
    other.post(f"/api/share/{token}/comments", json={"content": "读者的话"}, headers=other_headers)

    items = c.get(f"/api/notes/{note_id}/comments").get_json()["data"]["items"]
    assert [i["content"] for i in items] == ["作者的话", "读者的话"]
    assert items[0]["author"]["id"] != items[1]["author"]["id"]


def test_delete_permission_matrix(alice, bob_raw):
    c, headers = alice
    note_id, token = _shared_note(c, headers)
    author_comment = c.post(f"/api/notes/{note_id}/comments", json={"content": "作者的评论"},
                            headers=headers).get_json()["data"]["comment"]["id"]

    other, other_headers = bob_raw
    reader_comment = other.post(f"/api/share/{token}/comments", json={"content": "读者的评论"},
                               headers=other_headers).get_json()["data"]["comment"]["id"]

    # 评论作者可删自己的
    assert other.delete(f"/api/comments/{reader_comment}",
                        headers=other_headers).get_json()["code"] == "OK"
    # 笔记作者可删他人评论
    assert c.delete(f"/api/comments/{author_comment}", headers=headers).get_json()["code"] == "OK"

    # 无关用户不可删
    third = c.application.test_client()
    third.post("/api/auth/register", json={
        "email": "carol@example.com", "username": "carol",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    third_headers = {"X-CSRF-Token": third.get("/api/auth/me").get_json()["data"]["csrf_token"]}
    foreign = c.post(f"/api/notes/{note_id}/comments", json={"content": "又一次"},
                     headers=headers).get_json()["data"]["comment"]["id"]
    assert third.delete(f"/api/comments/{foreign}",
                        headers=third_headers).status_code == 403
    assert third.delete(f"/api/comments/{foreign}",
                        headers=third_headers).get_json()["code"] == "FORBIDDEN"


def test_deleted_comment_disappears_from_list(alice):
    c, headers = alice
    note_id = _own_note(c, headers)
    comment_id = c.post(f"/api/notes/{note_id}/comments", json={"content": "待删除"},
                        headers=headers).get_json()["data"]["comment"]["id"]
    c.delete(f"/api/comments/{comment_id}", headers=headers)
    assert c.get(f"/api/notes/{note_id}/comments").get_json()["data"]["total"] == 0


def test_comment_validation(alice):
    c, headers = alice
    note_id = _own_note(c, headers)
    assert c.post(f"/api/notes/{note_id}/comments", json={"content": "   "},
                  headers=headers).get_json()["code"] == "INVALID_PARAM"
    assert c.post(f"/api/notes/{note_id}/comments", json={"content": "x" * 1001},
                  headers=headers).get_json()["code"] == "CONTENT_TOO_LONG"


def test_comments_pagination(alice):
    c, headers = alice
    note_id = _own_note(c, headers)
    for i in range(12):
        c.post(f"/api/notes/{note_id}/comments", json={"content": f"评论{i}"}, headers=headers)
    data = c.get(f"/api/notes/{note_id}/comments?page=1&page_size=5").get_json()["data"]
    assert data["total"] == 12 and len(data["items"]) == 5
    assert data["items"][0]["content"] == "评论0"


def test_draft_note_cannot_be_commented_through_share(alice):
    c, headers = alice
    draft_id = _own_note(c, headers, status="draft")
    # 草稿未开启分享，不存在可访问的 token 路径
    assert c.get(f"/api/share/draft-token").get_json()["code"] == "SHARE_DISABLED"
    assert c.post(f"/api/notes/{draft_id}/comments", json={"content": "自评"},
                  headers=headers).get_json()["code"] == "OK"
```

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_comments_api.py -v
```

  - Expected: FAIL（无 `api.comments` 模块）

- [ ] 在 `core/db.py` 追加：

```python
def create_comment(conn, note_id, user_id, content):
    cursor = conn.execute(
        "INSERT INTO comments (note_id, user_id, content, created_at) VALUES (?, ?, ?, ?)",
        (note_id, user_id, content, now_iso()),
    )
    conn.commit()
    return cursor.lastrowid


def get_comment(conn, comment_id):
    return conn.execute("SELECT * FROM comments WHERE id = ?", (comment_id,)).fetchone()


def soft_delete_comment(conn, comment_id):
    conn.execute("UPDATE comments SET is_deleted = 1 WHERE id = ?", (comment_id,))
    conn.commit()


def list_comments(conn, note_id, page=1, page_size=10):
    total = conn.execute(
        "SELECT COUNT(*) AS n FROM comments WHERE note_id = ? AND is_deleted = 0",
        (note_id,),
    ).fetchone()["n"]
    rows = conn.execute(
        "SELECT c.*, u.username AS author_username, u.avatar AS author_avatar "
        "FROM comments c JOIN users u ON u.id = c.user_id "
        "WHERE c.note_id = ? AND c.is_deleted = 0 "
        "ORDER BY c.created_at ASC, c.id ASC LIMIT ? OFFSET ?",
        (note_id, page_size, (page - 1) * page_size),
    ).fetchall()
    return rows, total
```

- [ ] 创建 `api/comments.py`：

```python
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, is_share_unlocked, login_required
from core.response import fail, ok
from core.validators import parse_pagination, validate_comment

bp = Blueprint("comments", __name__, url_prefix="/api")


def comment_to_dict(row, note_owner_id, viewer_id):
    return {
        "id": row["id"],
        "content": row["content"],
        "created_at": row["created_at"],
        "author": {
            "id": row["user_id"],
            "username": row["author_username"],
            "avatar": row["author_avatar"],
        },
        "can_delete": viewer_id in (row["user_id"], note_owner_id),
    }


def owned_note_or_none(note_id, user_id):
    note = db_module.get_note(db_module.get_db(), note_id)
    if note is None or note["is_deleted"] or note["user_id"] != user_id:
        return None
    return note


def shared_note_or_error(token):
    note = db_module.get_note_by_share_token(db_module.get_db(), token)
    if note is None:
        return None, "SHARE_DISABLED"
    if note["share_password_hash"] is not None and not is_share_unlocked(token):
        return None, "SHARE_PASSWORD_REQUIRED"
    return note, None


def _list_response(note, args, viewer_id):
    page, page_size = parse_pagination(args, default=10, maximum=50)
    rows, total = db_module.list_comments(db_module.get_db(), note["id"], page, page_size)
    items = [comment_to_dict(r, note["user_id"], viewer_id) for r in rows]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


def _create_response(note, viewer_id):
    payload = request.get_json(silent=True) or {}
    content = payload.get("content")
    passed, code = validate_comment(content)
    if not passed:
        return fail(code)
    conn = db_module.get_db()
    comment_id = db_module.create_comment(conn, note["id"], viewer_id, content.strip())
    row = conn.execute(
        "SELECT c.*, u.username AS author_username, u.avatar AS author_avatar "
        "FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?",
        (comment_id,),
    ).fetchone()
    return ok({"comment": comment_to_dict(row, note["user_id"], viewer_id)}, "已发表评论")


@bp.get("/notes/<int:note_id>/comments")
@login_required
def list_owner_comments(note_id):
    note = owned_note_or_none(note_id, current_user()["id"])
    if note is None:
        return fail("NOT_FOUND")
    return _list_response(note, request.args, current_user()["id"])


@bp.post("/notes/<int:note_id>/comments")
@login_required
def create_owner_comment(note_id):
    note = owned_note_or_none(note_id, current_user()["id"])
    if note is None:
        return fail("NOT_FOUND")
    return _create_response(note, current_user()["id"])


@bp.get("/share/<token>/comments")
def list_shared_comments(token):
    note, error = shared_note_or_error(token)
    if error:
        return fail(error)
    viewer = current_user()
    return _list_response(note, request.args, viewer["id"] if viewer else None)


@bp.post("/share/<token>/comments")
@login_required
def create_shared_comment(token):
    note, error = shared_note_or_error(token)
    if error:
        return fail(error)
    return _create_response(note, current_user()["id"])


@bp.delete("/comments/<int:comment_id>")
@login_required
def delete_comment(comment_id):
    conn = db_module.get_db()
    comment = db_module.get_comment(conn, comment_id)
    if comment is None or comment["is_deleted"]:
        return fail("NOT_FOUND")

    note = db_module.get_note(conn, comment["note_id"])
    viewer_id = current_user()["id"]
    if viewer_id not in (comment["user_id"], note["user_id"] if note else None):
        return fail("FORBIDDEN")

    db_module.soft_delete_comment(conn, comment_id)
    return ok(None, "评论已删除")
```

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_comments_api.py -v
```

  - Expected: 11 个用例全部 passed

- [ ] 在 `tests/test_rate_limit.py` 追加一条分享密码与登录限流互不影响的用例：

```python
def test_share_password_limit_does_not_lock_login(app, client):
    client.post("/api/auth/register", json={
        "email": "sep@example.com", "username": "separate",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    headers = {"X-CSRF-Token": client.get("/api/auth/me").get_json()["data"]["csrf_token"]}
    note_id = client.post("/api/notes", json={"title": "t", "content_md": "c",
                                              "status": "private"}, headers=headers
                          ).get_json()["data"]["note"]["id"]
    token = client.post(f"/api/notes/{note_id}/share", json={"password": "read1234"},
                        headers=headers).get_json()["data"]["share_url"].rsplit("/", 1)[-1]

    anon = client.application.test_client()
    for _ in range(5):
        anon.post(f"/api/share/{token}/verify", json={"password": "wrongpass"})
    assert anon.post(f"/api/share/{token}/verify", json={"password": "read1234"}
                     ).get_json()["code"] == "RATE_LIMITED"

    fresh = client.application.test_client()
    assert fresh.post("/api/auth/login", json={"email": "sep@example.com",
                                               "password": "passw0rd"}
                      ).get_json()["code"] == "OK"
```

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 全部 passed

**Security/Boundary Notes:**
- 评论的 `can_delete` 由服务端计算，前端只用于显示/隐藏按钮；真正的权限判定在 `delete_comment` 中重做，不信任前端。
- 作者视角接口（`/notes/<id>/comments`）走归属校验，非作者返回 `NOT_FOUND`；无关用户删除返回 `FORBIDDEN`（删除动作需要在服务端明确拒绝，避免被当作「不存在」而掩盖越权尝试）。
- 评论列表只 JOIN `users` 取 `username` 与 `avatar`，不返回邮箱等隐私字段。
- 设密分享的评论读取与写入都要求已解锁，避免通过评论接口旁路读取受保护内容。

**Dependencies:** Task 1

---

## Task 3: 分享页前端与密码锁屏

**Goal:** 交付免登录的分享页与密码锁屏状态。

**Files:**
- Create: `static/js/share.js`（本任务先实现 `renderSharePage`）
- Create: `static/css/share.css`
- Modify: `static/js/router.js`（注册 `/s/<token>`）

**Steps:**

- [ ] 创建 `static/js/share.js` 的 `renderSharePage(root, params)`：

  - 请求 `api.get('/api/share/' + params.token, { silent: true })`，按 `code` 分支：
    - `OK` → 渲染文章
    - `SHARE_PASSWORD_REQUIRED` → 渲染锁屏
    - `SHARE_DISABLED` → 渲染失效空态
    - 其他 → 渲染通用错误空态并显示后端 `message`
  - 文章结构（单栏纸张）：
    - `<h1 class="share-title">`：`note.title`，空则「无标题」。
    - `.share-meta`：作者首字头像 + 用户名 + 「更新于 `formatDate(note.updated_at)`」+ 标签 chips。
    - `.share-body.markdown-body`：`renderMarkdown(note.content_md)`。
    - `.share-actions`：本阶段留空容器 `#share-actions`（收藏按钮由 Phase 7 插入）。
    - `#share-comments`：评论区容器，由 Task 4 渲染。
  - 锁屏结构 `.share-lock.paper`：锁形内联 SVG（`aria-hidden`）、`<h2>该笔记需要密码访问</h2>`、`<label>` + `<input type="password" autocomplete="current-password">`、按钮「确认访问」。
    - 提交后按钮进入 loading；失败时给 `.share-lock` 添加 `.is-shaking` 类（300ms 后移除）并把后端 `message` 显示在输入框下方 `.field-error`；达到 `RATE_LIMITED` 时禁用按钮并把文案改为「尝试过于频繁，请稍后再试」。
    - 校验成功 → 直接用返回的数据渲染文章，不重新请求。
  - 失效空态：标题「该分享链接已失效」，说明「作者可能已关闭分享，或链接不正确。」，按钮「返回首页」→ `/`。
  - 页面 `<title>`：渲染成功后设为 `「<笔记标题>」- 个人笔记`；未渲染成功时保持「个人笔记」。

- [ ] 在 `router.js` 注册（**不要求登录**）：

```js
registerRoute('/s/:token', async (root, params) => {
  const { renderSharePage } = await import('./share.js');
  renderSharePage(root, params);
});
```

- [ ] `static/css/share.css` 实现：

  - `.share-page`：`max-width:var(--page-max); margin:0 auto; padding:var(--sp-8) var(--gutter) var(--sp-16);`
  - `.share-article`：纸张容器（底图 + `var(--c-paper-fallback)` + `var(--bd)` + `var(--r-2)` + `var(--sp-8)` 内边距），内部 `.share-body` 用 `max-width:var(--reading-max); margin:0 auto;`
  - `.share-meta`：`display:flex; flex-wrap:wrap; gap:var(--sp-3); align-items:center; var(--fs-sm); var(--c-text-muted-strong);`
  - `.share-lock`：`width:min(420px, 100%); margin: var(--sp-16) auto; text-align:center;` 图标 40×40 放在主色圆形底上；`input` 高度 44px。
  - `@keyframes shake`：水平位移 ±6px，两次；`.is-shaking { animation: shake .3s; }`，并在 `prefers-reduced-motion` 下禁用该动画（依赖 `base.css` 的全局降级规则）。
  - `@media (max-width:768px)`：`.share-article` 内边距改 `var(--sp-4)`。

- [ ] 手工验证：
  - 无密码分享链接在浏览器隐私窗口打开 → 直接显示正文与作者信息，顶栏为未登录态
  - 有密码链接 → 显示锁屏；错误密码 → 输入框抖动 + 「访问密码错误」；正确密码 → 进入正文
  - 连续输错 5 次 → 提示「尝试过于频繁，请稍后再试」且按钮禁用
  - 作者关闭分享后刷新该链接 → 显示「该分享链接已失效」+ 返回首页

**Security/Boundary Notes:** 分享页不渲染任何编辑/删除入口；作者信息只使用接口返回的 `username` 与 `avatar`，通过 `textContent` 写入 DOM。

**Dependencies:** Task 1、Phase 5 Task 1

---

## Task 4: 评论区组件与详情页分享面板

**Goal:** 交付两页共用的评论区，并把分享面板接入作者详情页。

**Files:**
- Create: `static/js/comments.js`
- Modify: `static/js/share.js`（导出并实现 `renderSharePanel`，并在分享页挂载评论区）
- Modify: `static/js/notes.js`（详情页挂载分享面板与评论区）
- Modify: `static/css/notes.css`、`static/css/share.css`（评论与分享面板样式）

**Steps:**

- [ ] 创建 `static/js/comments.js`，导出 `renderComments(container, { listPath, createPath, noteOwnerId })`：

  - 拉取 `api.get(listPath)`；加载中显示 3 行骨架。
  - 头部：`<h2>评论（N）</h2>`，N 取 `total`。
  - 表单区：
    - 未登录（`!store.isLoggedIn()`）：显示 `<p>登录后可发表评论</p>` + 按钮「去登录」→ `/login?redirect=<当前路径>`。
    - 已登录：`<textarea placeholder="写下你的想法…" maxlength="1000" rows="3">` + 按钮「发表评论」。提交后清空输入框、把新评论追加到列表末尾、`total` 加一，并 toast「已发表评论」。
  - 列表项 `.comment`：首字头像（`var(--c-accent)` 底 + 深色字）、用户名、相对时间、内容（`textContent` 写入，保留换行用 `white-space: pre-wrap`）、当 `can_delete` 为真时的「删除」文字按钮。
  - 删除：`confirmDialog({ title:'删除评论', message:'确定要删除这条评论吗？删除后无法恢复。', confirmText:'确定删除', danger:true })` → `api.del('/api/comments/' + id)` → 从列表移除、`total` 减一。
  - 空态：`还没有评论，来说点什么吧`。
  - 分页：`total > page_size` 时显示「加载更多」按钮，追加下一页到列表末尾。

- [ ] 在 `static/js/share.js` 追加 `renderSharePanel(container, note, { onChange })`，供作者详情页使用：

  - 结构 `.share-panel`：
    - 开关：`<label class="switch"><input type="checkbox" role="switch"> 开启分享</label>`；勾选状态由 `note.status === 'public'` 决定。
    - 密码输入：`<input type="password" placeholder="留空表示不需要密码" maxlength="64">`，仅在开关打开时显示。
    - 已开启时：只读链接框 `<input readonly value="<origin>/s/<token>">` + 按钮「复制链接」（`navigator.clipboard.writeText`，成功后 toast「链接已复制」；失败时回退为 `input.select()` 并提示「请手动复制」）。
    - 已开启时：危险操作按钮「关闭分享」。
  - 行为：
    - 打开开关 → `api.post('/api/notes/<id>/share', { password })` → 用返回的 `share_url` 拼绝对地址展示 → `onChange()` 让详情页刷新状态徽标。
    - 修改密码：已开启时改密码需重新点开关旁的「更新密码」按钮，调用同一接口。
    - 关闭分享 → `confirmDialog({ title:'关闭分享', message:'关闭后该链接将立即失效，已收藏或浏览过的人将无法再打开。', confirmText:'关闭分享', danger:true })` → `api.del('/api/notes/<id>/share')` → 隐藏链接与密码框 → `onChange()`。

- [ ] 在 `static/js/notes.js` 的 `renderNoteDetail` 中接入：

  - `.detail-actions` 保留 `编辑` 与 `删除`，并在其上方插入 `<section id="share-panel-slot" class="paper">` 与 `<section id="comments-slot">`。
  - 调用 `renderSharePanel(document.getElementById('share-panel-slot'), note, { onChange: reload })`；`reload` 重新 `api.get('/api/notes/<id>')` 并就地更新状态徽标与分享面板。
  - 调用 `renderComments(document.getElementById('comments-slot'), { listPath: '/api/notes/<id>/comments', createPath: '/api/notes/<id>/comments', noteOwnerId: note.id })`。

- [ ] 在 `renderSharePage` 中，文章渲染成功后调用：

```js
const { renderComments } = await import('./comments.js');
renderComments(document.getElementById('share-comments'), {
  listPath: `/api/share/${params.token}/comments`,
  createPath: `/api/share/${params.token}/comments`,
});
```

- [ ] 追加样式：`.comment`（顶部 `var(--bd)` 分隔、上下 `var(--sp-4)`）、`.comment-avatar`（32×32 圆形）、`.comment-body { white-space: pre-wrap; }`、`.share-panel`（`var(--sp-4)` 内边距、内部控件纵向 `var(--sp-3)` 间距）、`.switch`（44px 高、主色选中态）、`.share-panel .link-row { display:flex; gap:var(--sp-3); }`（`≤768px` 改纵向）。

- [ ] 手工验证：
  - 作者详情页开启分享（留空密码）→ 链接出现 → 点「复制链接」→ toast「链接已复制」→ 粘贴到隐私窗口可打开
  - 设置密码后，链接在隐私窗口打开需验证
  - 关闭分享 → 确认弹窗 → 链接消失、状态徽标回到「私密」→ 旧链接显示失效
  - 分享页未登录时评论区显示「登录后可发表评论」；登录后发表评论成功且列表即时更新
  - 作者在详情页可删除读者评论；读者回到分享页看到评论已消失

**Security/Boundary Notes:**
- 评论内容一律用 `textContent` 写入，绝不 `innerHTML`。
- 分享面板只展示服务端返回的 `share_token`，不自行生成或猜测 token。
- 关闭分享使用二次确认，因为该操作会立即影响已发出的链接。

**Dependencies:** Task 1、Task 2、Task 3、Phase 5 Task 4

---

## Task 5: 分享与评论视觉验收

**Files:**
- Modify: `tests/manual/visual-checklist.md`

**Steps:**

- [ ] 追加「Phase 6 · 分享与评论」表格：

| # | 路由 | 视口 | 状态 | 检查点 | 结果 |
|---|------|------|------|--------|------|
| 1 | `/s/:token` | 1440×900 | 无密码 | 纸张文章、作者区、正文宽度 720px 居中 | |
| 2 | `/s/:token` | 1440×900 | 需密码 | 锁屏卡片居中、图标、输入框、按钮 | |
| 3 | `/s/:token` | 1440×900 | 密码错误 | 卡片抖动 + 「访问密码错误」 | |
| 4 | `/s/:token` | 1440×900 | 限流 | 提示「尝试过于频繁，请稍后再试」，按钮禁用 | |
| 5 | `/s/:token` | 1440×900 | 已失效 | 「该分享链接已失效」+「返回首页」 | |
| 6 | `/s/:token` | 375×812 | 无密码 | 单栏、无横向滚动、正文内边距 16px | |
| 7 | `/notes/:id` | 1440×900 | 未开启分享 | 面板显示开关与密码输入，无链接行 | |
| 8 | `/notes/:id` | 1440×900 | 已开启 | 只读链接 + 复制按钮 + 关闭分享危险按钮 | |
| 9 | `/notes/:id` | 1440×900 | 复制成功 | 右上角 toast「链接已复制」 | |
| 10 | 两处评论区 | 1440×900 | 空态 | 显示「还没有评论，来说点什么吧」 | |
| 11 | 分享页评论 | 1440×900 | 未登录 | 输入区替换为「登录后可发表评论」+「去登录」 | |
| 12 | 详情页评论 | 1440×900 | 删除确认 | 弹窗含「确定要删除这条评论吗？删除后无法恢复。」 | |
| 13 | 两处评论区 | 键盘 | 默认 | Tab 可达输入框与按钮，焦点环可见 | |

- [ ] 逐项截图核对、填写「结果」列并修复问题。

**Dependencies:** Task 1–4

---

## Phase Completion Checklist

- [ ] 全部 5 个任务完成
- [ ] `.venv/Scripts/python.exe -m pytest tests/ -v` 全部通过（新增 `test_share_api.py`、`test_comments_api.py` 与 `test_rate_limit.py` 追加用例）
- [ ] 分享链接在无密码、有密码、已关闭三种情况下行为正确
- [ ] 分享密码与登录限流互不影响
- [ ] 评论的三种删除权限（评论作者 / 笔记作者 / 无关用户）均按预期
- [ ] 公开接口不返回 `share_token`、`share_password_hash`、`user_id` 与邮箱
- [ ] 分享页与详情页共用评论区，行为一致
- [ ] `tests/manual/visual-checklist.md` 中 Phase 6 的 13 行已填写并修复
- [ ] 可以进入 Phase 7
