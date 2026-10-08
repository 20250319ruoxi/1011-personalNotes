import secrets
from datetime import datetime, timedelta, timezone

from werkzeug.security import check_password_hash, generate_password_hash


def hash_password(password):
    return generate_password_hash(password, method="pbkdf2:sha256")


def verify_password(password_hash, password):
    return check_password_hash(password_hash, password)


def generate_share_token():
    return secrets.token_urlsafe(24)


def generate_csrf_token():
    return secrets.token_urlsafe(32)


def record_failure(conn, scope, key):
    conn.execute(
        "INSERT INTO auth_attempts (scope, key, created_at) VALUES (?, ?, ?)",
        (scope, key, datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")),
    )
    conn.commit()


def _window_start(window_seconds):
    return (datetime.now(timezone.utc)
            - timedelta(seconds=window_seconds)).strftime("%Y-%m-%dT%H:%M:%SZ")


def is_rate_limited(conn, scope, key, max_failures, window_seconds):
    row = conn.execute(
        "SELECT COUNT(*) AS n FROM auth_attempts "
        "WHERE scope = ? AND key = ? AND created_at >= ?",
        (scope, key, _window_start(window_seconds)),
    ).fetchone()
    return row["n"] >= max_failures


def clear_failures(conn, scope, key):
    conn.execute("DELETE FROM auth_attempts WHERE scope = ? AND key = ?", (scope, key))
    conn.commit()
