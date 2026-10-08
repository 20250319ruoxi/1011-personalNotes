# Phase 4: 笔记后端

**Goal:** 完成笔记 CRUD、草稿/私密/公开三态、标签绑定与计数、筛选搜索排序分页，以及图片上传接口。

**Prerequisites:** Phase 3 完成（登录态、CSRF、`login_required`、DAO 时间助手就位）。

**Deliverables:**
- `core/markdown.py`（摘要生成）
- `core/db.py` 笔记与标签相关 DAO
- `api/notes.py`（5 个接口）、`api/tags.py`（1 个接口）、`api/uploads.py`（1 个接口）
- `tests/test_notes_api.py`、`tests/test_notes_list.py`、`tests/test_uploads_api.py`

**Interface Decisions Implemented:**
- 服务端「草稿 / 私密 / 公开」三态与 `share_token` 归属（`public` 仅能由 Phase 6 的分享接口进入）
- 列表载荷只含 `summary`（80 字纯文本），详情才返回 `content_md`
- `POST /notes` 的 `status=draft` 即「存草稿」，`status=private` 即「发布」
- 上传边界：仅 jpg/jpeg/png/gif/webp、单文件 ≤ 5MB、单用户总量 ≤ 200MB、UUID 重命名、按用户前缀统计用量

---

## Task 1: 摘要生成模块与笔记 DAO

**Goal:** 落地笔记数据访问层与 Markdown 纯文本摘要，作为接口层的基础。

**Files:**
- Create: `core/markdown.py`
- Modify: `core/db.py`（追加笔记与标签 DAO）
- Modify: `core/validators.py`（追加 `validate_note_status_for_write`、`validate_search_keyword`）
- Test: `tests/test_markdown.py`
- Test: `tests/test_notes_dao.py`

**Steps:**

- [x] 创建 `tests/test_markdown.py`：

```python
from core.markdown import to_plain_text


def test_strips_common_syntax():
    md = "# 标题\n\n这是**加粗**与*斜体*，还有 `代码` 与 [链接](https://example.com)。\n\n- 列表项\n> 引用"
    text = to_plain_text(md, limit=200)
    assert "#" not in text and "*" not in text and "`" not in text
    assert "标题" in text and "加粗" in text and "斜体" in text
    assert "链接" in text and "https://example.com" not in text
    assert "列表项" in text and "引用" in text


def test_drops_code_fence_and_image_url():
    md = "开头\n\n```python\nprint('x')\n```\n\n![图](/static/uploads/a.png)\n\n结尾"
    text = to_plain_text(md, limit=200)
    assert "print" not in text
    assert "/static/uploads/a.png" not in text
    assert text.startswith("开头")
    assert text.endswith("结尾")


def test_truncates_to_limit_and_collapses_blank():
    assert len(to_plain_text("一" * 200, limit=80)) == 80
    assert to_plain_text("a\n\n\n b", limit=80) == "a b"
    assert to_plain_text("", limit=80) == ""
    assert to_plain_text(None, limit=80) == ""


def test_strips_raw_html_tags():
    assert "<script>" not in to_plain_text("<script>alert(1)</script>正文", limit=80)
```

- [x] 创建 `core/markdown.py`：

```python
import re

CODE_FENCE_RE = re.compile(r"```.*?```", re.S)
INLINE_CODE_RE = re.compile(r"`[^`]*`")
IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s*", re.M)
QUOTE_RE = re.compile(r"^\s{0,3}>\s?", re.M)
LIST_RE = re.compile(r"^\s{0,3}([-*+]|\d+\.)\s+", re.M)
EMPHASIS_RE = re.compile(r"(\*\*|__|\*|_|~~)")
HTML_TAG_RE = re.compile(r"<[^>]+>")
BLANK_RE = re.compile(r"\s+")


def to_plain_text(md, limit=80):
    """剥离常见 Markdown 语法与原始 HTML 标签，供列表摘要使用。

    注意：本函数只用于生成纯文本摘要，不承担安全清洗职责；
    面向浏览器的渲染与清洗在 static/js/markdown.js 中由 DOMPurify 完成。
    """
    if not md:
        return ""
    text = CODE_FENCE_RE.sub(" ", md)
    text = INLINE_CODE_RE.sub(" ", text)
    text = IMAGE_RE.sub(" ", text)
    text = LINK_RE.sub(r"\1", text)
    text = HEADING_RE.sub("", text)
    text = QUOTE_RE.sub("", text)
    text = LIST_RE.sub("", text)
    text = EMPHASIS_RE.sub("", text)
    text = HTML_TAG_RE.sub(" ", text)
    text = BLANK_RE.sub(" ", text).strip()
    return text[:limit]
```

- [x] 在 `core/validators.py` 追加：

```python
WRITABLE_STATUSES = ("draft", "private")


def validate_note_status_for_write(status):
    """笔记写入接口（创建/更新）只接受 draft 与 private；
    public 只能由 POST /notes/<id>/share 进入。"""
    if status not in WRITABLE_STATUSES:
        return False, "INVALID_PARAM"
    return True, None


