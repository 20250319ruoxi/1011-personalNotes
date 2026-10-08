from flask import Blueprint, request, session

from core import db as db_module
from core.auth import (current_user, ensure_csrf_token, login_required,
                       serialize_user, start_session)
from core.db import current_app_config
from core.response import fail, ok
from core.security import (clear_failures, hash_password, is_rate_limited,
                           record_failure, verify_password)
from core.validators import validate_email, validate_password, validate_username

bp = Blueprint("auth", __name__, url_prefix="/api/auth")


@bp.post("/register")
def register():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    username = (payload.get("username") or "").strip()
    password = payload.get("password") or ""
    confirm = payload.get("confirm_password") or ""

    for validator, value in ((validate_email, email),
                             (validate_username, username),
                             (validate_password, password)):
        passed, code = validator(value)
        if not passed:
            return fail(code)
    if password != confirm:
        return fail("PASSWORD_MISMATCH")

    conn = db_module.get_db()
    if db_module.get_user_by_email(conn, email):
        return fail("EMAIL_EXISTS")
    if db_module.get_user_by_username(conn, username):
        return fail("USERNAME_EXISTS")

    cursor = conn.execute(
        "INSERT INTO users (email, username, password_hash, created_at) VALUES (?, ?, ?, ?)",
        (email, username, hash_password(password), db_module.now_iso()),
    )
    conn.commit()
    user = db_module.get_user_by_id(conn, cursor.lastrowid)
    start_session(user)
    return ok({"user": serialize_user(user), "csrf_token": ensure_csrf_token()}, "注册成功")


@bp.post("/login")
def login():
    payload = request.get_json(silent=True) or {}
    email = (payload.get("email") or "").strip().lower()
    password = payload.get("password") or ""
    if not email or not password:
        return fail("INVALID_PARAM")

    conn = db_module.get_db()
    if is_rate_limited(conn, "login", email,
                       current_app_config("LOGIN_MAX_FAILURES"),
                       current_app_config("LOGIN_FAILURE_WINDOW_SECONDS")):
        return fail("RATE_LIMITED")

    user = db_module.get_user_by_email(conn, email)
    if user is None or not verify_password(user["password_hash"], password):
        record_failure(conn, "login", email)
        return fail("INVALID_CREDENTIALS")

    clear_failures(conn, "login", email)
    start_session(user)
    return ok({"user": serialize_user(user), "csrf_token": ensure_csrf_token()}, "登录成功")


@bp.post("/logout")
@login_required
def logout():
    session.clear()
    return ok(None, "已退出登录")


@bp.get("/me")
def me():
    user = current_user()
    if user is None:
        return ok({"user": None, "csrf_token": None})
    return ok({"user": serialize_user(user), "csrf_token": ensure_csrf_token()})
