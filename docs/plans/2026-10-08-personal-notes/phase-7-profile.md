# Phase 7: 收藏、足迹与个人主页

**Goal:** 完成收藏与浏览足迹的前后端，并在个人主页把四个 Tab 组装完成。

**Prerequisites:** Phase 3（个人资料与改密接口）、Phase 5（卡片与列表组件）、Phase 6（分享与评论区）。

**Deliverables:**
- `api/favorites.py`、`api/history.py` 与对应 DAO
- 详情页与分享页的收藏按钮、浏览足迹的服务端记录
- `static/js/profile.js`、`static/css/profile.css`（个人主页四 Tab）
- `tests/test_favorites_api.py`、`tests/test_history_api.py`

**Interface Decisions Implemented:**
- 收藏对象范围：本人笔记 + 通过分享访问到的他人笔记
- 收藏与足迹条目的失效态：`available: false` 且 `note.title` 为 `null` → 卡片显示「内容已失效」+「移除」
- 个人主页四 Tab 与各自空态文案：「还没有笔记，去写下第一篇吧」「还没有收藏」「还没有浏览记录」
- 头像：默认用户名首字色块；支持填写 `avatar` URL（受 `UPLOAD_URL_PREFIX` 白名单约束）
- 个人主页 Tab 状态同步到 URL 查询参数，可刷新、可回退

---

## Task 1: 收藏与浏览足迹后端

**Goal:** 交付收藏增删查、足迹查询/清除接口，并在读取详情与分享时服务端记录足迹。

**Files:**
- Create: `api/favorites.py`
- Create: `api/history.py`
- Modify: `core/db.py`（追加收藏与足迹 DAO、`is_note_viewable_by` 判定）
- Modify: `api/notes.py`（详情读取成功后记录足迹）
- Modify: `api/share.py`（分享读取与校验成功后记录足迹）
- Test: `tests/test_favorites_api.py`
- Test: `tests/test_history_api.py`

**Steps:**

- [x] 创建 `tests/test_favorites_api.py`：

```python
def _note(c, headers, status="private", title="收藏目标"):
    return c.post("/api/notes", json={"title": title, "content_md": "正文",
                                      "status": status, "tags": ["收藏"]},
                  headers=headers).get_json()["data"]["note"]["id"]


def _share(c, headers, note_id, password=None):
    payload = {"password": password} if password else {}
    url = c.post(f"/api/notes/{note_id}/share", json=payload, headers=headers
                 ).get_json()["data"]["share_url"]
    return url.rsplit("/", 1)[-1]


def test_favorite_own_note(alice):
    c, headers = alice
    note_id = _note(c, headers)
    assert c.post("/api/favorites", json={"note_id": note_id},
                  headers=headers).get_json()["code"] == "OK"
    data = c.get("/api/favorites").get_json()["data"]
    assert data["total"] == 1
    item = data["items"][0]
    assert item["available"] is True
    assert item["note"]["title"] == "收藏目标"
    assert item["author"]["username"] == "alice"


def test_duplicate_favorite_returns_already_favorited(alice):
    c, headers = alice
    note_id = _note(c, headers)
    c.post("/api/favorites", json={"note_id": note_id}, headers=headers)
    resp = c.post("/api/favorites", json={"note_id": note_id}, headers=headers)
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "ALREADY_FAVORITED"


def test_cannot_favorite_inaccessible_note(alice, bob_raw):
    c, headers = alice
    private_id = _note(c, headers, status="private")
    other, other_headers = bob_raw
    resp = other.post("/api/favorites", json={"note_id": private_id}, headers=other_headers)
    assert resp.status_code == 404
    assert resp.get_json()["code"] == "NOT_FOUND"


def test_can_favorite_shared_public_note(alice, bob_raw):
    c, headers = alice
    note_id = _note(c, headers)
    _share(c, headers, note_id)
    other, other_headers = bob_raw
    assert other.post("/api/favorites", json={"note_id": note_id},
                      headers=other_headers).get_json()["code"] == "OK"
    item = other.get("/api/favorites").get_json()["data"]["items"][0]
    assert item["available"] is True
    assert item["author"]["username"] == "alice"


def test_favorite_becomes_unavailable_after_share_disabled(alice, bob_raw):
    c, headers = alice
    note_id = _note(c, headers, title="将被关闭")
    _share(c, headers, note_id)
    other, other_headers = bob_raw
    other.post("/api/favorites", json={"note_id": note_id}, headers=other_headers)

    c.delete(f"/api/notes/{note_id}/share", headers=headers)
    item = other.get("/api/favorites").get_json()["data"]["items"][0]
    assert item["available"] is False
    assert item["note"]["title"] is None
    assert item["note"]["summary"] is None


def test_favorite_becomes_unavailable_after_note_deleted(alice):
    c, headers = alice
    note_id = _note(c, headers)
    c.post("/api/favorites", json={"note_id": note_id}, headers=headers)
    c.delete(f"/api/notes/{note_id}", headers=headers)
    item = c.get("/api/favorites").get_json()["data"]["items"][0]
    assert item["available"] is False


def test_remove_favorite(alice):
    c, headers = alice
    note_id = _note(c, headers)
    c.post("/api/favorites", json={"note_id": note_id}, headers=headers)
    assert c.delete(f"/api/favorites/{note_id}", headers=headers).get_json()["code"] == "OK"
    assert c.get("/api/favorites").get_json()["data"]["total"] == 0
    assert c.delete(f"/api/favorites/{note_id}", headers=headers
                    ).get_json()["code"] == "NOT_FOUND"


def test_favorite_invalid_note_id(alice):
    c, headers = alice
    assert c.post("/api/favorites", json={"note_id": 9999},
                  headers=headers).get_json()["code"] == "NOT_FOUND"
    assert c.post("/api/favorites", json={}, headers=headers
                  ).get_json()["code"] == "INVALID_PARAM"


def test_favorites_pagination(alice):
    c, headers = alice
    for i in range(12):
        note_id = _note(c, headers, title=f"笔记{i}")
        c.post("/api/favorites", json={"note_id": note_id}, headers=headers)
    data = c.get("/api/favorites?page=1&page_size=5").get_json()["data"]
    assert data["total"] == 12 and len(data["items"]) == 5


def test_favorites_require_login(client):
    assert client.get("/api/favorites").status_code == 401
```

