def test_login_locks_after_five_failures(app, client):
    client.post("/api/auth/register", json={
        "email": "lock@example.com", "username": "locker",
        "password": "passw0rd", "confirm_password": "passw0rd"})

    fresh = client.application.test_client()
    for _ in range(5):
        resp = fresh.post("/api/auth/login",
                          json={"email": "lock@example.com", "password": "wrongpass1"})
        assert resp.get_json()["code"] == "INVALID_CREDENTIALS"

    limited = fresh.post("/api/auth/login",
                         json={"email": "lock@example.com", "password": "passw0rd"})
    assert limited.status_code == 429
    assert limited.get_json()["code"] == "RATE_LIMITED"


def test_successful_login_clears_failure_counter(client):
    client.post("/api/auth/register", json={
        "email": "clear@example.com", "username": "clearer",
        "password": "passw0rd", "confirm_password": "passw0rd"})

    fresh = client.application.test_client()
    for _ in range(3):
        fresh.post("/api/auth/login", json={"email": "clear@example.com", "password": "wrongpass1"})

    assert fresh.post("/api/auth/login",
                      json={"email": "clear@example.com", "password": "passw0rd"}
                      ).get_json()["code"] == "OK"
    for _ in range(4):
        fresh.post("/api/auth/login", json={"email": "clear@example.com", "password": "wrongpass1"})
    assert fresh.post("/api/auth/login",
                      json={"email": "clear@example.com", "password": "passw0rd"}
                      ).get_json()["code"] == "OK"
