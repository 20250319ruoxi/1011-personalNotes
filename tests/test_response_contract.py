def test_unknown_api_path_returns_not_found_envelope(client):
    resp = client.get("/api/__nope__")
    assert resp.status_code == 404
    assert resp.get_json() == {
        "code": "NOT_FOUND",
        "message": "请求的内容不存在",
        "data": None,
    }


def test_chinese_message_is_not_ascii_escaped(client):
    body = client.get("/api/__nope__").get_data(as_text=True)
    assert "请求的内容不存在" in body
    assert "\\u8bf7" not in body


def test_spa_fallback_serves_index_html(client):
    resp = client.get("/notes/123")
    assert resp.status_code == 200
    assert b'id="app"' in resp.data


def test_unknown_static_is_not_spa_fallback(client):
    resp = client.get("/static/__missing__.png")
    assert resp.status_code == 404
