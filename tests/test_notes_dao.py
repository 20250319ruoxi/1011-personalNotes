import pytest

from core import db as db_module
from core.markdown import to_plain_text


@pytest.fixture()
def alice_id(app):
    with app.app_context():
        conn = db_module.get_db()
        conn.execute("INSERT INTO users (email, username, password_hash, created_at) "
                     "VALUES ('d@e.com','dao','x','2026-01-01T00:00:00Z')")
        conn.commit()
        return conn.execute("SELECT id FROM users WHERE username='dao'").fetchone()["id"]


def test_create_and_get_note_with_tags(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        note_id = db_module.create_note(conn, alice_id, "标题", "正文", "draft", ["生活", "work"])
        row = db_module.get_note(conn, note_id)
        assert row["status"] == "draft"
        assert row["published_at"] is None
        assert sorted(db_module.get_note_tags(conn, note_id)) == ["work", "生活"]


def test_publishing_sets_published_at_once(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        note_id = db_module.create_note(conn, alice_id, "t", "c", "draft", [])
        db_module.update_note(conn, note_id, status="private")
        first = db_module.get_note(conn, note_id)["published_at"]
        assert first is not None
        db_module.update_note(conn, note_id, title="t2")
        assert db_module.get_note(conn, note_id)["published_at"] == first


def test_set_note_tags_replaces_previous_binding(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        note_id = db_module.create_note(conn, alice_id, "t", "c", "draft", ["a", "b"])
        db_module.set_note_tags(conn, note_id, ["b", "c"])
        assert sorted(db_module.get_note_tags(conn, note_id)) == ["b", "c"]


def test_soft_delete_hides_from_get_and_list(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        note_id = db_module.create_note(conn, alice_id, "t", "c", "draft", [])
        db_module.soft_delete_note(conn, note_id)
        assert db_module.get_note(conn, note_id)["is_deleted"] == 1
        rows, total = db_module.list_notes(conn, alice_id)
        assert total == 0 and rows == []


def test_search_escapes_wildcards(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        db_module.create_note(conn, alice_id, "100% 折扣", "内容", "private", [])
        db_module.create_note(conn, alice_id, "1000 元", "内容", "private", [])
        rows, total = db_module.list_notes(conn, alice_id, q="100%")
        assert total == 1
        assert rows[0]["title"] == "100% 折扣"


def test_list_returns_summary_source_content(app, alice_id):
    with app.app_context():
        conn = db_module.get_db()
        db_module.create_note(conn, alice_id, "标题", "## 小标题\n\n这是摘要正文。", "private", [])
        rows, _ = db_module.list_notes(conn, alice_id)
        assert to_plain_text(rows[0]["content_md"]) == "小标题 这是摘要正文。"
