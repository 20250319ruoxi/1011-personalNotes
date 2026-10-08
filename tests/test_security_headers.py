"""Phase 8 Task 1 · 安全响应头回归。

断言应用为*每一条*响应（SPA 页面、API 成功/失败、404）附加统一安全头，
Session Cookie 具备 HttpOnly + SameSite=Lax，且 CSP 不含 'unsafe-inline'。
"""

import pytest


@pytest.mark.parametrize("path", ["/", "/about", "/api/auth/me", "/api/__nope__"])
def test_security_headers_on_every_response(client, path):
    resp = client.get(path)
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "no-referrer"
    assert "default-src 'self'" in resp.headers["Content-Security-Policy"]
    assert "'unsafe-inline'" not in resp.headers["Content-Security-Policy"]


def test_session_cookie_is_httponly_and_lax(client):
    resp = client.post("/api/auth/register", json={
        "email": "cookie@example.com", "username": "cookie",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    raw = " ".join(resp.headers.getlist("Set-Cookie"))
    assert "session=" in raw
    assert "HttpOnly" in raw
    assert "SameSite=Lax" in raw


def test_share_page_sets_no_referrer_policy(client, alice):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "t", "content_md": "c",
                                         "status": "private"}, headers=headers
                     ).get_json()["data"]["note"]["id"]
    token = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                   ).get_json()["data"]["share_url"].rsplit("/", 1)[-1]
    assert client.get(f"/api/share/{token}").headers["Referrer-Policy"] == "no-referrer"
