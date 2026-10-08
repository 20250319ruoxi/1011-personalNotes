import mimetypes

from flask import Flask, request, send_from_directory
from werkzeug.exceptions import HTTPException

from config import Config
from core import db as db_module
from core.response import fail

# 部分系统（含本机 Windows）的 mimetypes 数据库不含 .webp，
# 会导致静态服务图片时 Content-Type 为空，配合 nosniff 可能被客户端拒绝渲染。
mimetypes.add_type("image/webp", ".webp")


def create_app(config_object=Config):
    app = Flask(__name__, static_folder="static", static_url_path="/static")
    app.config.from_object(config_object)
    app.json.ensure_ascii = False   # 保证中文 message 原样输出
    app.json.sort_keys = False

    db_module.init_app(app)
    register_blueprints(app)
    register_error_handlers(app)
    register_spa_fallback(app)
    return app


BLUEPRINT_MODULES = ("auth", "users", "notes", "tags", "share",
                     "comments", "favorites", "history", "uploads")


def register_blueprints(app):
    """按固定顺序注册「文件已存在」的蓝图模块。

    各蓝图由不同阶段创建，此处按文件存在性判断：
    既避免模块尚未创建时启动失败，也不会吞掉模块内部的真实导入错误。
    """
    import importlib
    from pathlib import Path

    for name in BLUEPRINT_MODULES:
        if not (Path(app.root_path) / "api" / f"{name}.py").exists():
            continue
        module = importlib.import_module(f"api.{name}")
        app.register_blueprint(module.bp)


def register_error_handlers(app):
    @app.errorhandler(HTTPException)
    def handle_http_exception(exc):
        if request.path.startswith("/api/"):
            if exc.code == 404:
                return fail("NOT_FOUND")
            if exc.code == 413:
                return fail("UPLOAD_TOO_LARGE")
            return fail("INTERNAL_ERROR", http_status=exc.code)
        # /static/* 的 404 不得复用 SPA 兜底：静态资源缺失必须保持 404，
        # 否则拼错的资源路径会静默返回 index.html（catch-all 不得吞 /static/*）。
        if exc.code == 404 and not request.path.startswith("/static/"):
            return send_from_directory(app.root_path, "index.html")
        return exc

    @app.errorhandler(Exception)
    def handle_unexpected(exc):
        app.logger.exception("未处理异常: %s", exc)
        return fail("INTERNAL_ERROR")


def register_spa_fallback(app):
    @app.route("/", defaults={"path": ""})
    @app.route("/<path:path>")
    def spa(path):
        if path.startswith(("api/", "static/")):
            return fail("NOT_FOUND")
        return send_from_directory(app.root_path, "index.html")


def register_cli(app):
    @app.cli.command("init-db")
    def init_db_command():
        db_module.init_db(app)
        print("数据库初始化完成")


if __name__ == "__main__":
    import sys

    from waitress import serve

    cli_app = create_app()
    command = sys.argv[1] if len(sys.argv) > 1 else "run"
    if command == "init-db":
        with cli_app.app_context():
            db_module.init_db(cli_app)
        print("数据库初始化完成")
    elif command == "run":
        cli_app.run(host="127.0.0.1", port=5000, debug=True)
    elif command == "serve":
        serve(cli_app, host="0.0.0.0", port=5000)
    else:
        print(f"未知命令: {command}（可用：init-db / run / serve）")
