from flask import jsonify

from core.errors import error_message, error_status


def ok(data=None, message="操作成功"):
    return jsonify({"code": "OK", "message": message, "data": data}), 200


def fail(code, message=None, http_status=None):
    return jsonify({
        "code": code,
        "message": message or error_message(code),
        "data": None,
    }), http_status or error_status(code)
