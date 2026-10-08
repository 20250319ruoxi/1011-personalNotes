"""Phase 8 Task 2 · 鉴权矩阵与滥用防护回归。

把「未登录访问受保护接口统一返回 UNAUTHORIZED」固化为回归约束，并补齐
伪造分享 token、上传路径穿越、非整数 id、跨会话 CSRF 等滥用场景。

本文件是「行为保持」的回归/表征测试：受保护接口的 `login_required`、`_csrf_protect`
的「无会话提前放行」分支、UUID 重命名与整数路径转换在 Phase 1–7 已实现，
因此用例预期一次性通过（无 RED）。为证明断言有区分力，执行报告附有变异测试
（临时移除单个 `@login_required` / 泄漏他人 CSRF）确认对应用例立刻转红。
"""

import pytest

PROTECTED_ENDPOINTS = [
    ("GET", "/api/users/me/profile"),
    ("PUT", "/api/users/me/profile"),
    ("PUT", "/api/users/me/password"),
    ("GET", "/api/notes"),
    ("POST", "/api/notes"),
    ("GET", "/api/notes/1"),
    ("PUT", "/api/notes/1"),
    ("DELETE", "/api/notes/1"),
    ("POST", "/api/notes/1/share"),
    ("DELETE", "/api/notes/1/share"),
    ("GET", "/api/notes/1/comments"),
    ("POST", "/api/notes/1/comments"),
    ("DELETE", "/api/comments/1"),
    ("GET", "/api/favorites"),
    ("POST", "/api/favorites"),
    ("DELETE", "/api/favorites/1"),
    ("GET", "/api/history"),
    ("DELETE", "/api/history"),
    ("DELETE", "/api/history/1"),
    ("GET", "/api/tags"),
    ("POST", "/api/uploads/image"),
    ("POST", "/api/auth/logout"),
]

PUBLIC_ENDPOINTS = [
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("GET", "/api/auth/me"),
    ("GET", "/api/share/whatever"),
    ("GET", "/api/share/whatever/comments"),
]


@pytest.mark.parametrize("method,path", PROTECTED_ENDPOINTS)
def test_protected_endpoint_requires_login(client, method, path):
    resp = client.open(path, method=method)
    assert resp.status_code == 401, f"{method} {path} 未要求登录"
    assert resp.get_json()["code"] == "UNAUTHORIZED"


@pytest.mark.parametrize("method,path", PUBLIC_ENDPOINTS)
def test_public_endpoint_does_not_require_login(client, method, path):
    resp = client.open(path, method=method, json={})
    assert resp.status_code != 401 or resp.get_json()["code"] != "UNAUTHORIZED"


def test_login_with_missing_fields_is_invalid_param(client):
    assert client.post("/api/auth/login", json={}).get_json()["code"] == "INVALID_PARAM"


def test_fake_share_tokens_are_all_rejected(client):
    for index in range(20):
        token = f"fake-token-{index:02d}-{'x' * 20}"
        resp = client.get(f"/api/share/{token}")
        assert resp.status_code == 404
        assert resp.get_json()["code"] == "SHARE_DISABLED"


def test_upload_path_traversal_filename_is_ignored(alice):
    c, headers = alice
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (1, 2, 3)).save(buf, format="PNG")
    buf.seek(0)
    resp = c.post("/api/uploads/image",
                  data={"file": (buf, "../../../evil.png")},
                  headers=headers, content_type="multipart/form-data")
    url = resp.get_json()["data"]["url"]
    assert ".." not in url and "/" not in url.rsplit("/", 1)[0].replace("/static/uploads", "")
    assert url.startswith("/static/uploads/u")


def test_note_id_is_type_checked(alice):
    c, headers = alice
    resp = c.get("/api/notes/not-an-int")
    assert resp.status_code == 404


def test_csrf_token_from_another_session_is_rejected(app, alice):
    c, _ = alice
    other = app.test_client()
    other.post("/api/auth/register", json={
        "email": "other@example.com", "username": "otherone",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    foreign_token = other.get("/api/auth/me").get_json()["data"]["csrf_token"]
    resp = c.post("/api/notes", json={"title": "t", "content_md": "c", "status": "draft"},
                  headers={"X-CSRF-Token": foreign_token})
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "CSRF_INVALID"