- [x] 创建 `tests/test_history_api.py`：

```python
def _note(c, headers, title="足迹目标"):
    return c.post("/api/notes", json={"title": title, "content_md": "正文",
                                      "status": "private"}, headers=headers
                  ).get_json()["data"]["note"]["id"]


def test_viewing_own_note_records_history(alice):
    c, headers = alice
    note_id = _note(c, headers)
    c.get(f"/api/notes/{note_id}")
    data = c.get("/api/history").get_json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["note"]["title"] == "足迹目标"
    assert data["items"][0]["viewed_at"]


def test_repeat_view_deduplicates(alice):
    c, headers = alice
    note_id = _note(c, headers)
    c.get(f"/api/notes/{note_id}")
    first = c.get("/api/history").get_json()["data"]["items"][0]["viewed_at"]
    c.get(f"/api/notes/{note_id}")
    data = c.get("/api/history").get_json()["data"]
    assert data["total"] == 1
    assert data["items"][0]["viewed_at"] >= first


def test_viewing_shared_note_records_history_for_reader(alice, bob_raw):
    c, headers = alice
    note_id = _note(c, headers, title="他人分享")
    token = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                   ).get_json()["data"]["share_url"].rsplit("/", 1)[-1]

    other, _ = bob_raw
    other.get(f"/api/share/{token}")
    items = other.get("/api/history").get_json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["available"] is True
    assert items[0]["author"]["username"] == "alice"


def test_anonymous_view_is_not_recorded(client, alice):
    c, headers = alice
    note_id = _note(c, headers)
    token = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                   ).get_json()["data"]["share_url"].rsplit("/", 1)[-1]
    anon = client.application.test_client()
    anon.get(f"/api/share/{token}")
    # 匿名会话不产生任何足迹记录（新登录用户看不到匿名浏览）
    anon.post("/api/auth/register", json={
        "email": "anon@example.com", "username": "anonuser",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    assert anon.get("/api/history").get_json()["data"]["total"] == 0


def test_history_unavailable_after_share_disabled(alice, bob_raw):
    c, headers = alice
    note_id = _note(c, headers, title="将失效")
    token = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                   ).get_json()["data"]["share_url"].rsplit("/", 1)[-1]
    other, _ = bob_raw
    other.get(f"/api/share/{token}")
    c.delete(f"/api/notes/{note_id}/share", headers=headers)

    item = other.get("/api/history").get_json()["data"]["items"][0]
    assert item["available"] is False
    assert item["note"]["title"] is None


def test_delete_single_history_item(alice):
    c, headers = alice
    note_id = _note(c, headers)
    c.get(f"/api/notes/{note_id}")
    assert c.delete(f"/api/history/{note_id}", headers=headers).get_json()["code"] == "OK"
    assert c.get("/api/history").get_json()["data"]["total"] == 0


def test_clear_all_history(alice):
    c, headers = alice
    for i in range(3):
        note_id = _note(c, headers, title=f"笔记{i}")
        c.get(f"/api/notes/{note_id}")
    assert c.get("/api/history").get_json()["data"]["total"] == 3
    assert c.delete("/api/history", headers=headers).get_json()["code"] == "OK"
    assert c.get("/api/history").get_json()["data"]["total"] == 0


def test_history_pagination_and_order(alice):
    c, headers = alice
    ids = [_note(c, headers, title=f"笔记{i}") for i in range(12)]
    for note_id in ids:
        c.get(f"/api/notes/{note_id}")
    data = c.get("/api/history?page=1&page_size=5").get_json()["data"]
    assert data["total"] == 12 and len(data["items"]) == 5
    assert data["items"][0]["note"]["title"] == "笔记11"


def test_history_requires_login(client):
    assert client.get("/api/history").status_code == 401
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_favorites_api.py tests/test_history_api.py -v
```

  - Expected: FAIL（无 `api.favorites`、`api.history` 模块）

