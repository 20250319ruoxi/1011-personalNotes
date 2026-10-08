"""Phase 3 认证视图 / 登录守卫 渲染契约。

本环境无浏览器，因此用 `tests/js/render_auth.mjs`（复用 `tests/js/dom-shim.mjs` 的最小 DOM
双端）在 Node 中真实调用 `static/js/auth.js` 的 `renderLogin` / `renderRegister`、`ui.js` 的
已登录顶栏，以及 `router.js` 的登录守卫，断言生成的标记、字段级校验文案、redirect 白名单
判定、头像菜单与退出确认行为。浏览器像素观感另见 `tests/manual/visual-checklist.md`。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "js" / "render_auth.mjs"

EMAIL_INVALID = "请输入正确的邮箱地址"
PASSWORD_WEAK = "密码长度需为 8-64 位，且包含字母与数字"
PASSWORD_MISMATCH = "两次输入的密码不一致"
INVALID_PARAM = "参数不合法，请检查后重试"


@pytest.fixture(scope="module")
def rendered() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("未检测到 node，跳过 Node DOM 渲染契约测试")
    proc = subprocess.run(
        [node, str(HARNESS)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, f"node 渲染失败：\n{proc.stdout}\n{proc.stderr}"
    return json.loads(proc.stdout)


def block(rendered: dict, key: str):
    value = rendered.get(key)
    assert value, f"{key} 渲染失败：{rendered.get('errors')}"
    return value


def anchors(html: str) -> list[tuple[str, str]]:
    return re.findall(r"<a\b([^>]*)>(.*?)</a>", html, re.S)


def anchor_by_href(html: str, href: str) -> tuple[str, str] | None:
    for attrs, inner in anchors(html):
        if f'href="{href}"' in attrs:
            return attrs, inner
    return None


# --------------------------------------------------------------------------
# 登录页
# --------------------------------------------------------------------------

def test_login_page_structure_and_copy(rendered):
    html = block(rendered, "loginHtml")
    assert 'class="auth-page"' in html
    assert 'class="auth-card"' in html
    assert block(rendered, "loginTitle") == "登录"
    assert block(rendered, "loginSubmitText") == "登录"

    footer = block(rendered, "loginFooter")
    assert footer["text"] == "还没有账号？去注册"
    assert footer["href"] == "/register"


def test_login_fields_types_and_autocomplete(rendered):
    fields = block(rendered, "loginFields")
    assert [f["name"] for f in fields] == ["email", "password"]
    assert [f["label"] for f in fields] == ["邮箱", "密码"]
    assert [f["type"] for f in fields] == ["email", "password"]
    assert [f["autocomplete"] for f in fields] == ["email", "current-password"]
    assert all(f["errorRole"] == "alert" for f in fields), "字段错误需为 role=alert"


# --------------------------------------------------------------------------
# 注册页
# --------------------------------------------------------------------------

def test_register_page_structure_and_copy(rendered):
    html = block(rendered, "registerHtml")
    assert 'class="auth-page"' in html
    assert 'class="auth-card"' in html
    assert "<h1" in html and "注册" in html

    footer = block(rendered, "registerFooter")
    assert footer["text"] == "已有账号？去登录"
    assert footer["href"] == "/login"


def test_register_fields_types_and_autocomplete(rendered):
    fields = block(rendered, "registerFields")
    assert [f["name"] for f in fields] == ["email", "username", "password", "confirm"]
    assert [f["label"] for f in fields] == ["邮箱", "用户名", "密码", "确认密码"]
    assert [f["type"] for f in fields] == ["email", "text", "password", "password"]
    assert [f["autocomplete"] for f in fields] == [
        "email", "username", "new-password", "new-password",
    ]


# --------------------------------------------------------------------------
# 字段级失焦校验（文案与后端逐字一致）
# --------------------------------------------------------------------------

def test_email_blur_marks_invalid_and_clears_on_fix(rendered):
    bad = block(rendered, "emailBlur")
    assert bad["error"] == EMAIL_INVALID
    assert bad["invalid"] is True
    assert bad["ariaInvalid"] == "true"

    fixed = block(rendered, "emailClears")
    assert fixed["error"] == ""
    assert fixed["invalid"] is False


def test_password_blur_reports_weak(rendered):
    bad = block(rendered, "passwordBlur")
    assert bad["error"] == PASSWORD_WEAK
    assert bad["invalid"] is True


def test_register_username_password_confirm_validation(rendered):
    v = block(rendered, "registerValidation")
    assert v["usernameError"] == INVALID_PARAM
    assert v["passwordError"] == PASSWORD_WEAK
    assert v["passwordInvalid"] is True
    assert v["passwordCleared"] == "", "密码修正后应清空该字段错误"
    assert v["confirmError"] == PASSWORD_MISMATCH
    assert v["confirmInvalid"] is True


def test_invalid_form_does_not_send_request(rendered):
    assert rendered["blockedSubmitFetchCount"] == 0


# --------------------------------------------------------------------------
# 提交 loading 与成功跳转
# --------------------------------------------------------------------------

def test_submit_enters_loading_state(rendered):
    loading = block(rendered, "loading")
    assert loading["text"] == "提交中…"
    assert loading["disabledAttr"] is True
    assert loading["loadingClass"] is True
    assert loading["spinner"] is True, "loading 态应显示转圈"


def test_successful_login_sets_store_and_honours_redirect(rendered):
    assert rendered["loggedInUser"] == "alice"
    assert rendered["loggedInCsrf"] == "csrf-1"
    assert rendered["loginNavUrl"] == "/notes/new"


def test_server_error_maps_to_field(rendered):
    mapped = block(rendered, "mapped")
    assert mapped["passwordError"] == PASSWORD_WEAK
    assert mapped["passwordInvalid"] is True
    assert mapped["emailError"] == ""


# --------------------------------------------------------------------------
# redirect 白名单（防开放重定向）
# --------------------------------------------------------------------------

def test_redirect_whitelist_predicate(rendered):
    r = block(rendered, "redirect")
    assert r["slash"] == "/notes"
    assert r["slashWithQuery"] == "/notes?page=2"
    assert r["doubleSlash"] == "/me", "//evil.example 必须被拒绝"
    assert r["absolute"] == "/me", "绝对 URL 必须被拒绝"
    assert r["empty"] == "/me"
    assert r["none"] == "/me"
    assert r["backslash"] == "/me"


# --------------------------------------------------------------------------
# 登录守卫
# --------------------------------------------------------------------------

def test_guard_redirects_anonymous_to_login_with_back_target(rendered):
    guard = block(rendered, "guard")
    assert guard["guardRedirectUrl"] == "/login?redirect=%2Fguard-test"
    assert guard["method"] == "replace"


def test_unregistered_route_does_not_crash_guard(rendered):
    """未注册路由：守卫不得崩溃，落到「页面不存在」视图。

    注：Phase 3 时曾用 /me 作为「未注册路由」探针；Phase 7 已注册 /me（requiresAuth），
    因此探针改为真正未注册的 `/__not-a-route__`。`/me` 自身的守卫行为见
    `tests/test_profile_frontend.py::test_me_route_requires_auth`。
    """
    assert "missing" not in rendered["errors"], rendered["errors"]
    missing = block(rendered, "missing")
    assert missing["url"] == "/__not-a-route__"
    assert "empty-state" in missing["html"]
    assert "返回首页" in missing["html"]


# --------------------------------------------------------------------------
# 顶栏已登录态
# --------------------------------------------------------------------------

def test_header_logged_in_links(rendered):
    html = block(rendered, "headerLoggedIn")
    for href, label in (("/notes/new", "写笔记"), ("/me", "我的主页"), ("/about", "关于")):
        found = anchor_by_href(html, href)
        assert found is not None, f"已登录顶栏缺少 {label} 链接"
        assert label in found[1]


def test_header_avatar_button_shows_first_character(rendered):
    html = block(rendered, "headerLoggedIn")
    assert 'class="avatar-btn"' in html
    assert 'aria-haspopup="menu"' in html
    assert 'aria-expanded="false"' in html
    btn = re.search(r'<button\b[^>]*class="[^"]*avatar-btn[^"]*"[^>]*>(.*?)</button>', html, re.S)
    assert btn is not None
    assert "a" in btn.group(1), "头像应显示用户名首字（alice → a）"


def test_avatar_menu_items_and_open_state(rendered):
    menu = block(rendered, "menu")
    assert menu["before"]["open"] is False
    assert menu["before"]["expanded"] == "false"
    assert menu["after"]["open"] is True
    assert menu["after"]["expanded"] == "true"
    assert menu["after"]["focusOnFirstItem"] is True

    items = menu["items"]
    assert items[0]["text"] == "个人主页" and items[0]["href"] == "/me"
    assert items[-1]["text"] == "退出登录"


def test_logout_uses_confirm_dialog_with_escape(rendered):
    d = block(rendered, "logoutDialog")
    assert d["dialogTitle"] == "退出登录"
    assert d["confirmText"] == "退出登录"
    assert d["role"] == "dialog"
    assert d["ariaModal"] == "true"
    assert d["dialogClosedOnEsc"] is True
    assert d["focusRestored"] is True


def test_confirmed_logout_calls_api_and_returns_home(rendered):
    c = block(rendered, "confirmedLogout")
    assert c["fetchPath"] == "/api/auth/logout"
    assert c["user"] is None
    assert c["navUrl"] == "/"
    assert c["toastCount"] >= 1


# --------------------------------------------------------------------------
# CSS 契约（布局/尺寸的结构性检查；像素观感见 visual-checklist.md）
# --------------------------------------------------------------------------

CSS_DIR = ROOT / "static" / "css"
HARDCODED_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(")


def _norm(body: str) -> str:
    return re.sub(r"\s*:\s*", ":", re.sub(r"\s+", " ", body)).strip()


def _rule(css_text: str, selector: str, occurrence: int = 0) -> str | None:
    css = re.sub(r"/\*.*?\*/", "", css_text, flags=re.S)
    bodies = [_norm(m.group(2)) for m in re.finditer(r"([^{}]+)\{([^{}]*)\}", css)
              if m.group(1).strip() == selector]
    return bodies[occurrence] if len(bodies) > occurrence else None


@pytest.fixture(scope="module")
def auth_css():
    return (CSS_DIR / "auth.css").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def base_css_text():
    return (CSS_DIR / "base.css").read_text(encoding="utf-8")


def test_auth_css_has_no_hardcoded_color(auth_css):
    match = HARDCODED_COLOR.search(re.sub(r"/\*.*?\*/", "", auth_css, flags=re.S))
    assert match is None, f"auth.css 出现硬编码色值：{match.group(0)!r}（应引用令牌）"


def test_auth_page_layout(auth_css):
    body = _rule(auth_css, ".auth-page")
    assert body is not None
    assert "display:grid" in body
    assert "place-items:center" in body
    assert "calc(100vh - var(--header-h))" in body
    assert "background:var(--c-page)" in body


def test_auth_card_dimensions(auth_css):
    body = _rule(auth_css, ".auth-card")
    assert body is not None
    assert "width:min(420px, 100%)" in body
    assert "background:var(--c-surface)" in body
    assert "border-radius:var(--r-2)" in body
    assert "box-shadow:var(--sd-card)" in body
    assert "padding:var(--sp-8)" in body


def test_auth_input_height_and_invalid_state(auth_css):
    input_rule = _rule(auth_css, ".auth-card .field input")
    assert input_rule is not None and "height:44px" in input_rule
    invalid = _rule(auth_css, ".field input.is-invalid")
    assert invalid is not None and "border-color:var(--c-danger)" in invalid


def test_auth_field_error_and_submit_button(auth_css):
    err = _rule(auth_css, ".auth-card .field-error")
    assert err is not None
    assert "font-size:var(--fs-xs)" in err
    assert "color:var(--c-danger-strong)" in err
    assert "min-height:1em" in err

    btn = _rule(auth_css, ".auth-card .btn-primary")
    assert btn is not None and "width:100%" in btn and "height:44px" in btn


def test_avatar_button_is_first_char_color_block(base_css_text):
    body = _rule(base_css_text, ".avatar-btn")
    assert body is not None
    assert "width:36px" in body and "height:36px" in body
    assert "border-radius:50%" in body
    assert "background:var(--c-accent)" in body
    assert "color:var(--c-text)" in body


def test_avatar_menu_hidden_by_default_and_shown_when_open(base_css_text):
    menu = _rule(base_css_text, ".avatar-menu")
    assert menu is not None and "display:none" in menu
    opened = _rule(base_css_text, ".avatar-menu.is-open")
    assert opened is not None and "display:flex" in opened

