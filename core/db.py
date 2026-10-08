import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from flask import current_app, g


def connect(database):
    Path(database).parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(database)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA journal_mode = WAL")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def get_db():
    if "db" not in g:
        g.db = connect(current_app.config["DATABASE"])
    return g.db


def close_db(_exc=None):
    conn = g.pop("db", None)
    if conn is not None:
        conn.close()


def init_app(app):
    app.teardown_appcontext(close_db)


def init_db(app):
    schema = Path(app.config["SCHEMA_FILE"]).read_text(encoding="utf-8")
    conn = connect(app.config["DATABASE"])
    try:
        conn.executescript(schema)
        conn.commit()
    finally:
        conn.close()


def current_app_config(key):
    return current_app.config[key]


def now_iso():
    """全项目唯一的时间来源：ISO8601 UTC，秒级精度，带 Z 后缀。"""
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def get_user_by_id(conn, user_id):
    return conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()


def get_user_by_email(conn, email):
    return conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()


def get_user_by_username(conn, username):
    return conn.execute("SELECT * FROM users WHERE username = ?", (username,)).fetchone()


def update_user_profile(conn, user_id, username=None, bio=None, avatar=None):
    fields, values = [], []
    if username is not None:
        fields.append("username = ?"); values.append(username)
    if bio is not None:
        fields.append("bio = ?"); values.append(bio)
    if avatar is not None:
        fields.append("avatar = ?"); values.append(avatar)
    if not fields:
        return
    values.append(user_id)
    conn.execute(f"UPDATE users SET {', '.join(fields)} WHERE id = ?", values)
    conn.commit()


def update_user_password(conn, user_id, password_hash):
    conn.execute("UPDATE users SET password_hash = ? WHERE id = ?", (password_hash, user_id))
    conn.commit()


def create_note(conn, user_id, title, content_md, status, tags):
    now = now_iso()
    published_at = None if status == "draft" else now
    cursor = conn.execute(
        "INSERT INTO notes (user_id, title, content_md, status, created_at, updated_at, published_at) "
        "VALUES (?, ?, ?, ?, ?, ?, ?)",
        (user_id, title, content_md, status, now, now, published_at),
    )
    note_id = cursor.lastrowid
    set_note_tags(conn, note_id, tags)
    conn.commit()
    return note_id


def update_note(conn, note_id, title=None, content_md=None, status=None, tags=None):
    fields = ["updated_at = ?"]
    values = [now_iso()]
    if title is not None:
        fields.append("title = ?"); values.append(title)
    if content_md is not None:
        fields.append("content_md = ?"); values.append(content_md)
    if status is not None:
        fields.append("status = ?"); values.append(status)
        if status != "draft":
            fields.append("published_at = COALESCE(published_at, ?)"); values.append(now_iso())
    values.append(note_id)
    conn.execute(f"UPDATE notes SET {', '.join(fields)} WHERE id = ?", values)
    if tags is not None:
        set_note_tags(conn, note_id, tags)
    conn.commit()


def soft_delete_note(conn, note_id):
    conn.execute("UPDATE notes SET is_deleted = 1, updated_at = ? WHERE id = ?",
                 (now_iso(), note_id))
    conn.commit()


def get_note(conn, note_id):
    return conn.execute("SELECT * FROM notes WHERE id = ?", (note_id,)).fetchone()


def set_note_tags(conn, note_id, tags):
    conn.execute("DELETE FROM note_tags WHERE note_id = ?", (note_id,))
    for name in tags:
        conn.execute("INSERT OR IGNORE INTO tags (name) VALUES (?)", (name,))
        tag_id = conn.execute("SELECT id FROM tags WHERE name = ?", (name,)).fetchone()["id"]
        conn.execute("INSERT OR IGNORE INTO note_tags (note_id, tag_id) VALUES (?, ?)",
                     (note_id, tag_id))
    conn.commit()


def get_note_tags(conn, note_id):
    rows = conn.execute(
        "SELECT t.name AS name FROM tags t "
        "JOIN note_tags nt ON nt.tag_id = t.id WHERE nt.note_id = ? ORDER BY t.name",
        (note_id,),
    ).fetchall()
    return [r["name"] for r in rows]


def list_notes(conn, user_id, status="all", q=None, tag=None, sort="updated",
               page=1, page_size=10):
    where = ["n.user_id = ?", "n.is_deleted = 0"]
    params = [user_id]
    if status and status != "all":
        where.append("n.status = ?"); params.append(status)
    if q:
        where.append("(n.title LIKE ? ESCAPE '\\' OR n.content_md LIKE ? ESCAPE '\\')")
        escaped = (q.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_"))
        params.extend([f"%{escaped}%", f"%{escaped}%"])
    if tag:
        where.append("EXISTS (SELECT 1 FROM note_tags nt JOIN tags t ON t.id = nt.tag_id "
                     "WHERE nt.note_id = n.id AND t.name = ?)")
        params.append(tag)

    order = {"updated": "n.updated_at DESC", "created": "n.created_at DESC"}.get(
        sort, "n.updated_at DESC")
    where_sql = " AND ".join(where)

    total = conn.execute(f"SELECT COUNT(*) AS n FROM notes n WHERE {where_sql}",
                         params).fetchone()["n"]
    rows = conn.execute(
        f"SELECT n.* FROM notes n WHERE {where_sql} ORDER BY {order} LIMIT ? OFFSET ?",
        params + [page_size, (page - 1) * page_size],
    ).fetchall()
    return rows, total


def get_user_tags(conn, user_id):
    return conn.execute(
        "SELECT t.name AS name, COUNT(DISTINCT nt.note_id) AS count "
        "FROM tags t JOIN note_tags nt ON nt.tag_id = t.id JOIN notes n ON n.id = nt.note_id "
        "WHERE n.user_id = ? AND n.is_deleted = 0 "
        "GROUP BY t.id ORDER BY count DESC, t.name ASC",
        (user_id,),
    ).fetchall()