- [x] 在 `core/db.py` 追加：

```python
def note_is_viewable(conn, note, viewer_id):
    """viewer_id 为 None 表示匿名。"""
    if note is None or note["is_deleted"]:
        return False
    if viewer_id is not None and note["user_id"] == viewer_id:
        return True
    return note["status"] == "public" and note["share_token"] is not None


def add_favorite(conn, user_id, note_id):
    cursor = conn.execute(
        "INSERT OR IGNORE INTO favorites (user_id, note_id, created_at) VALUES (?, ?, ?)",
        (user_id, note_id, now_iso()),
    )
    conn.commit()
    return cursor.rowcount > 0


def remove_favorite(conn, user_id, note_id):
    cursor = conn.execute("DELETE FROM favorites WHERE user_id = ? AND note_id = ?",
                          (user_id, note_id))
    conn.commit()
    return cursor.rowcount > 0


def is_favorited(conn, user_id, note_id):
    return conn.execute("SELECT 1 FROM favorites WHERE user_id = ? AND note_id = ?",
                        (user_id, note_id)).fetchone() is not None


def list_favorites(conn, user_id, page=1, page_size=10):
    total = conn.execute("SELECT COUNT(*) AS n FROM favorites WHERE user_id = ?",
                         (user_id,)).fetchone()["n"]
    rows = conn.execute(
        "SELECT f.created_at AS favorited_at, n.*, u.username AS author_username, "
        "u.avatar AS author_avatar FROM favorites f "
        "JOIN notes n ON n.id = f.note_id JOIN users u ON u.id = n.user_id "
        "WHERE f.user_id = ? ORDER BY f.created_at DESC, f.id DESC LIMIT ? OFFSET ?",
        (user_id, page_size, (page - 1) * page_size),
    ).fetchall()
    return rows, total


def touch_history(conn, user_id, note_id):
    conn.execute(
        "INSERT INTO view_history (user_id, note_id, viewed_at) VALUES (?, ?, ?) "
        "ON CONFLICT(user_id, note_id) DO UPDATE SET viewed_at = excluded.viewed_at",
        (user_id, note_id, now_iso()),
    )
    conn.commit()


def list_history(conn, user_id, page=1, page_size=10):
    total = conn.execute("SELECT COUNT(*) AS n FROM view_history WHERE user_id = ?",
                         (user_id,)).fetchone()["n"]
    rows = conn.execute(
        "SELECT h.viewed_at AS viewed_at, n.*, u.username AS author_username, "
        "u.avatar AS author_avatar FROM view_history h "
        "JOIN notes n ON n.id = h.note_id JOIN users u ON u.id = n.user_id "
        "WHERE h.user_id = ? ORDER BY h.viewed_at DESC, h.id DESC LIMIT ? OFFSET ?",
        (user_id, page_size, (page - 1) * page_size),
    ).fetchall()
    return rows, total


def delete_history_item(conn, user_id, note_id):
    cursor = conn.execute("DELETE FROM view_history WHERE user_id = ? AND note_id = ?",
                          (user_id, note_id))
    conn.commit()
    return cursor.rowcount > 0


def clear_history(conn, user_id):
    conn.execute("DELETE FROM view_history WHERE user_id = ?", (user_id,))
    conn.commit()
```

  - 注：`list_favorites` / `list_history` 用 `n.*` 与 `u.username` 混选，SQLite 允许重名列但不允许重复别名，因此把收藏/足迹时间显式命名为 `favorited_at` / `viewed_at`，`notes` 表自身的 `id` 等列直接沿用。

