"""Phase 2 静态资源契约：SPA 兜底、样式令牌接线、布局契约、无硬编码色值、JS 语法。

CSS 部分用一个极小的嵌套感知解析器，避免对格式化敏感；断言只覆盖 phase-2-home-page.md
里明确写出的布局与令牌要求。
"""

from __future__ import annotations

import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CSS_DIR = ROOT / "static" / "css"
JS_DIR = ROOT / "static" / "js"


# --------------------------------------------------------------------------
# 极简 CSS 解析
# --------------------------------------------------------------------------

def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def parse_css(css: str) -> list[tuple[str | None, str, str]]:
    """返回 [(media_or_None, selector, body), ...]"""
    css = strip_comments(css)
    out: list[tuple[str | None, str, str]] = []
    media_stack: list[str] = []
    buf = ""
    i = 0
    while i < len(css):
        ch = css[i]
        if ch == "{":
            header = buf.strip()
            buf = ""
            if header.startswith("@"):
                media_stack.append(header)
            else:
                depth = 1
                j = i + 1
                start = j
                while j < len(css) and depth:
                    if css[j] == "{":
                        depth += 1
                    elif css[j] == "}":
                        depth -= 1
                        if depth == 0:
                            break
                    j += 1
                out.append((media_stack[-1] if media_stack else None, header, css[start:j]))
                i = j
        elif ch == "}":
            if media_stack:
                media_stack.pop()
            buf = ""
        else:
            buf += ch
        i += 1
    return out


def rules(css_text: str) -> list[tuple[str | None, str, str]]:
    return parse_css(css_text)


def find_rule(css_text: str, selector: str, media: str | None = None,
              occurrence: int = 0, exact: bool = True) -> str | None:
    """按选择器查找规则体。

    ``exact=True`` 要求选择器整体相等（避免 ``a`` 命中 ``.nav-brand``）；
    ``exact=False`` 用子串匹配（用于逗号选择器组，如 ``.field input, .field textarea``）。
    """
    def matches(sel: str) -> bool:
        return norm(sel) == selector if exact else selector in sel

    hits = [body for m, sel, body in rules(css_text)
            if matches(sel) and (media is None or (m is not None and media in m))]
    if len(hits) <= occurrence:
        return None
    return hits[occurrence]


def norm(body: str) -> str:
    """归一空白并对齐 ':' 两侧，使断言不依赖书写格式。"""
    text = re.sub(r"\s+", " ", body)
    text = re.sub(r"\s*:\s*", ":", text)
    return text.strip()


def prop(body: str, declaration: str) -> bool:
    """规则体中是否含有某条声明（空白归一后子串匹配）。"""
    return declaration in norm(body)


# --------------------------------------------------------------------------
# Flask：SPA 兜底与入口装配
# --------------------------------------------------------------------------

@pytest.mark.parametrize("path", ["/", "/about", "/login", "/notes/new"])
def test_spa_routes_serve_app_shell(client, path):
    resp = client.get(path)
    assert resp.status_code == 200
    html = resp.get_data(as_text=True)
    assert 'id="app"' in html
    assert 'id="app-header"' in html


def test_index_wires_phase2_assets():
    html = (ROOT / "index.html").read_text(encoding="utf-8")
    for asset in (
        "/static/css/base.css",
        "/static/css/home.css",
        "/static/css/about.css",
        "/static/js/router.js",
    ):
        assert asset in html, f"index.html 缺少 {asset}"


def test_js_modules_parse():
    node = shutil.which("node")
    if not node:
        pytest.skip("未检测到 node，跳过 JS 语法检查")
    for name in ("ui.js", "home.js", "about.js", "router.js"):
        proc = subprocess.run(
            [node, "--check", str(JS_DIR / name)],
            cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
        )
        assert proc.returncode == 0, f"{name} 语法错误：\n{proc.stderr}"


# --------------------------------------------------------------------------
# 无硬编码色值（Phase 2 完成清单）
# --------------------------------------------------------------------------