def validate_search_keyword(q):
    if q is None:
        return True, None
    if not isinstance(q, str):
        return False, "INVALID_PARAM"
    if len(q) > 100:
        return False, "CONTENT_TOO_LONG"
    return True, None
```

- [x] 创建 `tests/test_notes_dao.py`，覆盖 DAO 层关键行为：

```python
import pytest

from core import db as db_module
from core.markdown import to_plain_text


@pytest.fixture()
def alice_id(app):
    with app.app_context():
        conn = db_module.get_db()
        conn.execute("INSERT INTO users (email, username, password_hash, created_at) "
                     "VALUES ('d@e.com','dao','x','2026-01-01T00:00:00Z')")
        conn.commit()
        return conn.execute("SELECT id FROM users WHERE username='dao'").fetchone()["id"]


def test_create_and_get_note_with_tags(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        note_id = db_module.create_note(conn, alice_id, "标题", "正文", "draft", ["生活", "work"])
        row = db_module.get_note(conn, note_id)
        assert row["status"] == "draft"
        assert row["published_at"] is None
        assert sorted(db_module.get_note_tags(conn, note_id)) == ["work", "生活"]


def test_publishing_sets_published_at_once(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        note_id = db_module.create_note(conn, alice_id, "t", "c", "draft", [])
        db_module.update_note(conn, note_id, status="private")
        first = db_module.get_note(conn, note_id)["published_at"]
        assert first is not None
        db_module.update_note(conn, note_id, title="t2")
        assert db_module.get_note(conn, note_id)["published_at"] == first


def test_set_note_tags_replaces_previous_binding(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        note_id = db_module.create_note(conn, alice_id, "t", "c", "draft", ["a", "b"])
        db_module.set_note_tags(conn, note_id, ["b", "c"])
        assert sorted(db_module.get_note_tags(conn, note_id)) == ["b", "c"]


def test_soft_delete_hides_from_get_and_list(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        note_id = db_module.create_note(conn, alice_id, "t", "c", "draft", [])
        db_module.soft_delete_note(conn, note_id)
        assert db_module.get_note(conn, note_id)["is_deleted"] == 1
        rows, total = db_module.list_notes(conn, alice_id)
        assert total == 0 and rows == []


def test_search_escapes_wildcards(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        db_module.create_note(conn, alice_id, "100% 折扣", "内容", "private", [])
        db_module.create_note(conn, alice_id, "1000 元", "内容", "private", [])
        rows, total = db_module.list_notes(conn, alice_id, q="100%")
        assert total == 1
        assert rows[0]["title"] == "100% 折扣"


def test_list_returns_summary_source_content(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        db_module.create_note(conn, alice_id, "标题", "## 小标题\n\n这是摘要正文。", "private", [])
        rows, _ = db_module.list_notes(conn, alice_id)
        assert to_plain_text(rows[0]["content_md"]) == "小标题 这是摘要正文。"
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_markdown.py tests/test_notes_dao.py -v
```

  - Expected: FAIL（`core.markdown` 与笔记 DAO 尚不存在）

- [x] 在 `core/db.py` 追加笔记与标签 DAO：

```python
def create_note(conn, user_id, title, content_md, status, tags):
    now = now_iso()
    published_at = None if status == "draft" else now
    cursor = conn.execute(
        "INSERT INTO notes (user_id, title, content_md, status, created_at, updated_at, published_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, title, content_md, status, now, now, published_at),
    )
    note_id = cursor.lastrowid
    set_note_tags(conn, note_id, tags)
    conn.commit()
    return note_id


def update_note(conn, note_id, title=None, content_md=None, status=None, tags=None):
    fields = ["updated_at = ?"]
    values = [now_iso()]
    if title is not None:
        fields.append("title = ?"); values.append(title)
    if content_md is not None:
        fields.append("content_md = ?"); values.append(content_md)
    if status is not None:
        fields.append("status = ?"); values.append(status)
        if status != "draft":
            fields.append("published_at = COALESCE(published_at, ?)"); values.append(now_iso())
    values.append(note_id)
    conn.execute(f"UPDATE notes SET {', '.join(fields)} WHERE id = ?", values)
    if tags is not None:
        set_note_tags(conn, note_id, tags)
    conn.commit()


def soft_delete_note(conn, note_id):
    conn.execute("UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?",
                 (now_iso(), note_id))
    conn.commit()


def get_note(conn, note_id):
    return conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()


def set_note_tags(conn, note_id, tags):
    conn.execute("DELETE FROM note_tags WHERE note_id = ?", (note_id,))
    for name in tags:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
        tag_id = conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()["id"]
        conn.execute("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)",
                     (note_id, tag_id))
    conn.commit()


def get_note_tags(conn, note_id):
    rows = conn.execute(
        "SELECT t.name AS name FROM tags t "
        "JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name",
        (note_id,),
    ).fetchall()
    return [r["name"] for r in rows]


def list_notes(conn, user_id, status="all", q=None, tag=None, sort="updated",
               page=1, page_size=10):
    where = ["n.user_id = ?", "n.is_deleted = 0"]
    params = [user_id]
    if status and status != "all":
        where.append("n.status = ?"); params.append(status)
    if q:
        where.append("(n.title LIKE ? ESCAPE '\\' OR n.content_md LIKE ? ESCAPE '\\')")
        escaped = (q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))
        params.extend([f"%{escaped}%", f"%{escaped}%"])
    if tag:
        where.append("EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id "
                     "WHERE nt.note_id = n.id AND t.name = ?)")
        params.append(tag)

    order = {"updated": "n.updated_at DESC", "created": "n.created_at DESC"}.get(
        sort, "n.updated_at DESC")
    where_sql = " AND ".join(where)

    total = conn.execute(f"SELECT COUNT(*) AS n FROM notes n WHERE {where_sql}",
                         params).fetchone()["n"]
    rows = conn.execute(
        f"SELECT n.* FROM notes n WHERE {where_sql} ORDER BY {order} LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    ).fetchall()
    return rows, total


def get_user_tags(conn, user_id):
    return conn.execute(
        "SELECT t.name AS name, COUNT(DISTINCT nt.note_id) AS count "
        "FROM tags t JOIN note_tags nt ON nt.tag_id = t.id JOIN notes n ON n.id = nt.note_id "
        "WHERE n.user_id = ? AND n.is_deleted = 0 "
        "GROUP BY t.id ORDER BY count DESC, t.name ASC",
        (user_id,),
    ).fetchall()
```

**Security/Boundary Notes:**
- `order` 与 `where` 片段只来自代码内常量，用户输入一律经 `?` 传入；排序字段用白名单字典映射，不接受原始字符串。
- `q` 中的 `%`、`_`、`\` 被转义并配合 `ESCAPE '\'`，避免用户用通配符枚举全部笔记。
- `set_note_tags` 会先解绑再重建，保证标签与笔记状态一致；`INSERT OR IGNORE` 让 `tags` 表保持全局去重。

**Dependencies:** Phase 3 Task 1

---

## Task 2: 笔记 CRUD 接口

**Goal:** 交付创建、读取、更新、删除四个接口，并落实归属校验与三态写入规则。

**Files:**
- Create: `api/notes.py`
- Test: `tests/test_notes_api.py`

**Steps:**

- [x] 创建 `tests/test_notes_api.py`：

```python
def test_create_draft(alice):
    c, headers = alice
    resp = c.post("/api/notes", json={
        "title": "读书笔记", "content_md": "# 一\n内容", "tags": ["阅读"], "status": "draft"},
        headers=headers)
    body = resp.get_json()
    assert resp.status_code == 200 and body["code"] == "OK"
    note = body["data"]["note"]
    assert note["status"] == "draft"
    assert note["published_at"] is None
    assert note["tags"] == ["阅读"]


def test_create_published_sets_published_at(alice):
    c, headers = alice
    note = c.post("/api/notes", json={"title": "t", "content_md": "c", "status": "private"},
                  headers=headers).get_json()["data"]["note"]
    assert note["status"] == "private" and note["published_at"] is not None


def test_create_rejects_public_status(alice):
    c, headers = alice
    resp = c.post("/api/notes", json={"title": "t", "content_md": "c", "status": "public"},
                  headers=headers)
    assert resp.get_json()["code"] == "INVALID_PARAM"


def test_create_rejects_too_many_tags(alice):
    c, headers = alice
    resp = c.post("/api/notes", json={"title": "t", "content_md": "c", "status": "draft",
                                      "tags": ["a", "b", "c", "d", "e", "f"]}, headers=headers)
    assert resp.get_json()["code"] == "TAG_TOO_MANY"


def test_create_rejects_oversize_title_and_content(alice):
    c, headers = alice
    assert c.post("/api/notes", json={"title": "x" * 201, "content_md": "c", "status": "draft"},
                  headers=headers).get_json()["code"] == "CONTENT_TOO_LONG"
    assert c.post("/api/notes", json={"title": "t", "content_md": "x" * 100001,
                                      "status": "draft"}, headers=headers
                  ).get_json()["code"] == "CONTENT_TOO_LONG"


def test_create_requires_login(client):
    resp = client.post("/api/notes", json={"title": "t", "content_md": "c", "status": "draft"})
    assert resp.status_code == 401


def test_detail_returns_content_and_share_fields_for_owner(alice):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "t", "content_md": "正文", "status": "private"},
                     headers=headers).get_json()["data"]["note"]["id"]
    note = c.get(f"/api/notes/{note_id}").get_json()["data"]["note"]
    assert note["content_md"] == "正文"
    assert note["share_token"] is None
    assert note["has_share_password"] is False


def test_other_user_cannot_read_update_or_delete(alice, bob_raw):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "私有", "content_md": "机密", "status": "private"},
                     headers=headers).get_json()["data"]["note"]["id"]
    other, other_headers = bob_raw

    assert other.get(f"/api/notes/{note_id}").status_code == 404
    assert other.get(f"/api/notes/{note_id}").get_json()["code"] == "NOT_FOUND"
    assert other.put(f"/api/notes/{note_id}", json={"title": "篡改"},
                     headers=other_headers).get_json()["code"] == "NOT_FOUND"
    assert other.delete(f"/api/notes/{note_id}", headers=other_headers
                        ).get_json()["code"] == "NOT_FOUND"


def test_update_changes_fields_and_bumps_updated_at(alice):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "旧", "content_md": "c", "status": "draft",
                                         "tags": ["a"]}, headers=headers
                     ).get_json()["data"]["note"]["id"]
    before = c.get(f"/api/notes/{note_id}").get_json()["data"]["note"]["updated_at"]
    updated = c.put(f"/api/notes/{note_id}",
                    json={"title": "新", "tags": ["b", "c"], "status": "private"},
                    headers=headers).get_json()["data"]["note"]
    assert updated["title"] == "新"
    assert updated["tags"] == ["b", "c"]
    assert updated["status"] == "private"
    assert updated["updated_at"] >= before


def test_update_rejects_public_status(alice):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "t", "content_md": "c", "status": "draft"},
                     headers=headers).get_json()["data"]["note"]["id"]
    assert c.put(f"/api/notes/{note_id}", json={"status": "public"},
                 headers=headers).get_json()["code"] == "INVALID_PARAM"


def test_delete_is_soft_and_hides_note(alice):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "t", "content_md": "c", "status": "draft"},
                     headers=headers).get_json()["data"]["note"]["id"]
    assert c.delete(f"/api/notes/{note_id}", headers=headers).get_json()["code"] == "OK"
    assert c.get(f"/api/notes/{note_id}").status_code == 404
    assert c.get("/api/notes").get_json()["data"]["total"] == 0


def test_already_deleted_returns_not_found(alice):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "t", "content_md": "c", "status": "draft"},
                     headers=headers).get_json()["data"]["note"]["id"]
    c.delete(f"/api/notes/{note_id}", headers=headers)
    assert c.delete(f"/api/notes/{note_id}", headers=headers).get_json()["code"] == "NOT_FOUND"
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_notes_api.py -v
```

  - Expected: FAIL（无 `api.notes` 模块）

- [x] 创建 `api/notes.py`：

```python
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, login_required
from core.markdown import to_plain_text
from core.response import fail, ok
from core.validators import (parse_pagination, validate_content,
                             validate_note_status_for_write, validate_search_keyword,
                             validate_status, validate_tags, validate_title)

bp = Blueprint("notes", __name__, url_prefix="/api/notes")


def note_to_dict(row, tags, include_content=True, include_share=False, summary_limit=80):
    data = {
        "id": row["id"],
        "title": row["title"],
        "status": row["status"],
        "tags": tags,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "published_at": row["published_at"],
    }
    if include_content:
        data["content_md"] = row["content_md"]
    else:
        data["summary"] = to_plain_text(row["content_md"], limit=summary_limit)
    if include_share:
        data["share_token"] = row["share_token"]
        data["has_share_password"] = row["share_password_hash"] is not None
    return data


def load_owned_note(note_id):
    """返回当前用户拥有的、未删除的笔记；否则 None。"""
    note = db_module.get_note(db_module.get_db(), note_id)
    if note is None or note["is_deleted"]:
        return None
    if note["user_id"] != current_user()["id"]:
        return None
    return note


@bp.post("")
@login_required
def create_note():
    payload = request.get_json(silent=True) or {}
    title = payload.get("title") or ""
    content_md = payload.get("content_md") or ""
    status = payload.get("status") or "draft"
    tags = payload.get("tags")

    for validator, value in ((validate_title, title),
                             (validate_content, content_md),
                             (validate_note_status_for_write, status)):
        passed, code = validator(value)
        if not passed:
            return fail(code)
    passed, result = validate_tags(tags)
    if not passed:
        return fail(result)

    conn = db_module.get_db()
    note_id = db_module.create_note(conn, current_user()["id"], title, content_md, status, result)
    row = db_module.get_note(conn, note_id)
    return ok({"note": note_to_dict(row, db_module.get_note_tags(conn, note_id),
                                    include_share=True)}, "已保存")


@bp.get("")
@login_required
def list_notes():
    args = request.args
    status = args.get("status") or "all"
    if status != "all":
        passed, code = validate_status(status)
        if not passed:
            return fail(code)
    passed, code = validate_search_keyword(args.get("q"))
    if not passed:
        return fail(code)

    sort = args.get("sort") or "updated"
    if sort not in ("updated", "created"):
        return fail("INVALID_PARAM")

    page, page_size = parse_pagination(args, default=10, maximum=50)
    conn = db_module.get_db()
    rows, total = db_module.list_notes(
        conn, current_user()["id"], status=status, q=args.get("q"),
        tag=args.get("tag") or None, sort=sort, page=page, page_size=page_size)

    items = [note_to_dict(r, db_module.get_note_tags(conn, r["id"]), include_content=False)
             for r in rows]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


@bp.get("/<int:note_id>")
@login_required
def get_note_detail(note_id):
    conn = db_module.get_db()
    note = db_module.get_note(conn, note_id)
    if note is None or note["is_deleted"]:
        return fail("NOT_FOUND")

    if note["user_id"] != current_user()["id"]:
        # Phase 6 在此追加「分享已开启且当前会话已解锁」分支
        return fail("NOT_FOUND")

    return ok({"note": note_to_dict(note, db_module.get_note_tags(conn, note_id),
                                    include_share=True)})


@bp.put("/<int:note_id>")
@login_required
def update_note(note_id):
    note = load_owned_note(note_id)
    if note is None:
        return fail("NOT_FOUND")

    payload = request.get_json(silent=True) or {}
    title = payload.get("title")
    content_md = payload.get("content_md")
    status = payload.get("status")
    tags = payload.get("tags")

    for validator, value in ((validate_title, title if title is not None else ""),
                             (validate_content, content_md if content_md is not None else "")):
        if value is not None:
            passed, code = validator(value)
            if not passed:
                return fail(code)
    if status is not None:
        passed, code = validate_note_status_for_write(status)
        if not passed:
            return fail(code)
    if tags is not None:
        passed, result = validate_tags(tags)
        if not passed:
            return fail(result)
    else:
        result = None

    conn = db_module.get_db()
    db_module.update_note(conn, note_id, title=title, content_md=content_md,
                          status=status, tags=result)
    row = db_module.get_note(conn, note_id)
    return ok({"note": note_to_dict(row, db_module.get_note_tags(conn, note_id),
                                    include_share=True)}, "已保存")


@bp.delete("/<int:note_id>")
@login_required
def delete_note(note_id):
    if load_owned_note(note_id) is None:
        return fail("NOT_FOUND")
    db_module.soft_delete_note(db_module.get_db(), note_id)
    return ok(None, "已删除")
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_notes_api.py -v
```

  - Expected: 12 个用例全部 passed

**Security/Boundary Notes:**
- 非本人访问一律返回 `NOT_FOUND`（不返回 `FORBIDDEN`），避免通过状态码探测他人笔记是否存在；这与需求文档「错误处理」表中「资源不存在或非本人笔记 → `NOT_FOUND`」一致。
- `public` 状态无法通过本接口写入，杜绝「有公开状态但无分享 token」的孤儿状态。
- 软删除后重复删除返回 `NOT_FOUND`，避免通过响应差异判断删除时间。

**Dependencies:** Task 1、Phase 3 Task 2/3

---

## Task 3: 列表筛选、搜索、排序与分页

**Goal:** 验证列表接口的查询语义与分页边界，并确保列表不泄露正文。

**Files:**
- Test: `tests/test_notes_list.py`

**Steps:**

- [x] 创建 `tests/test_notes_list.py`：

```python
def _seed(c, headers):
    ids = {}
    ids["draft"] = c.post("/api/notes", json={
        "title": "草稿标题", "content_md": "草稿正文", "status": "draft",
        "tags": ["未完成"]}, headers=headers).get_json()["data"]["note"]["id"]
    ids["private1"] = c.post("/api/notes", json={
        "title": "健身计划", "content_md": "每周三次", "status": "private",
        "tags": ["生活"]}, headers=headers).get_json()["data"]["note"]["id"]
    ids["private2"] = c.post("/api/notes", json={
        "title": "工作周报", "content_md": "本周完成**三项**任务", "status": "private",
        "tags": ["工作", "生活"]}, headers=headers).get_json()["data"]["note"]["id"]
    return ids


def test_list_hides_content_md_and_returns_summary(alice):
    c, headers = alice
    _seed(c, headers)
    items = c.get("/api/notes").get_json()["data"]["items"]
    assert items and all("content_md" not in item for item in items)
    assert all("summary" in item for item in items)
    assert all("share_token" not in item for item in items)


def test_list_returns_only_own_notes(alice, bob_raw):
    c, headers = alice
    _seed(c, headers)
    other, _ = bob_raw
    assert other.get("/api/notes").get_json()["data"]["total"] == 0


def test_status_filter(alice):
    c, headers = alice
    _seed(c, headers)
    assert c.get("/api/notes?status=draft").get_json()["data"]["total"] == 1
    assert c.get("/api/notes?status=private").get_json()["data"]["total"] == 2
    assert c.get("/api/notes?status=all").get_json()["data"]["total"] == 3
    assert c.get("/api/notes?status=bogus").get_json()["code"] == "INVALID_PARAM"


def test_keyword_search_matches_title_and_content(alice):
    c, headers = alice
    _seed(c, headers)
    assert c.get("/api/notes?q=周报").get_json()["data"]["total"] == 1
    assert c.get("/api/notes?q=每周三次").get_json()["data"]["total"] == 1
    assert c.get("/api/notes?q=不存在的内容").get_json()["data"]["total"] == 0


def test_tag_filter(alice):
    c, headers = alice
    _seed(c, headers)
    assert c.get("/api/notes?tag=生活").get_json()["data"]["total"] == 2
    assert c.get("/api/notes?tag=工作").get_json()["data"]["total"] == 1
    assert c.get("/api/notes?tag=不存在的标签").get_json()["data"]["total"] == 0


def test_combined_filters(alice):
    c, headers = alice
    _seed(c, headers)
    data = c.get("/api/notes?status=private&tag=生活&q=周报").get_json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["title"] == "工作周报"


def test_sort_by_created_and_updated(alice):
    c, headers = alice
    ids = _seed(c, headers)
    c.put(f"/api/notes/{ids['draft']}", json={"title": "草稿标题（已更新）"}, headers=headers)
    by_updated = c.get("/api/notes?sort=updated").get_json()["data"]["items"]
    assert by_updated[0]["id"] == ids["draft"]
    by_created = c.get("/api/notes?sort=created").get_json()["data"]["items"]
    assert by_created[0]["id"] == ids["private2"]
    assert c.get("/api/notes?sort=bogus").get_json()["code"] == "INVALID_PARAM"


def test_pagination_shape_and_bounds(alice):
    c, headers = alice
    for i in range(12):
        c.post("/api/notes", json={"title": f"笔记{i}", "content_md": "c", "status": "private"},
               headers=headers)
    first = c.get("/api/notes?page=1&page_size=5").get_json()["data"]
    assert first["total"] == 12 and len(first["items"]) == 5
    assert first["page"] == 1 and first["page_size"] == 5
    third = c.get("/api/notes?page=3&page_size=5").get_json()["data"]
    assert len(third["items"]) == 2
    empty = c.get("/api/notes?page=99&page_size=5").get_json()["data"]
    assert empty["items"] == [] and empty["total"] == 12


def test_pagination_clamps_invalid_values(alice):
    c, headers = alice
    data = c.get("/api/notes?page=0&page_size=999").get_json()["data"]
    assert data["page"] == 1 and data["page_size"] == 50
    clamped = c.get("/api/notes?page=abc&page_size=xyz").get_json()["data"]
    assert clamped["page"] == 1 and clamped["page_size"] == 10


def test_search_keyword_too_long(alice):
    c, headers = alice
    assert c.get("/api/notes?q=" + "x" * 101).get_json()["code"] == "CONTENT_TOO_LONG"


def test_list_requires_login(client):
    assert client.get("/api/notes").status_code == 401
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_notes_list.py -v
```

  - Expected: 11 个用例全部 passed（Task 2、Task 1 已实现全部逻辑；本任务用于固化查询语义，若有用例失败则回到 Task 1 修正 DAO）

- [x] 若 `test_sort_by_created_and_updated` 因同秒创建导致顺序不稳定而失败，在 `create_note` 的 `now_iso()` 之外补一个自增序号不作方案，改为在测试内用 `time.sleep(1.05)` 分隔创建时刻；**不要**改动时间格式（全项目统一秒级 ISO8601）。

**Security/Boundary Notes:** 列表接口为 `GET`，必须无副作用：不得写入浏览足迹（足迹只由详情与分享页写入，见 Phase 7）。

**Dependencies:** Task 1、Task 2

---

## Task 4: 标签接口

**Goal:** 交付当前用户标签及计数，供筛选下拉与编辑器标签联想使用。

**Files:**
- Create: `api/tags.py`
- Test: `tests/test_tags_api.py`

**Steps:**

- [x] 创建 `tests/test_tags_api.py`：

```python
def test_tags_counts_only_own_live_notes(alice, bob_raw):
    c, headers = alice
    c.post("/api/notes", json={"title": "a", "content_md": "c", "status": "private",
                               "tags": ["生活", "工作"]}, headers=headers)
    c.post("/api/notes", json={"title": "b", "content_md": "c", "status": "private",
                               "tags": ["生活"]}, headers=headers)
    items = c.get("/api/tags").get_json()["data"]["items"]
    assert items[0] == {"name": "生活", "count": 2}
    assert {"name": "工作", "count": 1} in items

    other, _ = bob_raw
    assert other.get("/api/tags").get_json()["data"]["items"] == []


def test_deleted_note_tags_are_excluded(alice):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "a", "content_md": "c", "status": "private",
                                         "tags": ["临时"]}, headers=headers
                     ).get_json()["data"]["note"]["id"]
    assert c.get("/api/tags").get_json()["data"]["items"] == [{"name": "临时", "count": 1}]
    c.delete(f"/api/notes/{note_id}", headers=headers)
    assert c.get("/api/tags").get_json()["data"]["items"] == []


def test_tags_requires_login(client):
    assert client.get("/api/tags").status_code == 401
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_tags_api.py -v
```

  - Expected: FAIL（无 `api.tags` 模块）

- [x] 创建 `api/tags.py`：

```python
from flask import Blueprint

from core import db as db_module
from core.auth import current_user, login_required
from core.response import ok

bp = Blueprint("tags", __name__, url_prefix="/api/tags")


@bp.get("")
@login_required
def list_tags():
    rows = db_module.get_user_tags(db_module.get_db(), current_user()["id"])
    return ok({"items": [{"name": r["name"], "count": r["count"]} for r in rows]})
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_tags_api.py -v
```

  - Expected: 3 个用例全部 passed

**Dependencies:** Task 1

---

## Task 5: 图片上传接口

**Goal:** 交付带白名单、真实解码校验、UUID 重命名与配额限制的图片上传接口。

**Files:**
- Create: `api/uploads.py`
- Modify: `core/db.py`（追加 `current_app_config` 之外的用量统计不需要入库，无需改动）
- Test: `tests/test_uploads_api.py`

**Steps:**

- [x] 创建 `tests/test_uploads_api.py`：

```python
import io

from PIL import Image


def make_image(fmt="PNG", size=(4, 4)):
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 160, 120)).save(buf, format=fmt)
    buf.seek(0)
    return buf


def upload(c, headers, buf, filename):
    return c.post("/api/uploads/image", data={"file": (buf, filename)},
                  headers=headers, content_type="multipart/form-data")


def test_upload_png_succeeds_and_is_referencable(app, alice):
    c, headers = alice
    resp = upload(c, headers, make_image("PNG"), "photo.png")
    body = resp.get_json()
    assert resp.status_code == 200 and body["code"] == "OK"
    url = body["data"]["url"]
    assert url.startswith("/static/uploads/") and url.endswith(".png")
    assert c.get(url).status_code == 200


def test_upload_ignores_client_extension_and_uses_real_format(app, alice):
    c, headers = alice
    url = upload(c, headers, make_image("WEBP"), "trick.jpg").get_json()["data"]["url"]
    assert url.endswith(".webp")


def test_upload_rejects_disguised_non_image(app, alice):
    c, headers = alice
    resp = upload(c, headers, io.BytesIO(b"这不是图片"), "fake.png")
    assert resp.status_code == 400
    assert resp.get_json()["code"] == "UPLOAD_TYPE_INVALID"


def test_upload_rejects_disallowed_format(app, alice):
    c, headers = alice
    resp = upload(c, headers, make_image("BMP"), "image.bmp")
    assert resp.get_json()["code"] == "UPLOAD_TYPE_INVALID"


def test_upload_too_large(app, alice):
    c, headers = alice
    app.config["MAX_CONTENT_LENGTH"] = 2048
    resp = upload(c, headers, make_image("PNG", (200, 200)), "big.png")
    assert resp.status_code == 413
    assert resp.get_json()["code"] == "UPLOAD_TOO_LARGE"


def test_upload_quota_exceeded(app, alice):
    c, headers = alice
    app.config["USER_UPLOAD_QUOTA"] = 10
    resp = upload(c, headers, make_image("PNG"), "quota.png")
    assert resp.status_code == 413
    assert resp.get_json()["code"] == "STORAGE_QUOTA_EXCEEDED"


def test_upload_requires_login(client):
    resp = client.post("/api/uploads/image", data={"file": (make_image(), "a.png")},
                       content_type="multipart/form-data")
    assert resp.status_code == 401


def test_upload_requires_file_field(alice):
    c, headers = alice
    assert c.post("/api/uploads/image", data={}, headers=headers,
                  content_type="multipart/form-data").get_json()["code"] == "INVALID_PARAM"


def test_uploads_are_namespaced_per_user(app, alice):
    c, headers = alice
    url = upload(c, headers, make_image("PNG"), "a.png").get_json()["data"]["url"]
    assert url.split("/")[-1].startswith("u1-")
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_uploads_api.py -v
```

  - Expected: FAIL（无 `api.uploads` 模块）

- [x] 创建 `api/uploads.py`：

```python
import uuid
from pathlib import Path

from flask import Blueprint, current_app, request
from PIL import Image, UnidentifiedImageError

from core.auth import current_user, login_required
from core.response import fail, ok

bp = Blueprint("uploads", __name__, url_prefix="/api/uploads")

FORMAT_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "GIF": ".gif", "WEBP": ".webp"}


def user_usage(upload_dir, user_id):
    """按文件名前缀 u{user_id}- 统计该用户已占用的字节数。"""
    prefix = f"u{user_id}-"
    total = 0
    for path in Path(upload_dir).glob(f"{prefix}*"):
        if path.is_file():
            total += path.stat().st_size
    return total


@bp.post("/image")
@login_required
def upload_image():
    file = request.files.get("file")
    if file is None or not file.filename:
        return fail("INVALID_PARAM")

    cfg = current_app.config
    upload_dir = Path(cfg["UPLOAD_DIR"])
    upload_dir.mkdir(parents=True, exist_ok=True)
    user_id = current_user()["id"]

    if user_usage(upload_dir, user_id) >= cfg["USER_UPLOAD_QUOTA"]:
        return fail("STORAGE_QUOTA_EXCEEDED")

    try:
        image = Image.open(file.stream)
        image.verify()
        fmt = image.format
    except (UnidentifiedImageError, OSError, ValueError):
        return fail("UPLOAD_TYPE_INVALID")

    extension = FORMAT_EXTENSIONS.get(fmt)
    if extension is None:
        return fail("UPLOAD_TYPE_INVALID")

    file.stream.seek(0)
    name = f"u{user_id}-{uuid.uuid4().hex}{extension}"
    target = upload_dir / name
    try:
        file.save(target)
    except OSError:
        return fail("INTERNAL_ERROR", "图片保存失败，请稍后重试", http_status=500)

    if user_usage(upload_dir, user_id) > cfg["USER_UPLOAD_QUOTA"]:
        target.unlink(missing_ok=True)
        return fail("STORAGE_QUOTA_EXCEEDED")

    return ok({"url": f"{cfg['UPLOAD_URL_PREFIX']}{name}"}, "上传成功")
```

  - 注：写入完成后再做一次 `user_usage(upload_dir, user_id) > cfg["USER_UPLOAD_QUOTA"]` 复核（此时统计已包含本次文件），不满足则删除刚写入的文件并返回 `STORAGE_QUOTA_EXCEEDED`；该二次校验用于覆盖并发写入绕过配额的情况。

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_uploads_api.py -v
```

  - Expected: 9 个用例全部 passed

- [x] 运行全量测试确认无回归：

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 全部 passed

**Security/Boundary Notes:**
- 扩展名由 Pillow 解码出的真实格式决定，忽略客户端文件名后缀，防「改后缀伪装」。
- 每次上传都重新解码校验；`Image.open` 与 `verify()` 失败一律返回 `UPLOAD_TYPE_INVALID`，不泄露解码错误细节。
- 文件名使用 `u{user_id}-{uuid4().hex}{ext}`，既保证不可猜测、不可覆盖，又让配额统计无需额外数据表。
- 上传目录必须按静态资源目录挂载，禁止在部署中开启脚本执行（已写入 Phase 8 的部署检查项）。

**Dependencies:** Task 1、Phase 3 Task 2/3

---

## Phase Completion Checklist

- [x] 全部 5 个任务完成
- [x] `.venv/Scripts/python.exe -m pytest tests/ -v` 全部通过（新增 `test_markdown.py`、`test_notes_dao.py`、`test_notes_api.py`、`test_notes_list.py`、`test_tags_api.py`、`test_uploads_api.py`）
- [x] 笔记创建/读取/更新/删除/筛选/搜索/排序/分页在接口层全部可用
- [x] 用户 B 无法读取、修改、删除用户 A 的任何笔记（返回 `NOT_FOUND`）
- [x] `status=public` 无法通过创建或更新接口写入
- [x] 列表响应不含 `content_md` 与 `share_token`，只含 `summary`
- [x] 上传接口通过白名单、真实解码、体积、配额四类校验
- [x] `db/app.db` 中不产生测试残留（测试使用临时库）
- [x] 可以进入 Phase 5

---

## 执行记录（主智能体验证）

- **执行日期**：2026-10-08
- **验证命令与结果**：`.venv/Scripts/python.exe -m pytest tests/ -q` → **191 passed**
  （Phase 3 的 146 项 + 本阶段新增 45 项：markdown 4、notes DAO 6、notes API 12、
  notes list 11、tags 3、uploads 9）。
- **范围隔离抽查**：`git status --short static tests/manual` → 无改动；本阶段未触碰任何前端文件。
- **跨阶段边界抽查**：`grep -n "is_share_unlocked\|mark_share_unlocked" api/notes.py` → 无命中，
  未提前引用 Phase 6 的分享解锁态；`get_note_detail` 中保留了 `# Phase 6 在此追加…` 标记注释。
- **数据库隔离抽查**：`db/app.db` 时间戳未变（测试全部使用 `tmp_path` 临时库）。

**主智能体补充修正（本阶段验证中发现）**

1. **上传测试污染真实上传目录**：`tests/test_uploads_api.py` 直接写入 `static/uploads/`，每轮运行
   都会留下 `u1-*.png` / `u1-*.webp` 残留（本次发现 3 个）。这些残留虽被 `.gitignore` 忽略，但会
   让后续「配额超限」用例跨次耦合，并污染开发者本地的真实上传目录。
   已新增 `clean_uploads` autouse 夹具：用例前记录既有 `u*-*` 文件集合，用例后删除本次新增的文件。
   连续运行两次 `tests/test_uploads_api.py` 均 9 passed，且 `static/uploads/` 只剩 `.gitkeep`。
   未改为临时目录，因为用例需要断言返回的 `/static/uploads/<name>` 可由静态路由取回（200）。

**子智能体的偏差（主智能体已复核接受，均针对阶段文件自身的缺陷）**

1. `tests/test_uploads_api.py` 中 `io.BytesIO(b"这不是图片")` 是非法 Python 字面量
   （`SyntaxError: bytes can only contain ASCII literal characters`），语法错误不构成有效 RED。
   已改为 `io.BytesIO("这不是图片".encode("utf-8"))`，等价语义。
2. `test_upload_too_large` 的上限 2048 字节永远触发不了 413：纯色 200×200 PNG 压缩后仅 592 字节，
   multipart 请求体 834 字节。已把该用例内的上限改为 512（低于实际请求体），保留原意。
3. `test_sort_by_created_and_updated` 采纳阶段文件第 764 行预告的既定回退方案，为 `_seed` 增加
   可选 `delay` 参数并在该用例用 `delay=1.05` 分隔创建时刻，使秒级时间戳严格递增。
   **未改动时间格式**（仍为全项目统一的秒级 ISO8601）。该用例已重复 5 次确认稳定。

**遗留风险**

1. `test_sort_by_created_and_updated` 依赖 1.05s 睡眠，使该用例约增加 2.1s 运行时间；
   `test_upload_too_large` 的 512 上限与约 834 字节请求体耦合，改动图片尺寸时需同步调整。
2. `GET /api/notes` 对非本人笔记的可见性分支尚未实现（Phase 6 补齐），当前非作者一律 `NOT_FOUND`。
3. Phase 2 遗留的 `:focus-visible` 焦点环对比度（2.85:1 < 3:1）仍待 Phase 8 决策。

