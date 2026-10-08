"""Phase 7 Task 1 · 收藏接口契约（api/favorites.py + core/db.py 的收藏 DAO）。

覆盖：本人笔记可收藏、重复收藏 409、他人私密笔记不可收藏（NOT_FOUND，不泄露存在性）、
公开且带 token 的他人笔记可收藏、分享关闭 / 笔记删除后条目返回 available: false 且
title / summary 为 null、取消收藏、分页与未登录 401。
"""

from __future__ import annotations


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


def test_favorites_payload_never_exposes_content_or_email(alice, bob_raw):
    """收藏载荷字段白名单：含 content_md 即失败；作者只含 username / avatar，无邮箱。
    失效条目仍不得出现标题、摘要与正文。"""
    c, headers = alice
    content = ("甲" * 120) + "TAIL_SECRET"
    note_id = c.post("/api/notes", json={"title": "脱敏检查", "content_md": content,
                                         "status": "private"}, headers=headers
                     ).get_json()["data"]["note"]["id"]
    _share(c, headers, note_id)
    other, other_headers = bob_raw
    other.post("/api/favorites", json={"note_id": note_id}, headers=other_headers)

    item = other.get("/api/favorites").get_json()["data"]["items"][0]
    assert set(item["note"]) == {"id", "status", "title", "summary", "tags", "updated_at"}
    assert set(item["author"]) == {"username", "avatar"}
    raw = other.get("/api/favorites").get_data(as_text=True)
    assert "content_md" not in raw
    assert "TAIL_SECRET" not in raw, "收藏列表绝不返回完整正文（只给 80 字摘要）"
    assert "@example.com" not in raw

    c.delete(f"/api/notes/{note_id}/share", headers=headers)
    stale = other.get("/api/favorites").get_json()["data"]["items"][0]
    assert stale["available"] is False
    assert stale["note"]["title"] is None
    assert stale["note"]["summary"] is None
    assert stale["note"]["tags"] == []
    raw_stale = other.get("/api/favorites").get_data(as_text=True)
    assert "脱敏检查" not in raw_stale
    assert "甲" not in raw_stale, "失效条目不得泄露正文（连摘要也不返回）"
    assert "@example.com" not in raw_stale
