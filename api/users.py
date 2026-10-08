from flask import Blueprint, request

from core import db as db_module
from core.auth import current_user, login_required, serialize_user
from core.db import current_app_config
from core.response import fail, ok
from core.security import hash_password, verify_password
from core.validators import validate_password, validate_username

bp = Blueprint("users", __name__, url_prefix="/api/users")

MAX_BIO_LENGTH = 200
MAX_AVATAR_LENGTH = 300


@bp.get("/me/profile")
@login_required
def get_profile():
    return ok({"user": serialize_user(current_user())})


@bp.put("/me/profile")
@login_required
def update_profile():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    conn = db_module.get_db()

    username = payload.get("username")
    if username is not None:
        username = username.strip()
        passed, code = validate_username(username)
        if not passed:
            return fail(code)
        existing = db_module.get_user_by_username(conn, username)
        if existing and existing["id"] != user["id"]:
            return fail("USERNAME_EXISTS")

    bio = payload.get("bio")
    if bio is not None:
        if not isinstance(bio, str) or len(bio) > MAX_BIO_LENGTH:
            return fail("CONTENT_TOO_LONG")

    avatar = payload.get("avatar")
    if avatar is not None:
        if not isinstance(avatar, str) or len(avatar) > MAX_AVATAR_LENGTH:
            return fail("INVALID_PARAM")
        if avatar and not avatar.startswith(current_app_config("UPLOAD_URL_PREFIX")):
            return fail("INVALID_PARAM")

    db_module.update_user_profile(conn, user["id"], username, bio, avatar)
    return ok({"user": serialize_user(db_module.get_user_by_id(conn, user["id"]))}, "已保存")


@bp.put("/me/password")
@login_required
def change_password():
    user = current_user()
    payload = request.get_json(silent=True) or {}
    old = payload.get("old_password") or ""
    new = payload.get("new_password") or ""
    confirm = payload.get("confirm_password") or ""

    if not verify_password(user["password_hash"], old):
        return fail("PASSWORD_WRONG")
    passed, code = validate_password(new)
    if not passed:
        return fail(code)
    if new != confirm:
        return fail("PASSWORD_MISMATCH")

    conn = db_module.get_db()
    db_module.update_user_password(conn, user["id"], hash_password(new))
    return ok(None, "密码已修改")
