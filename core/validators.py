import re

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]{2,}$")
USERNAME_RE = re.compile(r"^\w{3,20}$")
STATUSES = ("draft", "private", "public")
MAX_TAG_LENGTH = 20


def validate_email(email):
    if not isinstance(email, str) or not EMAIL_RE.match(email.strip()):
        return False, "EMAIL_INVALID"
    return True, None


def validate_username(username):
    if not isinstance(username, str) or not USERNAME_RE.match(username.strip()):
        return False, "INVALID_PARAM"
    return True, None


def validate_password(password):
    if not isinstance(password, str) or not 8 <= len(password) <= 64:
        return False, "PASSWORD_WEAK"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return False, "PASSWORD_WEAK"
    return True, None


def validate_title(title):
    if not isinstance(title, str):
        return False, "INVALID_PARAM"
    if len(title) > 200:
        return False, "CONTENT_TOO_LONG"
    return True, None


def validate_content(content):
    if not isinstance(content, str):
        return False, "INVALID_PARAM"
    if len(content) > 100000:
        return False, "CONTENT_TOO_LONG"
    return True, None


def validate_comment(content):
    if not isinstance(content, str) or not content.strip():
        return False, "INVALID_PARAM"
    if len(content) > 1000:
        return False, "CONTENT_TOO_LONG"
    return True, None


def validate_status(status):
    if status not in STATUSES:
        return False, "INVALID_PARAM"
    return True, None


def validate_tags(tags):
    if tags is None:
        return True, []
    if not isinstance(tags, list):
        return False, "INVALID_PARAM"
    cleaned = []
    for raw in tags:
        if not isinstance(raw, str):
            return False, "INVALID_PARAM"
        name = raw.strip()
        if not name:
            continue
        if len(name) > MAX_TAG_LENGTH:
            return False, "CONTENT_TOO_LONG"
        if name not in cleaned:
            cleaned.append(name)
    if len(cleaned) > 5:
        return False, "TAG_TOO_MANY"
    return True, cleaned


WRITABLE_STATUSES = ("draft", "private")


def validate_note_status_for_write(status):
    """笔记写入接口（创建/更新）只接受 draft 与 private；
    public 只能由 POST /notes/<id>/share 进入。"""
    if status not in WRITABLE_STATUSES:
        return False, "INVALID_PARAM"
    return True, None


def validate_search_keyword(q):
    if q is None:
        return True, None
    if not isinstance(q, str):
        return False, "INVALID_PARAM"
    if len(q) > 100:
        return False, "CONTENT_TOO_LONG"
    return True, None


def parse_pagination(args, default=10, maximum=50):
    def _int(value, fallback):
        try:
            return int(value)
        except (TypeError, ValueError):
            return fallback

    page = max(1, _int(args.get("page"), 1))
    page_size = _int(args.get("page_size"), default)
    page_size = min(max(page_size, 1), maximum)
    return page, page_size
