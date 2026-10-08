from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, is_share_unlocked, login_required
from core.markdown import to_plain_text
from core.response import fail, ok
from core.validators import (parse_pagination, validate_content,
                             validate_note_status_for_write, validate_search_keyword,
                             validate_status, validate_tags, validate_title)

bp = Blueprint("notes", __name__, url_prefix="/api/notes")


def note_to_dict(row, tags, include_content=True, include_share=False, summary_limit=80):
    data = {
        "id": row["id"],
        "title": row["title"],
        "status": row["status"],
        "tags": tags,
        "created_at": row["created_at"],
        "updated_at": row["updated_at"],
        "published_at": row["published_at"],
    }
    if include_content:
        data["content_md"] = row["content_md"]
    else:
        data["summary"] = to_plain_text(row["content_md"], limit=summary_limit)
    if include_share:
        data["share_token"] = row["share_token"]
        data["has_share_password"] = row["share_password_hash"] is not None
    return data


def load_owned_note(note_id):
    """返回当前用户拥有的、未删除的笔记；否则 None。"""
    note = db_module.get_note(db_module.get_db(), note_id)
    if note is None or note["is_deleted"]:
        return None
    if note["user_id"] != current_user()["id"]:
        return None
    return note


@bp.post("")
@login_required
def create_note():
    payload = request.get_json(silent=True) or {}
    title = payload.get("title") or ""
    content_md = payload.get("content_md") or ""
    status = payload.get("status") or "draft"
    tags = payload.get("tags")

    for validator, value in ((validate_title, title),
                             (validate_content, content_md),
                             (validate_note_status_for_write, status)):
        passed, code = validator(value)
        if not passed:
            return fail(code)
    passed, result = validate_tags(tags)
    if not passed:
        return fail(result)

    conn = db_module.get_db()
    note_id = db_module.create_note(conn, current_user()["id"], title, content_md, status, result)
    row = db_module.get_note(conn, note_id)
    return ok({"note": note_to_dict(row, db_module.get_note_tags(conn, note_id),
                                    include_share=True)}, "已保存")


@bp.get("")
@login_required
def list_notes():
    args = request.args
    status = args.get("status") or "all"
    if status != "all":
        passed, code = validate_status(status)
        if not passed:
            return fail(code)
    passed, code = validate_search_keyword(args.get("q"))
    if not passed:
        return fail(code)

    sort = args.get("sort") or "updated"
    if sort not in ("updated", "created"):
        return fail("INVALID_PARAM")

    page, page_size = parse_pagination(args, default=10, maximum=50)
    conn = db_module.get_db()
    rows, total = db_module.list_notes(
        conn, current_user()["id"], status=status, q=args.get("q"),
        tag=args.get("tag") or None, sort=sort, page=page, page_size=page_size)

    items = [note_to_dict(r, db_module.get_note_tags(conn, r["id"]), include_content=False)
             for r in rows]
    return ok({"items": items, "total": total, "page": page, "page_size": page_size})


@bp.get("/<int:note_id>")
@login_required
def get_note_detail(note_id):
    conn = db_module.get_db()
    note = db_module.get_note(conn, note_id)
    if note is None or note["is_deleted"]:
        return fail("NOT_FOUND")

    viewer_id = current_user()["id"]
    if note["user_id"] != viewer_id:
        # 他人笔记只有在「已公开分享 + 当前会话已解锁该 token」时才可读；
        # 仅凭猜 id 无法满足（解锁需先经 /api/share/<token>）。载荷不带分享字段。
        if (note["status"] == "public" and note["share_token"]
                and is_share_unlocked(note["share_token"])):
            # 确认可读后记录足迹（仅登录用户；本接口受 login_required 保护）
            db_module.touch_history(conn, viewer_id, note_id)
            return ok({"note": note_to_dict(note, db_module.get_note_tags(conn, note_id),
                                            include_share=False)})
        return fail("NOT_FOUND")

    db_module.touch_history(conn, viewer_id, note_id)
    return ok({"note": note_to_dict(note, db_module.get_note_tags(conn, note_id),
                                    include_share=True)})


@bp.put("/<int:note_id>")
@login_required
def update_note(note_id):
    note = load_owned_note(note_id)
    if note is None:
        return fail("NOT_FOUND")

    payload = request.get_json(silent=True) or {}
    title = payload.get("title")
    content_md = payload.get("content_md")
    status = payload.get("status")
    tags = payload.get("tags")

    for validator, value in ((validate_title, title if title is not None else ""),
                             (validate_content, content_md if content_md is not None else "")):
        if value is not None:
            passed, code = validator(value)
            if not passed:
                return fail(code)
    if status is not None:
        passed, code = validate_note_status_for_write(status)
        if not passed:
            return fail(code)
    if tags is not None:
        passed, result = validate_tags(tags)
        if not passed:
            return fail(result)
    else:
        result = None

    conn = db_module.get_db()
    db_module.update_note(conn, note_id, title=title, content_md=content_md,
                          status=status, tags=result)
    row = db_module.get_note(conn, note_id)
    return ok({"note": note_to_dict(row, db_module.get_note_tags(conn, note_id),
                                    include_share=True)}, "已保存")


@bp.delete("/<int:note_id>")
@login_required
def delete_note(note_id):
    if load_owned_note(note_id) is None:
        return fail("NOT_FOUND")
    db_module.soft_delete_note(db_module.get_db(), note_id)
    return ok(None, "已删除")
