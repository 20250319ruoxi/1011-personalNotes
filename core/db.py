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