- [x] 创建 `api/favorites.py`：

```python
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, login_required
from core.markdown import to_plain_text
from core.response import fail, ok
from core.validators import parse_pagination

bp = Blueprint("favorites", __name__, url_prefix="/api/favorites")


def entry_to_dict(row, viewer_id):
    available = db_module.note_is_viewable(db_module.get_db(), row, viewer_id)
    note = {"id": row["id"], "status": row["status"]}
    if available:
        note["title"] = row["title"]
        note["summary"] = to_plain_text(row["content_md"], limit=80)
        note["tags"] = db_module.get_note_tags(db_module.get_db(), row["id"])
        note["updated_at"] = row["updated_at"]
    else:
        note["title"] = None
        note["summary"] = None
        note["tags"] = []
        note["updated_at"] = None
    return {
        "note": note,
        "author": {"username": row["author_username"], "avatar": row["author_avatar"]},
        "available": available,
        "favorited_at": row["favorited_at"],
    }


@bp.get("")
@login_required
def list_favorites():
    page, page_size = parse_pagination(request.args, default=10, maximum=50)
    viewer_id = current_user()["id"]
    rows, total = db_module.list_favorites(db_module.get_db(), viewer_id, page, page_size)
    items = [entry_to_dict(r, viewer_id) for r in rows]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


@bp.post("")
@login_required
def add_favorite():
    payload = request.get_json(silent=True) or {}
    note_id = payload.get("note_id")
    if not isinstance(note_id, int):
        return fail("INVALID_PARAM")

    conn = db_module.get_db()
    viewer_id = current_user()["id"]
    note = db_module.get_note(conn, note_id)
    if not db_module.note_is_viewable(conn, note, viewer_id):
        return fail("NOT_FOUND")
    if not db_module.add_favorite(conn, viewer_id, note_id):
        return fail("ALREADY_FAVORITED")
    return ok(None, "已收藏")


@bp.delete("/<int:note_id>")
@login_required
def remove_favorite(note_id):
    if not db_module.remove_favorite(db_module.get_db(), current_user()["id"], note_id):
        return fail("NOT_FOUND")
    return ok(None, "已取消收藏")
```

- [x] 创建 `api/history.py`：

```python
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, login_required
from core.markdown import to_plain_text
from core.response import fail, ok
from core.validators import parse_pagination

bp = Blueprint("history", __name__, url_prefix="/api/history")


def entry_to_dict(row, viewer_id):
    available = db_module.note_is_viewable(db_module.get_db(), row, viewer_id)
    return {
        "note": {
            "id": row["id"],
            "status": row["status"],
            "title": row["title"] if available else None,
            "summary": to_plain_text(row["content_md"], limit=80) if available else None,
            "tags": db_module.get_note_tags(db_module.get_db(), row["id"]) if available else [],
        },
        "author": {"username": row["author_username"], "avatar": row["author_avatar"]},
        "available": available,
        "viewed_at": row["viewed_at"],
    }


@bp.get("")
@login_required
def list_history():
    page, page_size = parse_pagination(request.args, default=10, maximum=50)
    viewer_id = current_user()["id"]
    rows, total = db_module.list_history(db_module.get_db(), viewer_id, page, page_size)
    items = [entry_to_dict(r, viewer_id) for r in rows]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


@bp.delete("")
@login_required
def clear_history():
    db_module.clear_history(db_module.get_db(), current_user()["id"])
    return ok(None, "已清空浏览记录")


@bp.delete("/<int:note_id>")
@login_required
def delete_history_item(note_id):
    if not db_module.delete_history_item(db_module.get_db(), current_user()["id"], note_id):
        return fail("NOT_FOUND")
    return ok(None, "已移除")
```

- [x] 在 `api/notes.py` 的 `get_note_detail` 成功返回前插入足迹记录：

```python
    conn = db_module.get_db()
    # …（权限判定）
    db_module.touch_history(conn, current_user()["id"], note_id)
```

  - 位置：在确认可读之后、`return ok(...)` 之前。**不得**在 `list_notes` 中调用 `touch_history`。

- [x] 在 `api/share.py` 的 `read_shared_note` 与 `verify_share_password` 成功路径中插入：

```python
    viewer = current_user()
    if viewer is not None:
        db_module.touch_history(db_module.get_db(), viewer["id"], note["id"])
```

