"""Phase 6 Task 2 · 评论接口与权限矩阵契约。

覆盖：作者视角接口归属校验、分享链接评论、匿名/设密限制、删除三档权限
（评论作者 / 笔记作者 / 无关用户 FORBIDDEN）、软删除、校验与分页。
"""


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


def test_delete_permission_matrix_is_server_side_and_unforgeable(alice, bob_raw):
    """can_delete 由服务端按 viewer 计算；删除接口自身重做判定，伪造字段无效。"""
    c, headers = alice
    note_id, token = _shared_note(c, headers)
    a_comment = c.post(f"/api/notes/{note_id}/comments", json={"content": "作者的评论"},
                       headers=headers).get_json()["data"]["comment"]["id"]
    other, other_headers = bob_raw
    b_comment = other.post(f"/api/share/{token}/comments", json={"content": "读者的评论"},
                           headers=other_headers).get_json()["data"]["comment"]["id"]

    def flags(client):
        items = client.get(f"/api/share/{token}/comments").get_json()["data"]["items"]
        return {i["id"]: i["can_delete"] for i in items}

    # 评论作者 bob：自己的可删、笔记作者的不可删
    assert flags(other) == {a_comment: False, b_comment: True}

    # 笔记作者 alice：两条都可删
    owner_items = c.get(f"/api/notes/{note_id}/comments").get_json()["data"]["items"]
    assert {i["id"]: i["can_delete"] for i in owner_items} == {a_comment: True, b_comment: True}

    # 无关用户 carol：两条都不可删
    third = c.application.test_client()
    third.post("/api/auth/register", json={
        "email": "carol2@example.com", "username": "carol2",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    third_headers = {"X-CSRF-Token": third.get("/api/auth/me").get_json()["data"]["csrf_token"]}
    assert flags(third) == {a_comment: False, b_comment: False}

    # 无关用户即使伪造 can_delete=true 也删不掉：服务端重新判定
    forged = third.delete(f"/api/comments/{a_comment}", json={"can_delete": True},
                          headers=third_headers)
    assert forged.status_code == 403
    assert forged.get_json() == {
        "code": "FORBIDDEN", "message": "没有权限执行该操作", "data": None,
    }
    # 伪造请求未生效：alice 的评论仍在列表中
    assert c.get(f"/api/notes/{note_id}/comments").get_json()["data"]["total"] == 2

    # 笔记作者 alice 确实能删除他人（bob）的评论 —— 三档权限里的第二档
    deleted = c.delete(f"/api/comments/{b_comment}", headers=headers)
    assert deleted.get_json() == {
        "code": "OK", "message": "评论已删除", "data": None,
    }
    remaining = c.get(f"/api/notes/{note_id}/comments").get_json()["data"]
    assert remaining["total"] == 1
    assert [i["content"] for i in remaining["items"]] == ["作者的评论"]


def test_comment_delete_is_soft_and_row_survives(app, alice):
    """软删除证明：接口不再返回该评论，但数据库行保留且 is_deleted = 1。"""
    from core import db as db_module

    c, headers = alice
    note_id = _own_note(c, headers)
    comment_id = c.post(f"/api/notes/{note_id}/comments", json={"content": "待删除"},
                        headers=headers).get_json()["data"]["comment"]["id"]

    assert c.delete(f"/api/comments/{comment_id}", headers=headers).get_json()["code"] == "OK"
    assert c.get(f"/api/notes/{note_id}/comments").get_json()["data"]["total"] == 0

    with app.app_context():
        conn = db_module.get_db()
        row = db_module.get_comment(conn, comment_id)
        assert row is not None, "软删除不得物理删除行"
        assert row["is_deleted"] == 1
        assert row["content"] == "待删除"
        _, total = db_module.list_comments(conn, note_id)
        assert total == 0
