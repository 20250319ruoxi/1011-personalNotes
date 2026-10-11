"""Phase 7 Task 1 · 浏览足迹接口契约（api/history.py + core/db.py 的足迹 DAO）。

覆盖：阅读自身详情写入足迹、重复浏览去重并刷新时间、读者阅读他人分享写入足迹、
匿名浏览不记录、分享关闭后条目 available: false、单条移除、全部清空、分页与倒序、
未登录 401。
"""

from __future__ import annotations


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
    # 匿名浏览不得写入任何用户的足迹：作者自己的足迹也必须仍为 0
    # （否则「匿名浏览被记到某个已有用户头上」会被漏检）
    assert c.get("/api/history").get_json()["data"]["total"] == 0
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


def test_history_payload_never_exposes_content_or_email(alice, bob_raw):
    """足迹载荷字段白名单：含 content_md 即失败；作者只含 username / avatar，无邮箱。"""
    c, headers = alice
    content = ("乙" * 120) + "TAIL_SECRET"
    note_id = c.post("/api/notes", json={"title": "足迹脱敏", "content_md": content,
                                         "status": "private"}, headers=headers
                     ).get_json()["data"]["note"]["id"]
    token = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                   ).get_json()["data"]["share_url"].rsplit("/", 1)[-1]
    other, _ = bob_raw
    other.get(f"/api/share/{token}")

    item = other.get("/api/history").get_json()["data"]["items"][0]
    assert set(item["note"]) == {"id", "status", "title", "summary", "tags"}
    assert set(item["author"]) == {"username", "avatar"}
    raw = other.get("/api/history").get_data(as_text=True)
    assert "content_md" not in raw
    assert "TAIL_SECRET" not in raw, "足迹列表绝不返回完整正文（只给 80 字摘要）"
    assert "@example.com" not in raw

    # 作者关闭分享后：条目失效且不再返回标题、摘要与正文
    c.delete(f"/api/notes/{note_id}/share", headers=headers)
    stale = other.get("/api/history").get_json()["data"]["items"][0]
    assert stale["available"] is False
    assert stale["note"]["title"] is None
    assert stale["note"]["summary"] is None
    assert stale["note"]["tags"] == []
    raw_stale = other.get("/api/history").get_data(as_text=True)
    assert "足迹脱敏" not in raw_stale
    assert "乙" not in raw_stale
    assert "@example.com" not in raw_stale


def test_history_only_written_by_reads_not_lists(alice):
    """列表接口（GET /notes、GET /tags）必须无副作用，绝不写足迹。"""
    c, headers = alice
    for i in range(3):
        _note(c, headers, title=f"列表笔记{i}")
    c.get("/api/notes")
    c.get("/api/notes?status=private")
    c.get("/api/tags")
    assert c.get("/api/history").get_json()["data"]["total"] == 0


def test_anonymous_detail_read_records_nothing(client, alice):
    """未登录读详情被 401 拦截，且不产生任何足迹记录。"""
    c, headers = alice
    note_id = _note(c, headers)
    anon = client.application.test_client()
    assert anon.get(f"/api/notes/{note_id}").status_code == 401
    assert c.get("/api/history").get_json()["data"]["total"] == 0


def test_password_share_verify_success_records_history(alice, bob_raw):
    """设密分享校验成功后写入读者足迹；校验失败不写。"""
    c, headers = alice
    note_id = _note(c, headers, title="设密分享")
    token = c.post(f"/api/notes/{note_id}/share", json={"password": "secret12"},
                   headers=headers).get_json()["data"]["share_url"].rsplit("/", 1)[-1]
    other, other_headers = bob_raw

    other.post(f"/api/share/{token}/verify", json={"password": "wrongpass"})
    assert other.get("/api/history").get_json()["data"]["total"] == 0, "校验失败不写足迹"

    resp = other.post(f"/api/share/{token}/verify", json={"password": "secret12"},
                      headers=other_headers)
    assert resp.get_json()["code"] == "OK"
    items = other.get("/api/history").get_json()["data"]["items"]
    assert len(items) == 1
    assert items[0]["author"]["username"] == "alice"


def test_history_entry_carries_share_url_for_viewers_only(alice, bob_raw):
    """足迹与收藏同一口径：他人分享的笔记只能经 /s/<token> 打开，本人笔记不带 share_url。"""
    c, headers = alice
    note_id = _note(c, headers)
    c.get(f"/api/notes/{note_id}")
    assert "share_url" not in c.get("/api/history").get_json()["data"]["items"][0], \
        "本人笔记走作者详情页"

    token = c.post(f"/api/notes/{note_id}/share", json={},
                   headers=headers).get_json()["data"]["share_url"].rsplit("/", 1)[-1]
    other, _other_headers = bob_raw
    other.get(f"/api/share/{token}")
    entry = other.get("/api/history").get_json()["data"]["items"][0]
    assert entry["available"] is True
    assert entry["share_url"] == f"/s/{token}"
    assert other.get(f"/api/share/{token}").get_json()["code"] == "OK"
