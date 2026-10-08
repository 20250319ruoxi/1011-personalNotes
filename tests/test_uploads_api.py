import io
from pathlib import Path

import pytest
from PIL import Image


@pytest.fixture(autouse=True)
def clean_uploads(app):
    """上传接口必须把文件落到 static/uploads/ 才能被 /static/ 路由取回，
    因此这里在用例前后清理该目录下的用户文件，避免测试残留污染真实上传目录、
    并防止上一轮残留让配额用例跨次耦合。"""
    upload_dir = Path(app.config["UPLOAD_DIR"])

    def _user_files():
        if not upload_dir.exists():
            return set()
        return set(upload_dir.glob("u*-*"))

    before = _user_files()
    yield
    for path in _user_files() - before:
        path.unlink(missing_ok=True)


def make_image(fmt="PNG", size=(4, 4)):
    buf = io.BytesIO()
    Image.new("RGB", size, (200, 160, 120)).save(buf, format=fmt)
    buf.seek(0)
    return buf


def upload(c, headers, buf, filename):
    return c.post("/api/uploads/image", data={"file": (buf, filename)},
                  headers=headers, content_type="multipart/form-data")


def test_upload_png_succeeds_and_is_referencable(app, alice):
    c, headers = alice
    resp = upload(c, headers, make_image("PNG"), "photo.png")
    body = resp.get_json()
    assert resp.status_code == 200 and body["code"] == "OK"
    url = body["data"]["url"]
    assert url.startswith("/static/uploads/") and url.endswith(".png")
    assert c.get(url).status_code == 200


def test_upload_ignores_client_extension_and_uses_real_format(app, alice):
    c, headers = alice
    url = upload(c, headers, make_image("WEBP"), "trick.jpg").get_json()["data"]["url"]
    assert url.endswith(".webp")


def test_upload_rejects_disguised_non_image(app, alice):
    c, headers = alice
    resp = upload(c, headers, io.BytesIO("这不是图片".encode("utf-8")), "fake.png")
    assert resp.status_code == 400
    assert resp.get_json()["code"] == "UPLOAD_TYPE_INVALID"


def test_upload_rejects_disallowed_format(app, alice):
    c, headers = alice
    resp = upload(c, headers, make_image("BMP"), "image.bmp")
    assert resp.get_json()["code"] == "UPLOAD_TYPE_INVALID"


def test_upload_too_large(app, alice):
    c, headers = alice
    # 纯色 PNG 压缩率极高，(200,200) 也仅约 800 字节，故上限需低于实际请求体，
    # 才能真正触发 MAX_CONTENT_LENGTH 溢出 → 413 UPLOAD_TOO_LARGE。
    app.config["MAX_CONTENT_LENGTH"] = 512
    resp = upload(c, headers, make_image("PNG", (200, 200)), "big.png")
    assert resp.status_code == 413
    assert resp.get_json()["code"] == "UPLOAD_TOO_LARGE"


def test_upload_quota_exceeded(app, alice):
    c, headers = alice
    app.config["USER_UPLOAD_QUOTA"] = 10
    resp = upload(c, headers, make_image("PNG"), "quota.png")
    assert resp.status_code == 413
    assert resp.get_json()["code"] == "STORAGE_QUOTA_EXCEEDED"


def test_upload_requires_login(client):
    resp = client.post("/api/uploads/image", data={"file": (make_image(), "a.png")},
                       content_type="multipart/form-data")
    assert resp.status_code == 401


def test_upload_requires_file_field(alice):
    c, headers = alice
    assert c.post("/api/uploads/image", data={}, headers=headers,
                  content_type="multipart/form-data").get_json()["code"] == "INVALID_PARAM"


def test_uploads_are_namespaced_per_user(app, alice):
    c, headers = alice
    url = upload(c, headers, make_image("PNG"), "a.png").get_json()["data"]["url"]
    assert url.split("/")[-1].startswith("u1-")
