from flask import Blueprint

from core import db as db_module
from core.auth import current_user, login_required
from core.response import ok

bp = Blueprint("tags", __name__, url_prefix="/api/tags")


@bp.get("")
@login_required
def list_tags():
    rows = db_module.get_user_tags(db_module.get_db(), current_user()["id"])
    return ok({"items": [{"name": r["name"], "count": r["count"]} for r in rows]})
