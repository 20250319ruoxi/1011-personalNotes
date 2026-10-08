def test_get_own_profile(alice):
    c, headers = alice
    body = c.get("/api/users/me/profile").get_json()
    assert body["code"] == "OK"
    assert body["data"]["user"]["username"] == "alice"


def test_get_profile_requires_login(client):
    resp = client.get("/api/users/me/profile")
    assert resp.status_code == 401
    assert resp.get_json()["code"] == "UNAUTHORIZED"


def test_update_profile_bio_and_username(alice):
    c, headers = alice
    resp = c.put("/api/users/me/profile",
                 json={"username": "alice2", "bio": "写点东西"}, headers=headers)
    assert resp.get_json()["code"] == "OK"
    assert resp.get_json()["data"]["user"]["bio"] == "写点东西"
    assert c.get("/api/auth/me").get_json()["data"]["user"]["username"] == "alice2"


def test_update_profile_rejects_taken_username(alice, bob_raw):
    c, headers = alice
    resp = c.put("/api/users/me/profile", json={"username": "bob"}, headers=headers)
    assert resp.status_code == 409
    assert resp.get_json()["code"] == "USERNAME_EXISTS"


def test_update_profile_rejects_invalid_username(alice):
    c, headers = alice
    assert c.put("/api/users/me/profile", json={"username": "a"},
                 headers=headers).get_json()["code"] == "INVALID_PARAM"


def test_change_password_happy_path(alice):
    c, headers = alice
    resp = c.put("/api/users/me/password", json={
        "old_password": "passw0rd", "new_password": "newpass1",
        "confirm_password": "newpass1"}, headers=headers)
    assert resp.get_json()["code"] == "OK"
    fresh = c.application.test_client()
    assert fresh.post("/api/auth/login",
                      json={"email": "alice@example.com", "password": "newpass1"}
                      ).get_json()["code"] == "OK"


def test_change_password_rejects_wrong_old(alice):
    c, headers = alice
    resp = c.put("/api/users/me/password", json={
        "old_password": "nope1234", "new_password": "newpass1",
        "confirm_password": "newpass1"}, headers=headers)
    assert resp.get_json()["code"] == "PASSWORD_WRONG"


def test_change_password_rejects_mismatch_and_weak(alice):
    c, headers = alice
    assert c.put("/api/users/me/password", json={
        "old_password": "passw0rd", "new_password": "newpass1",
        "confirm_password": "newpass2"}, headers=headers).get_json()["code"] == "PASSWORD_MISMATCH"
    assert c.put("/api/users/me/password", json={
        "old_password": "passw0rd", "new_password": "abcdefgh",
        "confirm_password": "abcdefgh"}, headers=headers).get_json()["code"] == "PASSWORD_WEAK"
