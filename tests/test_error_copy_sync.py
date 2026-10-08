import json
import re
from pathlib import Path

from core.errors import ERRORS

AUTH_JS = Path(__file__).resolve().parents[1] / "static" / "js" / "auth.js"


def test_frontend_field_messages_match_backend():
    source = AUTH_JS.read_text(encoding="utf-8")
    match = re.search(r"export const FIELD_MESSAGES = (\{.*?\});", source, re.S)
    assert match, "static/js/auth.js 中未找到 FIELD_MESSAGES 常量"
    frontend = json.loads(match.group(1))
    for code, message in frontend.items():
        assert code in ERRORS, f"前端引用了后端不存在的错误码：{code}"
        assert ERRORS[code][1] == message, f"{code} 的文案前后端不一致"
