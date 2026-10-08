"""Phase 6 Task 1 · 分享接口与解锁态契约。

覆盖开启/关闭分享、公开读取、密码校验、限流隔离、Token 失效、归属校验与公开载荷脱敏。
"""


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


def test_public_share_payload_excludes_sensitive_fields(client, alice):
    """公开分享载荷必须脱敏：不含 share_token / share_password_hash / user_id / 邮箱。

    这是窗口期的安全不变式守卫：断言里的「不含」必须先证明「该检查有区分力」，
    否则恒真 —— 因此先取所有者视角的详情载荷，证明它确实带 share_token。
    """
    c, headers = alice
    note_id = _create_note(c, headers)
    url = c.post(f"/api/notes/{note_id}/share", json={"password": "read1234"},
                 headers=headers).get_json()["data"]["share_url"]
    token = url.rsplit("/", 1)[-1]

    anon = client.application.test_client()
    anon.post(f"/api/share/{token}/verify", json={"password": "read1234"})
    resp = anon.get(f"/api/share/{token}")
    raw = resp.get_data(as_text=True)
    body = resp.get_json()["data"]

    # ① 有区分力的证据：所有者视角的详情载荷确实带 share_token
    owner_note = c.get(f"/api/notes/{note_id}").get_json()["data"]["note"]
    assert "share_token" in owner_note
    assert owner_note["share_token"] == token

    # ② 公开载荷字段白名单（多一个字段都会失败）
    assert set(body["note"]) == {"id", "title", "content_md", "tags",
                                 "published_at", "updated_at"}
    assert set(body["author"]) == {"username", "avatar"}

    # ③ 原始响应体里不得出现任何敏感串
    assert token not in raw
    assert "share_token" not in raw
    assert "share_password_hash" not in raw
    assert "alice@example.com" not in raw
    assert "pbkdf2" not in raw
    assert '"user_id"' not in raw
