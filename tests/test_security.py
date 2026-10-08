from datetime import datetime, timedelta, timezone

from core import security
from core.db import get_db, now_iso


def test_password_hash_roundtrip():
    digest = security.hash_password("passw0rd")
    assert digest != "passw0rd"
    assert digest.startswith("pbkdf2:sha256")
    assert security.verify_password(digest, "passw0rd") is True
    assert security.verify_password(digest, "wrong") is False


def test_share_token_is_url_safe_and_unique():
    tokens = {security.generate_share_token() for _ in range(50)}
    assert len(tokens) == 50
    assert all(len(t) >= 30 and " " not in t for t in tokens)


def test_rate_limit_counts_within_window(app):
    with app.app_context():
        conn = get_db()
        for _ in range(4):
            security.record_failure(conn, "login", "a@b.com")
        assert security.is_rate_limited(conn, "login", "a@b.com", 5, 900) is False
        security.record_failure(conn, "login", "a@b.com")
        assert security.is_rate_limited(conn, "login", "a@b.com", 5, 900) is True


def test_rate_limit_ignores_old_failures(app):
    with app.app_context():
        conn = get_db()
        for _ in range(5):
            security.record_failure(conn, "login", "a@b.com")
        old = (datetime.now(timezone.utc) - timedelta(seconds=1000)).strftime("%Y-%m-%dT%H:%M:%SZ")
        conn.execute("UPDATE auth_attempts SET created_at = ? WHERE key = 'a@b.com'", (old,))
        conn.commit()
        assert security.is_rate_limited(conn, "login", "a@b.com", 5, 900) is False


def test_clear_failures(app):
    with app.app_context():
        conn = get_db()
        security.record_failure(conn, "login", "a@b.com")
        security.clear_failures(conn, "login", "a@b.com")
        assert security.is_rate_limited(conn, "login", "a@b.com", 1, 900) is False
