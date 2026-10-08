"""Phase 6 Task 2 · 评论接口与权限矩阵。

- GET    /api/notes/<id>/comments   作者视角列表（非作者 NOT_FOUND）
- POST   /api/notes/<id>/comments   作者在详情页自评
- GET    /api/share/<token>/comments  公开列表（设密需已解锁）
- POST   /api/share/<token>/comments  登录用户评论（设密需已解锁）
- DELETE /api/comments/<id>         评论作者或笔记作者可删；软删除

`can_delete` 由服务端计算（viewer 是否为评论作者或笔记作者），删除接口自身再判定一次权限，
绝不信任前端传入的任何标记。
"""
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, is_share_unlocked, login_required
from core.response import fail, ok
from core.validators import parse_pagination, validate_comment

bp = Blueprint("comments", __name__, url_prefix="/api")


def comment_to_dict(row, note_owner_id, viewer_id):
    return {
        "id": row["id"],
        "content": row["content"],
        "created_at": row["created_at"],
        "author": {
            "id": row["user_id"],
            "username": row["author_username"],
            "avatar": row["author_avatar"],
        },
        "can_delete": viewer_id in (row["user_id"], note_owner_id),
    }


def owned_note_or_none(note_id, user_id):
    note = db_module.get_note(db_module.get_db(), note_id)
    if note is None or note["is_deleted"] or note["user_id"] != user_id:
        return None
    return note


def shared_note_or_error(token):
    note = db_module.get_note_by_share_token(db_module.get_db(), token)
    if note is None:
        return None, "SHARE_DISABLED"
    if note["share_password_hash"] is not None and not is_share_unlocked(token):
        return None, "SHARE_PASSWORD_REQUIRED"
    return note, None


def _list_response(note, args, viewer_id):
    page, page_size = parse_pagination(args, default=10, maximum=50)
    rows, total = db_module.list_comments(db_module.get_db(), note["id"], page, page_size)
    items = [comment_to_dict(r, note["user_id"], viewer_id) for r in rows]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


def _create_response(note, viewer_id):
    payload = request.get_json(silent=True) or {}
    content = payload.get("content")
    passed, code = validate_comment(content)
    if not passed:
        return fail(code)
    conn = db_module.get_db()
    comment_id = db_module.create_comment(conn, note["id"], viewer_id, content.strip())
    row = conn.execute(
        "SELECT c.*, u.username AS author_username, u.avatar AS author_avatar "
        "FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?",
        (comment_id,),
    ).fetchone()
    return ok({"comment": comment_to_dict(row, note["user_id"], viewer_id)}, "已发表评论")


@bp.get("/notes/<int:note_id>/comments")
@login_required
def list_owner_comments(note_id):
    note = owned_note_or_none(note_id, current_user()["id"])
    if note is None:
        return fail("NOT_FOUND")
    return _list_response(note, request.args, current_user()["id"])


@bp.post("/notes/<int:note_id>/comments")
@login_required
def create_owner_comment(note_id):
    note = owned_note_or_none(note_id, current_user()["id"])
    if note is None:
        return fail("NOT_FOUND")
    return _create_response(note, current_user()["id"])


@bp.get("/share/<token>/comments")
def list_shared_comments(token):
    note, error = shared_note_or_error(token)
    if error:
        return fail(error)
    viewer = current_user()
    return _list_response(note, request.args, viewer["id"] if viewer else None)


@bp.post("/share/<token>/comments")
@login_required
def create_shared_comment(token):
    note, error = shared_note_or_error(token)
    if error:
        return fail(error)
    return _create_response(note, current_user()["id"])


@bp.delete("/comments/<int:comment_id>")
@login_required
def delete_comment(comment_id):
    conn = db_module.get_db()
    comment = db_module.get_comment(conn, comment_id)
    if comment is None or comment["is_deleted"]:
        return fail("NOT_FOUND")

    note = db_module.get_note(conn, comment["note_id"])
    viewer_id = current_user()["id"]
    if viewer_id not in (comment["user_id"], note["user_id"] if note else None):
        return fail("FORBIDDEN")

    db_module.soft_delete_comment(conn, comment_id)
    return ok(None, "评论已删除")