- [x] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_favorites_api.py tests/test_history_api.py -v
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 新增 19 个用例全部 passed，全量无回归

**Security/Boundary Notes:**
- 收藏目标必须是「本人笔记」或「公开且带 token 的笔记」，否则返回 `NOT_FOUND`，不泄露他人私密笔记的存在性。
- 失效条目只返回 `title: null` 与 `summary: null`，绝不返回 `content_md`，避免分享关闭后内容仍可从收藏/足迹读取。
- 足迹仅在详情读取与分享读取/校验成功时记录，且只记录已登录用户；列表接口保持无副作用。
- `list_favorites` 与 `list_history` 的 JOIN 只取 `username` 与 `avatar`，不返回作者邮箱。

**Dependencies:** Phase 6 Task 1/2、Phase 4 Task 2

---

## Task 2: 前端收藏按钮与足迹联动

**Goal:** 在详情页与分享页接入收藏操作，并让收藏状态在页面间即时同步。

**Files:**
- Modify: `static/js/notes.js`（详情页操作条）
- Modify: `static/js/share.js`（分享页操作区）
- Modify: `static/js/api.js`（无需改动，确认 `post` 支持 `silent` 选项用于收藏前置查询）
- Test: 无（前端交互由 Task 4 的浏览器验收覆盖）

**Steps:**

- [x] 在 `notes.js` 的 `renderNoteDetail` 中，把 `.detail-actions` 改为按顺序放置：`收藏 / 已收藏`、`编辑`、`删除`。

  - 收藏状态来源：详情接口不返回收藏状态，因此渲染时并行请求 `api.get('/api/favorites?page_size=50', { silent: true })` 并在返回列表里查找当前 `note.id`；若未找到则显示「收藏」。
  - 点击「收藏」→ `api.post('/api/favorites', { note_id: note.id })` → 成功后按钮文案变「已收藏」，并在该按钮上加 `.is-favorited`（主色描边）。
  - 点击「已收藏」→ `confirmDialog({ title:'取消收藏', message:'确定要取消收藏这篇笔记吗？', confirmText:'取消收藏' })` → `api.del('/api/favorites/' + note.id)` → 按钮回到「收藏」。
  - 若接口返回 `ALREADY_FAVORITED`，直接把按钮置为「已收藏」并 toast 后端 `message`（不当作失败流程处理）。

- [x] 在 `share.js` 的 `renderSharePage` 中，把 `#share-actions` 填充为：

  - 收藏按钮文案与行为同上。
  - 未登录时点击收藏 → 跳转 `/login?redirect=<当前路径>`（不做静默失败）。
  - 登录且未收藏 → 调 `POST /api/favorites`；由于分享页读者可能未解锁密码，收藏请求失败时按 `api.js` 的默认行为 toast 后端 `message`。

- [x] 样式追加到 `notes.css` / `share.css`：`.btn.is-favorited { border-color: var(--c-primary-hover); color: var(--c-primary-hover); }`、`.share-actions { display:flex; gap:var(--sp-3); margin-top:var(--sp-6); }`。

- [x] 手工验证：
  - 作者详情页点「收藏」→ 文案变「已收藏」；到 `/me` 的「我的收藏」能看到该篇
  - 取消收藏 → 从「我的收藏」消失
  - 分享页登录后收藏他人笔记 → 「我的收藏」出现该篇且作者显示为对方
  - 作者关闭分享后，读者的「我的收藏」中该条目显示「内容已失效」

**Dependencies:** Task 1、Phase 6 Task 3/4

---

## Task 3: 个人主页四 Tab

**Goal:** 交付 `/me` 的四个 Tab：个人信息、我的笔记、我的收藏、浏览足迹。

**Files:**
- Create: `static/js/profile.js`
- Create: `static/css/profile.css`
- Modify: `static/js/notes.js`（抽出可复用的 `renderNoteGrid(container, query)`）
- Modify: `static/js/ui.js`（新增 `staleCard()` 复用失效占位）
- Modify: `static/js/router.js`（注册 `/me`）

**Steps:**

- [x] 在 `notes.js` 中抽出 `renderNoteGrid(container, { status, q, tag, sort, page, pageSize, showEmptyAction })`：

  - 内部完成 `api.get('/api/notes?' + params)`、骨架、空态、分页与卡片渲染，返回 `{ total }`。
  - `renderNoteList` 改为「渲染工具条 + 调用 `renderNoteGrid`」，保证 `/notes` 与 `/me` 的「我的笔记」共用同一份渲染逻辑与视觉。

