"""Phase 6 Task 1 · 分享接口。

- POST   /api/notes/<id>/share   开启/更新分享（可带密码，空密码=无密码）
- DELETE /api/notes/<id>/share   关闭分享（token 与密码哈希一并清空，状态回退 private）
- GET    /api/share/<token>      公开读取（设密且未解锁 → SHARE_PASSWORD_REQUIRED）
- POST   /api/share/<token>/verify 校验密码并写入会话解锁态

公开载荷只暴露 note 的只读字段与作者的 username/avatar，绝不返回 share_token、
share_password_hash、user_id 或邮箱。
"""
from flask import Blueprint, current_app, request

from core import db as db_module
from core.auth import (current_user, forget_share_unlocked, is_share_unlocked,
                       login_required, mark_share_unlocked)
from core.response import fail, ok
from core.security import (clear_failures, generate_share_token, hash_password,
                           is_rate_limited, record_failure, verify_password)
from core.validators import validate_share_password

bp = Blueprint("share", __name__, url_prefix="/api")


def share_note_payload(note, conn):
    return {
        "note": {
            "id": note["id"],
            "title": note["title"],
            "content_md": note["content_md"],
            "tags": db_module.get_note_tags(conn, note["id"]),
            "published_at": note["published_at"],
            "updated_at": note["updated_at"],
        },
        "author": public_author(conn, note["user_id"]),
    }


def public_author(conn, user_id):
    row = db_module.get_user_by_id(conn, user_id)
    if row is None:
        return {"username": "已注销用户", "avatar": None}
    return {"username": row["username"], "avatar": row["avatar"]}


def load_shared_note(token):
    """返回 (note, error_code)。error_code 非空时表示不可访问。"""
    note = db_module.get_note_by_share_token(db_module.get_db(), token)
    if note is None:
        return None, "SHARE_DISABLED"
    if note["share_password_hash"] is not None and not is_share_unlocked(token):
        return None, "SHARE_PASSWORD_REQUIRED"
    return note, None


@bp.post("/notes/<int:note_id>/share")
@login_required
def enable_share(note_id):
    payload = request.get_json(silent=True) or {}
    password = payload.get("password")
    passed, code = validate_share_password(password)
    if not passed:
        return fail(code)

    conn = db_module.get_db()
    note = db_module.get_note(conn, note_id)
    if note is None or note["is_deleted"] or note["user_id"] != current_user()["id"]:
        return fail("NOT_FOUND")

    token = note["share_token"] or generate_share_token()
    password_hash = hash_password(password) if password else None
    db_module.set_note_share(conn, note_id, token, password_hash)

    return ok({"share_url": f"/s/{token}", "has_password": password_hash is not None},
              "已开启分享")


@bp.delete("/notes/<int:note_id>/share")
@login_required
def disable_share(note_id):
    conn = db_module.get_db()
    note = db_module.get_note(conn, note_id)
    if note is None or note["is_deleted"] or note["user_id"] != current_user()["id"]:
        return fail("NOT_FOUND")

    token = note["share_token"]
    db_module.clear_note_share(conn, note_id)
    if token:
        forget_share_unlocked(token)
    return ok(None, "已关闭分享")


@bp.get("/share/<token>")
def read_shared_note(token):
    note, error = load_shared_note(token)
    if error:
        return fail(error)
    # 读到分享内容即视为本次会话已解锁该 token：无密码分享没有 verify 环节，
    # 若不解锁，登录访客拿到正文后仍无法经 GET /api/notes/<id> 打开详情
    # （见 api/notes.py 的「非作者」分支）。仅凭猜 id 无法满足该条件。
    mark_share_unlocked(token)
    return ok(share_note_payload(note, db_module.get_db()))


@bp.post("/share/<token>/verify")
def verify_share_password(token):
    conn = db_module.get_db()
    note = db_module.get_note_by_share_token(conn, token)
    if note is None:
        return fail("SHARE_DISABLED")

    cfg = current_app.config
    if is_rate_limited(conn, "share", token,
                       cfg["LOGIN_MAX_FAILURES"], cfg["LOGIN_FAILURE_WINDOW_SECONDS"]):
        return fail("RATE_LIMITED")

    payload = request.get_json(silent=True) or {}
    password = payload.get("password") or ""
    if note["share_password_hash"] is None:
        mark_share_unlocked(token)
        return ok(share_note_payload(note, conn))

    if not verify_password(note["share_password_hash"], password):
        record_failure(conn, "share", token)
        return fail("SHARE_PASSWORD_WRONG")

    clear_failures(conn, "share", token)
    mark_share_unlocked(token)
    return ok(share_note_payload(note, conn))
