import uuid
from pathlib import Path

from flask import Blueprint, current_app, request
from PIL import Image, UnidentifiedImageError

from core.auth import current_user, login_required
from core.response import fail, ok

bp = Blueprint("uploads", __name__, url_prefix="/api/uploads")

FORMAT_EXTENSIONS = {"JPEG": ".jpg", "PNG": ".png", "GIF": ".gif", "WEBP": ".webp"}


def user_usage(upload_dir, user_id):
    """按文件名前缀 u{user_id}- 统计该用户已占用的字节数。"""
    prefix = f"u{user_id}-"
    total = 0
    for path in Path(upload_dir).glob(f"{prefix}*"):
        if path.is_file():
            total += path.stat().st_size
    return total


@bp.post("/image")
@login_required
def upload_image():
    file = request.files.get("file")
    if file is None or not file.filename:
        return fail("INVALID_PARAM")

    cfg = current_app.config
    upload_dir = Path(cfg["UPLOAD_DIR"])
    upload_dir.mkdir(parents=True, exist_ok=True)
    user_id = current_user()["id"]

    if user_usage(upload_dir, user_id) >= cfg["USER_UPLOAD_QUOTA"]:
        return fail("STORAGE_QUOTA_EXCEEDED")

    try:
        image = Image.open(file.stream)
        image.verify()
        fmt = image.format
    except (UnidentifiedImageError, OSError, ValueError):
        return fail("UPLOAD_TYPE_INVALID")

    extension = FORMAT_EXTENSIONS.get(fmt)
    if extension is None:
        return fail("UPLOAD_TYPE_INVALID")

    file.stream.seek(0)
    name = f"u{user_id}-{uuid.uuid4().hex}{extension}"
    target = upload_dir / name
    try:
        file.save(target)
    except OSError:
        return fail("INTERNAL_ERROR", "图片保存失败，请稍后重试", http_status=500)

    if user_usage(upload_dir, user_id) > cfg["USER_UPLOAD_QUOTA"]:
        target.unlink(missing_ok=True)
        return fail("STORAGE_QUOTA_EXCEEDED")

    return ok({"url": f"{cfg['UPLOAD_URL_PREFIX']}{name}"}, "上传成功")
