def test_register_returns_user_and_csrf_without_password_hash(client):
    resp = client.post("/api/auth/register", json={
        "email": "New@Example.com", "username": "newbie",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    body = resp.get_json()
    assert resp.status_code == 200 and body["code"] == "OK"
    assert body["data"]["user"]["email"] == "new@example.com"
    assert body["data"]["csrf_token"]
    assert "password_hash" not in body["data"]["user"]


def test_register_rejects_duplicate_email(client, alice):
    resp = client.post("/api/auth/register", json={
        "email": "alice@example.com", "username": "alice2",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "EMAIL_EXISTS"


def test_register_rejects_duplicate_username(client, alice):
    resp = client.post("/api/auth/register", json={
        "email": "other@example.com", "username": "alice",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "USERNAME_EXISTS"


def test_register_rejects_weak_password_and_mismatch(client):
    weak = client.post("/api/auth/register", json={
        "email": "x@example.com", "username": "xxxx",
        "password": "abcdefgh", "confirm_password": "abcdefgh"})
    assert weak.get_json()["code"] == "PASSWORD_WEAK"

    mismatch = client.post("/api/auth/register", json={
        "email": "x@example.com", "username": "xxxx",
        "password": "passw0rd", "confirm_password": "passw0rd2"})
    assert mismatch.get_json()["code"] == "PASSWORD_MISMATCH"


def test_login_is_case_insensitive_and_returns_csrf(client, alice):
    client.post("/api/auth/logout", headers={"X-CSRF-Token": "x"})
    client.post("/api/auth/register", json={
        "email": "case@example.com", "username": "caser",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    fresh = client.application.test_client()
    resp = fresh.post("/api/auth/login", json={"email": "CASE@example.com", "password": "passw0rd"})
    assert resp.status_code == 200
    assert resp.get_json()["data"]["user"]["username"] == "caser"
    assert resp.get_json()["data"]["csrf_token"]


def test_login_wrong_password(client, alice):
    fresh = client.application.test_client()
    resp = fresh.post("/api/auth/login", json={"email": "alice@example.com", "password": "wrongpass1"})
    assert resp.status_code == 401
    assert resp.get_json()["code"] == "INVALID_CREDENTIALS"


def test_me_returns_null_when_anonymous(client):
    body = client.get("/api/auth/me").get_json()
    assert body["code"] == "OK"
    assert body["data"]["user"] is None


def test_me_returns_current_user(client, alice):
    body = client.get("/api/auth/me").get_json()
    assert body["data"]["user"]["username"] == "alice"
    assert body["data"]["csrf_token"]


def test_logout_clears_session(client, alice):
    c, headers = alice
    assert c.post("/api/auth/logout", headers=headers).get_json()["code"] == "OK"
    assert c.get("/api/auth/me").get_json()["data"]["user"] is None


def test_write_without_csrf_header_is_rejected(client, alice):
    c, _ = alice
    resp = c.post("/api/auth/logout")
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "CSRF_INVALID"


def test_write_with_wrong_csrf_header_is_rejected(client, alice):
    c, _ = alice
    resp = c.post("/api/auth/logout", headers={"X-CSRF-Token": "forged"})
    assert resp.get_json()["code"] == "CSRF_INVALID"


def test_cross_site_origin_on_login_is_rejected(client):
    resp = client.post("/api/auth/login",
                       json={"email": "a@b.com", "password": "passw0rd"},
                       headers={"Origin": "https://evil.example"})
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "CSRF_INVALID"


def test_logout_requires_login(client):
    """/api/* 除标注公开的接口外均需登录，登出也在其中（Phase 8 鉴权矩阵会复验）。"""
    resp = client.post("/api/auth/logout")
    assert resp.status_code == 401
    assert resp.get_json()["code"] == "UNAUTHORIZED"


def test_wrong_method_on_api_returns_method_not_allowed(client):
    """错误方法必须返回语义化状态码，而不是被当成服务器内部错误。"""
    resp = client.put("/api/auth/login", json={})
    assert resp.status_code == 405
    assert resp.get_json()["code"] == "METHOD_NOT_ALLOWED"
