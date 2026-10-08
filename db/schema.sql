PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  email         TEXT    NOT NULL UNIQUE,
  username      TEXT    NOT NULL UNIQUE,
  password_hash TEXT    NOT NULL,
  avatar        TEXT,                      -- 头像图片 URL，为空则前端用用户名首字色块
  bio           TEXT,
  created_at    TEXT    NOT NULL           -- ISO8601 UTC
);

CREATE TABLE IF NOT EXISTS notes (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title               TEXT    NOT NULL DEFAULT '',
  content_md          TEXT    NOT NULL DEFAULT '',
  status              TEXT    NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','private','public')),
  share_token         TEXT    UNIQUE,      -- 仅 status='public' 时存在
  share_password_hash TEXT,                -- 为空表示分享链接无需密码
  created_at          TEXT    NOT NULL,
  updated_at          TEXT    NOT NULL,
  published_at        TEXT,
  is_deleted          INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_notes_owner   ON notes(user_id, is_deleted, updated_at DESC);
CREATE INDEX IF NOT EXISTS idx_notes_status  ON notes(user_id, status, is_deleted);

CREATE TABLE IF NOT EXISTS tags (
  id   INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS note_tags (
  note_id INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  tag_id  INTEGER NOT NULL REFERENCES tags(id)  ON DELETE CASCADE,
  PRIMARY KEY (note_id, tag_id)
);

CREATE TABLE IF NOT EXISTS comments (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  content    TEXT    NOT NULL,
  created_at TEXT    NOT NULL,
  is_deleted INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_comments_note ON comments(note_id, created_at);

CREATE TABLE IF NOT EXISTS favorites (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id    INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  created_at TEXT    NOT NULL,
  UNIQUE (user_id, note_id)
);

CREATE TABLE IF NOT EXISTS view_history (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id   INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  note_id   INTEGER NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
  viewed_at TEXT    NOT NULL,
  UNIQUE (user_id, note_id)                -- 重复浏览更新 viewed_at
);
CREATE INDEX IF NOT EXISTS idx_history_user ON view_history(user_id, viewed_at DESC);

CREATE TABLE IF NOT EXISTS auth_attempts (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  scope      TEXT NOT NULL,                -- 'login' | 'share'
  key        TEXT NOT NULL,                -- 登录为小写邮箱，分享为 share_token
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_attempts ON auth_attempts(scope, key, created_at);
