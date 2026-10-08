"""Phase 7 Task 1 · 收藏接口。

- GET    /api/favorites              列出当前用户收藏（含 available 判定）
- POST   /api/favorites              收藏（目标须为本人笔记或公开且带 token 的分享笔记）
- DELETE /api/favorites/<note_id>    取消收藏

失效条目只返回 `title: null` 与 `summary: null`，绝不返回 content_md，
避免分享关闭后内容仍可从收藏读取；列表 JOIN 只取作者 username / avatar，不返回邮箱。
"""
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, login_required
from core.markdown import to_plain_text
from core.response import fail, ok
from core.validators import parse_pagination

bp = Blueprint("favorites", __name__, url_prefix="/api/favorites")


def entry_to_dict(row, viewer_id):
    available = db_module.note_is_viewable(db_module.get_db(), row, viewer_id)
    note = {"id": row["id"], "status": row["status"]}
    if available:
        note["title"] = row["title"]
        note["summary"] = to_plain_text(row["content_md"], limit=80)
        note["tags"] = db_module.get_note_tags(db_module.get_db(), row["id"])
        note["updated_at"] = row["updated_at"]
    else:
        note["title"] = None
        note["summary"] = None
        note["tags"] = []
        note["updated_at"] = None
    return {
        "note": note,
        "author": {"username": row["author_username"], "avatar": row["author_avatar"]},
        "available": available,
        "favorited_at": row["favorited_at"],
    }


@bp.get("")
@login_required
def list_favorites():
    page, page_size = parse_pagination(request.args, default=10, maximum=50)
    viewer_id = current_user()["id"]
    rows, total = db_module.list_favorites(db_module.get_db(), viewer_id, page, page_size)
    items = [entry_to_dict(r, viewer_id) for r in rows]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


@bp.post("")
@login_required
def add_favorite():
    payload = request.get_json(silent=True) or {}
    note_id = payload.get("note_id")
    if not isinstance(note_id, int):
        return fail("INVALID_PARAM")

    conn = db_module.get_db()
    viewer_id = current_user()["id"]
    note = db_module.get_note(conn, note_id)
    if not db_module.note_is_viewable(conn, note, viewer_id):
        return fail("NOT_FOUND")
    if not db_module.add_favorite(conn, viewer_id, note_id):
        return fail("ALREADY_FAVORITED")
    return ok(None, "已收藏")


@bp.delete("/<int:note_id>")
@login_required
def remove_favorite(note_id):
    if not db_module.remove_favorite(db_module.get_db(), current_user()["id"], note_id):
        return fail("NOT_FOUND")
    return ok(None, "已取消收藏")
