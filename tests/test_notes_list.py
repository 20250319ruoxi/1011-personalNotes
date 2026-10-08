import time


def _seed(c, headers, delay=0):
    """按 draft→private1→private2 顺序创建三篇笔记。

    delay>0 时在每次创建之间等待，保证 created_at/updated_at 严格递增，
    用于排序断言（全项目时间精度为秒级，同秒创建会导致 ORDER BY 顺序不稳定）。
    """
    ids = {}
    ids["draft"] = c.post("/api/notes", json={
        "title": "草稿标题", "content_md": "草稿正文", "status": "draft",
        "tags": ["未完成"]}, headers=headers).get_json()["data"]["note"]["id"]
    if delay:
        time.sleep(delay)
    ids["private1"] = c.post("/api/notes", json={
        "title": "健身计划", "content_md": "每周三次", "status": "private",
        "tags": ["生活"]}, headers=headers).get_json()["data"]["note"]["id"]
    if delay:
        time.sleep(delay)
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
    ids = _seed(c, headers, delay=1.05)
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
