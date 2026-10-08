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