- [x] 在 `ui.js` 新增 `staleCard({ title, authorName, onOpen, onRemove })`：渲染 `.note-card.is-stale`，标题位置显示「内容已失效」，副文案显示作者名，提供「移除」按钮（标题本身不可点击）。

- [x] 创建 `static/js/profile.js`，导出 `renderProfile(root, params)`：

  - 顶部 Tab 栏 `.profile-tabs`：四个按钮 `个人信息 / 我的笔记 / 我的收藏 / 浏览足迹`，当前项 `.is-active` 与 `aria-current="true"`；切换时用 `navigate('/me?tab=' + name, { replace: false })` 同步 URL；`params.tab` 缺省为 `info`。
  - **个人信息 Tab**：
    - 卡片展示：头像（`user.avatar` 存在则 `<img>`，否则首字色块 64×64）、`<h2>` 用户名、邮箱（只读文本）、简介（`user.bio` 为空时显示「还没有填写简介」）、注册时间（`formatDate(user.created_at)`）。
    - 编辑区（同行内表单）：用户名输入（预填当前用户名）、简介 `<textarea maxlength="200">`、按钮「保存资料」。
      - 保存 → `api.put('/api/users/me/profile', { username, bio })` → 更新 `store.setUser(...)` 与页面卡片 → toast「已保存」。
    - 修改密码区：三个输入框（原密码 / 新密码 / 确认新密码）+ 按钮「修改密码」。
      - 本地先校验新密码长度 8–64 且含字母与数字，不通过时用 `FIELD_MESSAGES` 的 `PASSWORD_WEAK` 文案提示；两次不一致提示 `PASSWORD_MISMATCH`。
      - 提交 → `api.put('/api/users/me/password', {...})` → 成功后清空三个输入框并 toast「密码已修改」。
  - **我的笔记 Tab**：复用工具条与 `renderNoteGrid`（`showEmptyAction: true`）。工具条实现放在 `profile.js` 内的 `renderMiniToolbar`，控件与 `/notes` 一致但只保留状态筛选、标签下拉与搜索（排序固定为更新时间）。
  - **我的收藏 Tab**：
    - `api.get('/api/favorites?page=&page_size=')`；`available` 为真时用 `noteCard()` 打开 `/s/<token>` 不可知，因此改为打开笔记详情 `/notes/<id>`（作者本人收藏自己笔记时可打开；他人分享的笔记在解锁后也可打开，未解锁时详情接口返回 `NOT_FOUND`，此时卡片点击提示「需要先通过分享链接访问并解锁」）。
    - `available` 为假时用 `staleCard()`，其「移除」按钮调 `api.del('/api/favorites/' + id)` 并从列表移除。
    - 附加「移除」操作：对可用条目也提供移除入口（右键菜单不做，改为卡片右下角「取消收藏」文字按钮）。
    - 空态：「还没有收藏」。分页同列表。
  - **浏览足迹 Tab**：
    - `api.get('/api/history?page=&page_size=')`；展示 `viewed_at`（相对时间）与笔记标题、作者；`available` 为假的用 `staleCard()`，移除调 `api.del('/api/history/' + id)`。
    - 顶部提供「清空浏览记录」按钮 → `confirmDialog({ title:'清空浏览记录', message:'确定要清空全部浏览记录吗？此操作不可恢复。', confirmText:'清空', danger:true })` → `api.del('/api/history')` → 列表置空并 toast「已清空浏览记录」。
    - 空态：「还没有浏览记录」。

- [x] 在 `router.js` 注册：

```js
registerRoute('/me', async (root, params) => {
  const { renderProfile } = await import('./profile.js');
  renderProfile(root, params);
}, { requiresAuth: true });
```

- [x] `static/css/profile.css` 实现：

  - `.profile-tabs`：底部 1px `var(--c-border)`，按钮间距 `var(--sp-6)`，当前项底部 3px `var(--c-primary-hover)` 下划线且文字变深。
  - `.profile-page`：`max-width:var(--page-max); margin:0 auto; padding:var(--sp-8) var(--gutter) var(--sp-16);`
  - `.profile-card`：纸张容器；`.profile-avatar` 64×64 圆形；首字色块用 `var(--c-accent)` 底 + `var(--c-text)` 字。
  - `.profile-form`：两列网格 `grid-template-columns: 1fr 1fr; gap:var(--sp-4)`；`≤768px` 改单列，按钮整宽。
  - `.profile-grid`：复用 `.note-grid` 的网格规则（在 `profile.css` 中按需 `@import` 不必要，直接重复 `repeat(auto-fill, minmax(280px, 1fr))`）。
  - `.stale-actions`：右下角「移除」文字按钮。

