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
