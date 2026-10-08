"""Phase 7 Task 1 · 浏览足迹接口。

- GET    /api/history              列出当前用户足迹（按 viewed_at DESC, id DESC）
- DELETE /api/history              清空全部足迹
- DELETE /api/history/<note_id>    移除单条足迹

足迹由服务端在「读取笔记详情」与「读取/校验分享」成功时写入（见 api/notes.py、api/share.py），
且仅记录已登录用户；本模块只负责查询与删除，列表接口本身无副作用。
"""
from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, login_required
from core.markdown import to_plain_text
from core.response import fail, ok
from core.validators import parse_pagination

bp = Blueprint("history", __name__, url_prefix="/api/history")


def entry_to_dict(row, viewer_id):
    available = db_module.note_is_viewable(db_module.get_db(), row, viewer_id)
    return {
        "note": {
            "id": row["id"],
            "status": row["status"],
            "title": row["title"] if available else None,
            "summary": to_plain_text(row["content_md"], limit=80) if available else None,
            "tags": db_module.get_note_tags(db_module.get_db(), row["id"]) if available else [],
        },
        "author": {"username": row["author_username"], "avatar": row["author_avatar"]},
        "available": available,
        "viewed_at": row["viewed_at"],
    }


@bp.get("")
@login_required
def list_history():
    page, page_size = parse_pagination(request.args, default=10, maximum=50)
    viewer_id = current_user()["id"]
    rows, total = db_module.list_history(db_module.get_db(), viewer_id, page, page_size)
    items = [entry_to_dict(r, viewer_id) for r in rows]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


@bp.delete("")
@login_required
def clear_history():
    db_module.clear_history(db_module.get_db(), current_user()["id"])
    return ok(None, "已清空浏览记录")


@bp.delete("/<int:note_id>")
@login_required
def delete_history_item(note_id):
    if not db_module.delete_history_item(db_module.get_db(), current_user()["id"], note_id):
        return fail("NOT_FOUND")
    return ok(None, "已移除")