HARDCODED_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(")


@pytest.mark.parametrize("name", ["home.css", "about.css"])
def test_page_css_has_no_hardcoded_color(name):
    css = strip_comments((CSS_DIR / name).read_text(encoding="utf-8"))
    match = HARDCODED_COLOR.search(css)
    assert match is None, f"{name} 出现硬编码色值：{match.group(0)!r}（应引用 base.css 令牌）"


# --------------------------------------------------------------------------
# home.css 布局契约（Task 2）
# --------------------------------------------------------------------------

@pytest.fixture(scope="module")
def home_css():
    return (CSS_DIR / "home.css").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def about_css():
    return (CSS_DIR / "about.css").read_text(encoding="utf-8")


def test_hero_grid_layout(home_css):
    hero = find_rule(home_css, ".hero")
    assert hero is not None
    assert prop(hero, "display:grid")
    assert prop(hero, "grid-template-columns:45% 55%")
    assert prop(hero, "calc(100vh - var(--header-h) - 140px)")

    wide = find_rule(home_css, ".hero", media="max-width: 1199px")
    assert wide is not None and prop(wide, "grid-template-columns:55% 45%")

    mobile = find_rule(home_css, ".hero", media="max-width: 768px")
    assert mobile is not None
    assert prop(mobile, "grid-template-columns:1fr")
    assert prop(mobile, "min-height:auto")


def test_hero_media_and_copy(home_css):
    media = find_rule(home_css, ".hero-media img")
    assert media is not None
    assert prop(media, "object-fit:cover")

    copy = find_rule(home_css, ".hero-copy")
    assert copy is not None and prop(copy, "padding:0 var(--sp-6) 0 var(--sp-16)")

    mobile_copy = find_rule(home_css, ".hero-copy", media="max-width: 768px")
    assert mobile_copy is not None
    assert prop(mobile_copy, "color:var(--c-on-image)")


def test_hero_underline_and_heart(home_css):
    underline = find_rule(home_css, ".hero-underline")
    assert underline is not None
    assert prop(underline, "height:4px")
    assert prop(underline, "background:var(--c-accent)")
    assert prop(underline, "width:96px")

    assert find_rule(home_css, ".hero-heart") is not None


def test_features_grid(home_css):
    features = find_rule(home_css, ".features")
    assert features is not None
    assert prop(features, "grid-template-columns:repeat(4, 1fr)")

    wide = find_rule(home_css, ".features", media="max-width: 1199px")
    assert wide is not None and prop(wide, "grid-template-columns:repeat(2, 1fr)")

    mobile = find_rule(home_css, ".features", media="max-width: 768px")
    assert mobile is not None and prop(mobile, "grid-template-columns:1fr")


def test_feature_icon_circle(home_css):
    icon = find_rule(home_css, ".feature-icon")
    assert icon is not None
    assert prop(icon, "width:56px")
    assert prop(icon, "height:56px")
    assert prop(icon, "border-radius:50%")
    assert prop(icon, "background:var(--c-surface)")
    assert prop(icon, "color:var(--c-accent)")


def test_hero_mobile_overlay(home_css):
    media = find_rule(home_css, ".hero-media", media="max-width: 768px")
    assert media is not None, "移动端 hero 需绝对定位铺满"
    assert prop(media, "position:absolute")
    assert prop(media, "inset:0")
    assert "var(--c-overlay)" in home_css, "移动端遮罩应引用 --c-overlay 令牌"


# --------------------------------------------------------------------------
# base.css 顶栏：移动抽屉 / 滚动阴影 / 触摸目标（Task 1）
# --------------------------------------------------------------------------

def test_toggle_visible_only_on_mobile(base_css):
    toggle = find_rule(base_css, ".nav-toggle", media="max-width: 768px")
    assert toggle is not None and prop(toggle, "display:inline-flex")


def test_mobile_drawer_slides_from_right(base_css):
    drawer = find_rule(base_css, ".nav-drawer", media="max-width: 768px")
    assert drawer is not None
    assert prop(drawer, "position:fixed")
    assert prop(drawer, "width:min(280px, 80vw)")
    assert prop(drawer, "transform:translateX(100%)")
    assert prop(drawer, "visibility:hidden")

    opened = find_rule(base_css, ".nav-drawer.is-open", media="max-width: 768px")
    assert opened is not None and prop(opened, "transform:translateX(0)")
    assert prop(opened, "visibility:visible")


def test_scrim_hidden_by_default_and_shown_when_open(base_css):
    scrim = find_rule(base_css, ".nav-scrim", media="max-width: 768px")
    assert scrim is not None and prop(scrim, "display:none")
    visible = find_rule(base_css, ".nav-scrim.is-visible", media="max-width: 768px")
    assert visible is not None and prop(visible, "display:block")


def test_scroll_shadow_class(base_css):
    body_rule = find_rule(base_css, ".app-header.is-scrolled")
    assert body_rule is not None and prop(body_rule, "box-shadow:var(--sd-card)")


# --------------------------------------------------------------------------
# about.css 布局契约（Task 3）
# --------------------------------------------------------------------------

def test_about_page_container(about_css):
    page = find_rule(about_css, ".about-page")
    assert page is not None
    assert prop(page, "max-width:var(--reading-max)")
    assert prop(page, "padding:var(--sp-12) var(--gutter) var(--sp-16)")


def test_about_paper_spacing(about_css):
    paper = find_rule(about_css, ".paper", exact=False)
    assert paper is not None, "缺少 .paper 区块内边距规则"
    assert prop(paper, "padding:var(--sp-8)")
    gap = find_rule(about_css, ".paper + .paper", exact=False)
    assert gap is not None and prop(gap, "margin-top:var(--sp-6)")


def test_about_tech_list_two_columns(about_css):
    tech = find_rule(about_css, ".tech-list")
    assert tech is not None
    assert prop(tech, "display:grid")
    assert prop(tech, "grid-template-columns:120px 1fr")

    mobile = find_rule(about_css, ".tech-list", media="max-width: 768px")
    assert mobile is not None and prop(mobile, "grid-template-columns:1fr")


# --------------------------------------------------------------------------
# base.css：对比度修正令牌与接线（MANDATORY ADDITIONAL FIXES）
# --------------------------------------------------------------------------

CONTRAST_TOKENS = {
    "c-danger-strong": "#9E4436",
    "c-success-strong": "#4F6B41",
    "c-info-strong": "#8A6D42",
    "c-link-hover": "#6E5228",
    "c-border-strong": "#A6835A",
}


@pytest.fixture(scope="module")
def base_css():
    return (CSS_DIR / "base.css").read_text(encoding="utf-8")


def test_contrast_tokens_present(base_css):
    tokens = dict(re.findall(r"--([\w-]+)\s*:\s*([^;]+);", strip_comments(base_css)))
    for name, value in CONTRAST_TOKENS.items():
        assert tokens.get(name, "").strip().upper() == value.upper(), (
            f"base.css 缺少或写错令牌 --{name}（应为 {value}）"
        )


@pytest.mark.parametrize("selector,declaration", [
    ("a:hover", "color:var(--c-link-hover)"),
    (".btn-primary", "background:var(--c-accent)"),
    (".btn-primary:hover", "background:var(--c-primary)"),
    (".btn-danger", "color:var(--c-danger-strong)"),
    (".btn-danger:hover", "background:var(--c-danger-strong)"),
    (".field-error", "color:var(--c-danger-strong)"),
    (".toast-success", "background:var(--c-success-strong)"),
    (".toast-error", "background:var(--c-danger-strong)"),
    (".toast-info", "background:var(--c-info-strong)"),
    (".btn-secondary", "border-color:var(--c-border-strong)"),
])
def test_contrast_wiring(base_css, selector, declaration):
    body = find_rule(base_css, selector)
    assert body is not None, f"base.css 找不到规则 {selector}"
    assert prop(body, declaration)


def test_link_color_uses_info_strong(base_css):
    body = find_rule(base_css, "a")
    assert body is not None and prop(body, "color:var(--c-info-strong)")


def test_interactive_input_border_is_strong(base_css):
    body = find_rule(base_css, ".field input", exact=False)
    assert body is not None and prop(body, "var(--c-border-strong)")


def test_btn_comment_is_accurate(base_css):
    stale = "主按钮文字用 var(--c-text) 且底色 var(--c-primary-hover)"
    assert stale not in base_css, "base.css 中主按钮注释已过时，需更新"
