import pytest

from core import validators as v


@pytest.mark.parametrize("email", ["a@b.co", "user.name+tag@sub.example.com"])
def test_valid_email_accepted(email):
    assert v.validate_email(email) == (True, None)


@pytest.mark.parametrize("email", ["", "a@b", "a b@c.com", "a@@b.com", "@b.com"])
def test_invalid_email_rejected(email):
    assert v.validate_email(email) == (False, "EMAIL_INVALID")


@pytest.mark.parametrize("name", ["abc", "中文名", "user_1", "a1234567890123456789"])
def test_valid_username_accepted(name):
    assert v.validate_username(name) == (True, None)


@pytest.mark.parametrize("name", ["ab", "a" * 21, "has space", "has-dash", "has.dot"])
def test_invalid_username_rejected(name):
    assert v.validate_username(name) == (False, "INVALID_PARAM")


@pytest.mark.parametrize("password", ["passw0rd", "a1" * 4, "X" * 63 + "1"])
def test_valid_password_accepted(password):
    assert v.validate_password(password) == (True, None)


@pytest.mark.parametrize("password", ["short1", "a" * 8, "1" * 8, "p" * 65 + "1"])
def test_weak_password_rejected(password):
    assert v.validate_password(password) == (False, "PASSWORD_WEAK")


def test_note_title_and_content_limits():
    assert v.validate_title("x" * 200) == (True, None)
    assert v.validate_title("x" * 201) == (False, "CONTENT_TOO_LONG")
    assert v.validate_content("x" * 100000) == (True, None)
    assert v.validate_content("x" * 100001) == (False, "CONTENT_TOO_LONG")


def test_comment_limit():
    assert v.validate_comment("好") == (True, None)
    assert v.validate_comment("") == (False, "INVALID_PARAM")
    assert v.validate_comment("x" * 1001) == (False, "CONTENT_TOO_LONG")


def test_tags_normalized_deduped_and_limited():
    assert v.validate_tags([" 生活 ", "生活", "work"]) == (True, ["生活", "work"])
    assert v.validate_tags([]) == (True, [])
    assert v.validate_tags(["a", "b", "c", "d", "e", "f"]) == (False, "TAG_TOO_MANY")
    assert v.validate_tags(["x" * 21]) == (False, "CONTENT_TOO_LONG")
    assert v.validate_tags("不是列表") == (False, "INVALID_PARAM")


def test_status_whitelist():
    assert v.validate_status("draft") == (True, None)
    assert v.validate_status("private") == (True, None)
    assert v.validate_status("public") == (True, None)
    assert v.validate_status("weird") == (False, "INVALID_PARAM")


def test_pagination_bounds():
    assert v.parse_pagination({}, default=10, maximum=50) == (1, 10)
    assert v.parse_pagination({"page": "3", "page_size": "20"}, default=10, maximum=50) == (3, 20)
    assert v.parse_pagination({"page": "0", "page_size": "999"}, default=10, maximum=50) == (1, 50)
    assert v.parse_pagination({"page": "abc"}, default=10, maximum=50) == (1, 10)
