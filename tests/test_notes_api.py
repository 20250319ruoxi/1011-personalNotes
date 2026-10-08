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
