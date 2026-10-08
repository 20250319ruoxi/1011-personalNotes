import sqlite3

import pytest

from core import db as db_module

EXPECTED_TABLES = {
    "users", "notes", "tags", "note_tags",
    "comments", "favorites", "view_history", "auth_attempts",
}


def test_init_db_creates_all_tables(app):
    with app.app_context():
        conn = db_module.get_db()
        names = {r["name"] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'")}
    assert EXPECTED_TABLES <= names


def test_init_db_is_idempotent(app):
    db_module.init_db(app)   # 第二次执行不得报错
    db_module.init_db(app)
    with app.app_context():
        conn = db_module.get_db()
        count = conn.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
        ).fetchone()[0]
    assert count >= len(EXPECTED_TABLES)


def test_foreign_keys_are_enforced(app):
    with app.app_context():
        conn = db_module.get_db()
        with pytest.raises(sqlite3.IntegrityError):
            conn.execute(
                "INSERT INTO notes (user_id, title, content_md, status, created_at, updated_at) "
                "VALUES (9999, 't', '', 'draft', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z')"
            )


def test_wal_mode_enabled(app):
    with app.app_context():
        conn = db_module.get_db()
        assert conn.execute("PRAGMA journal_mode").fetchone()[0].lower() == "wal"


def test_row_factory_returns_mapping(app):
    with app.app_context():
        row = db_module.get_db().execute("SELECT 1 AS one").fetchone()
        assert row["one"] == 1


def test_now_iso_is_utc_seconds_precision():
    value = db_module.now_iso()
    assert value.endswith("Z") and len(value) == 20
    assert value[4] == "-" and value[10] == "T" and value[19] == "Z"


def test_user_lookup_helpers(app):
    with app.app_context():
        conn = db_module.get_db()
        conn.execute("INSERT INTO users (email, username, password_hash, created_at) "
                     "VALUES ('a@b.com', 'alice', 'x', ?)", (db_module.now_iso(),))
        conn.commit()
        by_email = db_module.get_user_by_email(conn, "a@b.com")
        assert by_email["username"] == "alice"
        assert db_module.get_user_by_id(conn, by_email["id"])["email"] == "a@b.com"
        assert db_module.get_user_by_username(conn, "alice")["id"] == by_email["id"]
        assert db_module.get_user_by_email(conn, "missing@b.com") is None