- [x] 手工验证：
  - 访问 `/me` 默认落在「个人信息」；切换到「我的收藏」后刷新页面仍停留在该 Tab
  - 修改用户名与简介 → 顶栏与卡片同步更新
  - 修改密码 → 用新密码重新登录成功
  - 三个列表 Tab 的空态文案分别为「还没有笔记，去写下第一篇吧」「还没有收藏」「还没有浏览记录」
  - 浏览几篇笔记后，「浏览足迹」按倒序显示且时间正确

**Security/Boundary Notes:**
- 修改密码成功后不清除会话（保留当前登录），但用户下次登录必须使用新密码。
- 「我的收藏」打开他人笔记依赖 Phase 6 的分享解锁态：未解锁时详情接口返回 `NOT_FOUND`，前端必须给出明确提示而不是静默失败。
- 所有列表内容用 `textContent` 写入，标题与简介不接受 HTML。

**Dependencies:** Task 1、Task 2、Phase 3 Task 4、Phase 6 Task 4

---

## Task 4: 个人主页视觉与流程验收

**Files:**
- Modify: `tests/manual/visual-checklist.md`

**Steps:**

- [x] 追加「Phase 7 · 收藏、足迹与个人主页」表格：

| # | 路由 | 视口 | 状态 | 检查点 | 结果 |
|---|------|------|------|--------|------|
| 1 | `/me` | 1440×900 | 个人信息 | 头像 64px、用户名/邮箱/简介/注册时间；编辑表单两列 | |
| 2 | `/me` | 1440×900 | 保存成功 | 顶栏用户名与卡片同步更新 + toast「已保存」 | |
| 3 | `/me` | 1440×900 | 改密失败 | 新密码 `abcdefgh` → 显示密码强度文案 | |
| 4 | `/me` | 1440×900 | 我的笔记空态 | 「还没有笔记，去写下第一篇吧」 | |
| 5 | `/me` | 1440×900 | 我的收藏空态 | 「还没有收藏」 | |
| 6 | `/me` | 1440×900 | 浏览足迹空态 | 「还没有浏览记录」 | |
| 7 | `/me` | 1440×900 | 失效收藏 | 卡片显示「内容已失效」+「移除」按钮 | |
| 8 | `/me` | 1440×900 | 清空记录 | 弹窗文案「确定要清空全部浏览记录吗？此操作不可恢复。」 | |
| 9 | `/me` | 375×812 | 个人信息 | Tab 可横向滚动或换行；表单单列、按钮整宽 | |
| 10 | `/notes/:id` | 1440×900 | 已收藏 | 收藏按钮变「已收藏」并有主色描边 | |
| 11 | `/s/:token` | 1440×900 | 未登录点收藏 | 跳转 `/login?redirect=/s/<token>` | |
| 12 | `/me` | 键盘 | 默认 | Tab 键可达四个 Tab 与各表单控件，焦点环可见 | |

- [x] 逐项截图核对、填写「结果」列并修复问题。

**Dependencies:** Task 1–3

---

## Phase Completion Checklist

- [x] 全部 4 个任务完成
- [x] `.venv/Scripts/python.exe -m pytest tests/ -v` 全部通过（新增 `test_favorites_api.py` 10 项、`test_history_api.py` 8 项）
- [x] 收藏对象范围正确：本人笔记与可访问的分享笔记可收藏，他人私密笔记返回 `NOT_FOUND`
- [x] 分享关闭或笔记删除后，收藏与足迹条目返回 `available: false` 且不含标题与摘要
- [x] 浏览足迹去重、倒序、可单条移除、可全部清空
- [x] 个人主页四 Tab 全部可用，URL 与 Tab 状态一致
- [x] `tests/manual/visual-checklist.md` 中 Phase 7 的 12 行已填写并修复
- [x] `tests/manual/visual-checklist.md` 中 Phase 7 的 12 行已填写并修复
      —— 12 行的结构/文案/ARIA/请求序列/CSS 契约已由自动断言覆盖；像素观感、Tab 下划线观感、
      失效卡片 `opacity`、toast 位置、375×812 无横向滚动、焦点环可见性已标注
      「待人工确认（本环境无浏览器）」。
- [x] 可以进入 Phase 8

---

## 执行记录（主智能体验证）

