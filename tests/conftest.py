import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import create_app
from config import Config
from core import db as db_module


class TestConfig(Config):
    TESTING = True
    SECRET_KEY = "test-secret"
    SERVER_NAME = None


@pytest.fixture()
def app(tmp_path):
    class _Cfg(TestConfig):
        DATABASE = str(tmp_path / "test.db")

    application = create_app(_Cfg)
    with application.app_context():
        db_module.init_db(application)
    yield application


@pytest.fixture()
def client(app):
    return app.test_client()


@pytest.fixture()
def alice(client):
    """返回 (client, csrf_headers)，已注册并登录 alice。"""
    resp = client.post("/api/auth/register", json={
        "email": "alice@example.com", "username": "alice",
        "password": "passw0rd", "confirm_password": "passw0rd",
    })
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return client, {"X-CSRF-Token": resp.get_json()["data"]["csrf_token"]}


@pytest.fixture()
def bob_raw(client):
    """在独立客户端中注册 bob，用于越权测试。"""
    other = client.application.test_client()
    resp = other.post("/api/auth/register", json={
        "email": "bob@example.com", "username": "bob",
        "password": "passw0rd", "confirm_password": "passw0rd",
    })
    assert resp.status_code == 200, resp.get_data(as_text=True)
    return other, {"X-CSRF-Token": resp.get_json()["data"]["csrf_token"]}
