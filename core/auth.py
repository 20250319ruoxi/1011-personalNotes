import re
from functools import wraps

from flask import g, request, session

from core import db as db_module
from core.response import fail
from core.security import generate_csrf_token


def serialize_user(row):
    return {
        "id": row["id"],
        "username": row["username"],
        "email": row["email"],
        "avatar": row["avatar"],
        "bio": row["bio"],
        "created_at": row["created_at"],
    }


def ensure_csrf_token():
    token = session.get("csrf_token")
    if not token:
        token = generate_csrf_token()
        session["csrf_token"] = token
    return token


def start_session(user):
    session.clear()
    session["user_id"] = user["id"]
    session.permanent = False


def current_user():
    if "current_user" in g:
        return g.current_user
    user_id = session.get("user_id")
    g.current_user = db_module.get_user_by_id(db_module.get_db(), user_id) if user_id else None
    return g.current_user


def login_required(view):
    @wraps(view)
    def wrapper(*args, **kwargs):
        if current_user() is None:
            return fail("UNAUTHORIZED")
        return view(*args, **kwargs)
    return wrapper


CSRF_EXEMPT = (("/api/auth/register", "POST"), ("/api/auth/login", "POST"))
SHARE_VERIFY_RE = re.compile(r"^/api/share/[^/]+/verify$")


def _is_csrf_exempt(path, method):
    if SHARE_VERIFY_RE.match(path):
        return True
    return (path, method) in CSRF_EXEMPT


def _same_origin():
    origin = request.headers.get("Origin") or request.headers.get("Referer")
    if not origin:
        return True          # 非浏览器客户端（如测试与 curl）不带 Origin，放行并由限流兜底
    if "://" not in origin:
        return False
    return origin.split("/")[2] == request.host


def init_app(app):
    @app.before_request
    def _csrf_protect():
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return None
        if not request.path.startswith("/api/"):
            return None
        if _is_csrf_exempt(request.path, request.method):
            return None if _same_origin() else fail("CSRF_INVALID")
        token = session.get("csrf_token")
        if token is None:
            # 尚未建立任何会话（未注册/未登录）：不存在可被利用的会话凭证，
            # 交由 login_required 返回统一的 UNAUTHORIZED，避免用状态码差异
            # 暴露「哪些接口带 CSRF 保护」。
            return None
        if request.headers.get("X-CSRF-Token") != token:
            return fail("CSRF_INVALID")
        return None