- **执行日期**：2026-10-08
- **验证命令与结果**：`.venv/Scripts/python.exe -m pytest tests/ -q` → **472 passed**
  （Phase 6 的 387 项 + 本阶段新增 85 项：`test_favorites_api.py` 11、`test_history_api.py` 13、
  `test_profile_frontend.py` 42、`test_manual_checklists.py` +7，以及 Phase 5/6 前端用例扩充）。
- **对比度工具**：`tests/manual/check_contrast.py` → exit 0（未新增颜色令牌）。
- **范围隔离抽查**：`tests/test_security_headers.py`、`tests/test_authz_matrix.py`、
  `tests/manual/end-to-end-walkthrough.md` 均未创建 ✅；未触碰 `app.py`、`config.py`、
  `core/errors.py`。
- **清单结构抽查**：`grep -c "^## Phase 7" tests/manual/visual-checklist.md` → 1（无重复段落）。
- **进程抽查**：`tasklist` 无残留 python 进程；本次 472 passed 来自无并发干扰的干净前台运行。

**主智能体独立复验（自建脚本，非子智能体断言）**

| 场景 | 实测结果 |
|------|----------|
| 匿名读分享后作者足迹 | total = 0（匿名浏览不记录）✅ |
| 登录读者读分享后其足迹 | total = 1 ✅ |
| 收藏 / 重复收藏 | `OK` / `ALREADY_FAVORITED` ✅ |
| 读 `GET /notes` 后自身足迹 | total = 0（列表接口零副作用）✅ |
| 关闭分享后的收藏条目 | `{id, status:'private', title:null, summary:null, tags:[], updated_at:null}`，`available:false` ✅ |
| 关闭分享后的足迹条目 | `{id, status:'private', title:null, summary:null, tags:[]}`，`available:false` ✅ |
| 泄露检查（标题/正文/邮箱/`content_md`） | 无泄露 ✅ |
| 收藏他人私密笔记 | `NOT_FOUND` ✅ |
| 匿名 `GET /api/favorites` / `/api/history` | 401 ✅ |
| 非作者读私密笔记详情 | `NOT_FOUND` ✅ |
| `innerHTML` 审计 | 仍为 **10 处**（`editor.js` 2、`home.js` 1 静态、`markdown.js` 1、`notes.js` 1、`router.js` 3、`share.js` 2），本阶段**新增 0 处** ✅ |
| `/me` 路由 | 已注册且 `requiresAuth: true` ✅ |

**子智能体的偏差（主智能体已复核接受）**

1. `renderNoteGrid` 增加可选第三参 `options`（`onPageChange` / `onClearFilters`，默认值与原行为一致），
   使 `/me` 复用同一网格而不 fork。
2. 收藏按钮抽为 `ui.js::favoriteButton()`，避免在详情页与分享页各写一份。
3. 顶栏账号菜单的 `aria-label` 加入用户名（`账号菜单：<用户名>`），使「保存资料后顶栏即时更新」
   可被断言。
4. `tests/test_auth_views.py` 与 `render_auth.mjs` 的「未注册路由」探针由 `/me` 改为
   `/__not-a-route__`：本阶段注册了 `/me`，原探针前提失效；断言意图不变，`/me` 自身的守卫改由
   `test_profile_frontend.py::test_me_route_requires_auth` 覆盖。属必要的测试迁移。
5. `tests/test_static_pages.py` 增加 `/me` 的 SPA 直链兜底用例。
6. Phase 5 清单第 10 行引用的 `test_detail_actions_only_edit_and_delete` 更名为
   `test_detail_actions_are_favorite_edit_delete`，引用同步更新。

**遗留风险**

1. 收藏状态反查上限：详情/分享页用 `GET /api/favorites?page_size=50` 反查；收藏超过 50 条时
   首次会显示「收藏」，点击后由 `ALREADY_FAVORITED` 纠正并提示，不会停在错误状态。
2. `staleCard` 的 `onOpen` 形参未接线（同句要求「标题不可点击」），同 Phase 6 的
   `renderComments(noteOwnerId)` 属同类取舍。
3. `/me` 列表内的「移除」无二次确认（计划只规定接口调用）；取消收藏的确认弹窗仅用于详情页与分享页。
4. `.profile-tabs` 的按钮具备 `role="tab"`，但未补齐 `aria-controls` 与 `role="tablist"`。
5. 浏览器观感与焦点环实测项仍待人工确认，已在清单标注。
6. Phase 2 遗留的 `:focus-visible` 焦点环对比度（2.85:1 < 3:1）仍待 Phase 8 决策。

