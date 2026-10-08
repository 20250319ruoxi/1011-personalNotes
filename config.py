import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent


class Config:
    SECRET_KEY = os.environ.get("SECRET_KEY", "dev-only-change-me")
    DATABASE = os.environ.get("DATABASE", str(BASE_DIR / "db" / "app.db"))
    SCHEMA_FILE = str(BASE_DIR / "db" / "schema.sql")

    UPLOAD_DIR = str(BASE_DIR / "static" / "uploads")
    UPLOAD_URL_PREFIX = "/static/uploads/"
    MAX_CONTENT_LENGTH = 5 * 1024 * 1024          # 单文件 5MB
    USER_UPLOAD_QUOTA = 200 * 1024 * 1024         # 单用户 200MB

    PAGE_SIZE_DEFAULT = 10
    PAGE_SIZE_MAX = 50
    MAX_TAGS_PER_NOTE = 5
    MAX_TITLE_LENGTH = 200
    MAX_NOTE_CONTENT_LENGTH = 100000
    MAX_COMMENT_LENGTH = 1000

    LOGIN_MAX_FAILURES = 5
    LOGIN_FAILURE_WINDOW_SECONDS = 900

    SESSION_COOKIE_HTTPONLY = True
    SESSION_COOKIE_SAMESITE = "Lax"
    SESSION_COOKIE_SECURE = os.environ.get("COOKIE_SECURE", "0") == "1"
