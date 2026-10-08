"""Phase 2 主页 / 关于页 / 顶栏 渲染契约（通过 Node + 最小 DOM 双端真实执行渲染函数）。

本环境无浏览器，因此用 `tests/js/render.mjs` 在 Node 中调用 `static/js` 的真实渲染函数，
把生成的节点树序列化为 HTML 后断言文案、结构与 ARIA 属性。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
RENDER = ROOT / "tests" / "js" / "render.mjs"

HERO_TITLE_LINES = ["记录生活 · 书写成长", "遇见美好"]
HERO_SUBTITLE = [
    "个人笔记是一款简洁优雅的在线笔记应用，",
    "帮助你随时随地记录灵感、管理任务、沉淀思考，",
    "让每一个想法都被珍藏，让每一天都更有意义。",
]
HERO_ALT = "铺着阳光的桌面上放着咖啡、翻开的手写笔记本与一枝白色小花"
FEATURES = [
    ("简洁易用", "界面清新，专注记录"),
    ("云端同步", "多端同步，安全可靠"),
    ("隐私保护", "数据加密，隐私无忧"),
    ("灵活分类", "标签管理，高效查找"),
]
ABOUT_INTRO = (
    "个人笔记是一款简洁优雅的在线笔记应用，帮助你随时随地记录灵感、管理任务、沉淀思考。"
    "所有笔记默认只有你自己可见，需要分享时可以生成带密码的链接。"
)
ABOUT_FEATURES = [
    "Markdown 笔记撰写与实时预览",
    "草稿与发布状态管理",
    "标签分类与关键词搜索",
    "带密码的链接分享",
    "笔记评论",
    "笔记收藏",
    "浏览足迹回顾",
    "图片上传与引用",
]
TECH_STACK = [
    ("页面显示", "原生 HTML + CSS + JavaScript"),
    ("服务端", "Python 3.12 + Flask"),
    ("数据库", "SQLite"),
    ("Markdown 渲染", "marked + DOMPurify（本地内置，不使用在线 CDN）"),
]
ABOUT_CREDITS = "Markdown 渲染由 marked 提供，HTML 清洗由 DOMPurify 提供，均以本地文件方式内置"
CONTACT_EMAIL = "example@example.com"


@pytest.fixture(scope="module")
def rendered() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("未检测到 node，跳过 Node DOM 渲染契约测试")
    proc = subprocess.run(
        [node, str(RENDER)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, f"node 渲染失败：\n{proc.stdout}\n{proc.stderr}"
    return json.loads(proc.stdout)


def anchors(html: str) -> list[tuple[str, str]]:
    return re.findall(r"<a\b([^>]*)>(.*?)</a>", html, re.S)


def body(rendered: dict, key: str) -> str:
    """取出某个区块的序列化 HTML；渲染失败时给出可读错误。"""
    value = rendered.get(key)
    assert value, f"{key} 渲染失败：{rendered.get('errors')}"
    return value


def anchor_by_href(html: str, href: str) -> tuple[str, str] | None:
    for attrs, inner in anchors(html):
        if f'href="{href}"' in attrs:
            return attrs, inner
    return None


def buttons(html: str) -> list[tuple[str, str]]:
    return re.findall(r"<button\b([^>]*)>(.*?)</button>", html, re.S)


def button_by_text(html: str, text: str) -> tuple[str, str] | None:
    for attrs, inner in buttons(html):
        if text in inner:
            return attrs, inner
    return None


# --------------------------------------------------------------------------
# Task 1 · 顶栏（未登录态）与移动抽屉
# --------------------------------------------------------------------------

def test_header_brand_and_guest_links(rendered):
    html = body(rendered, "headerHome")
    assert 'id="app-header"' in html
    assert 'class="app-header"' in html

    brand = anchor_by_href(html, "/")
    assert brand is not None, "顶栏缺少品牌链接"
    attrs, inner = brand
    assert 'class="nav-brand"' in attrs
    assert "logo.svg" in inner
    assert "个人笔记" in inner

    for href, label in (("/login", "登录"), ("/register", "注册"), ("/about", "关于")):
        found = anchor_by_href(html, href)
        assert found is not None, f"顶栏缺少 {label} 链接"
        assert label in found[1]


def test_header_hamburger_and_drawer_aria(rendered):
    html = body(rendered, "headerHome")
    toggle = [a for a in buttons(html) if "nav-toggle" in a[0]]
    assert len(toggle) == 1, "应有且仅有一个汉堡按钮"
    attrs, inner = toggle[0]
    assert 'aria-label="打开导航菜单"' in attrs
    assert 'aria-expanded="false"' in attrs
    assert 'aria-controls="nav-drawer"' in attrs

    assert 'id="nav-drawer"' in html
    assert "nav-drawer" in html
    assert "nav-scrim" in html, "移动抽屉需要遮罩层"
    assert 'class="nav-links"' in html


def test_header_marks_active_link(rendered):
    home = body(rendered, "headerHome")
    about = body(rendered, "headerAbout")
    login = body(rendered, "headerLogin")

    assert "aria-current" not in home, "首页没有任何导航项应处于当前页"
    about_link = anchor_by_href(about, "/about")
    assert about_link is not None and 'aria-current="page"' in about_link[0]
    assert "is-active" in about_link[0]

    login_link = anchor_by_href(login, "/login")
    assert login_link is not None and 'aria-current="page"' in login_link[0]
    assert about.count("aria-current") == 1


def test_header_keeps_logged_out_state(rendered):
    """Phase 2 只交付未登录态，已登录入口留给 Phase 3。"""
    html = body(rendered, "headerHome")
    assert "写笔记" not in html
    assert "我的主页" not in html


def test_header_scroll_shadow_toggles(rendered):
    it = rendered.get("interactions")
    assert it, f"顶栏交互未采集：{rendered.get('errors')}"
    assert it["scrolledClass"] is True, "scrollY>8 时应加 .is-scrolled"
    assert it["unscrolledClass"] is False, "回到顶部应移除 .is-scrolled"


def test_header_drawer_open_escape_and_scrim(rendered):
    it = rendered.get("interactions")
    assert it, f"顶栏交互未采集：{rendered.get('errors')}"
    assert it["openExpanded"] == "true"
    assert it["openLabel"] == "关闭导航菜单"
    assert it["openDrawer"] is True
    assert it["openScrim"] is True
    assert it["focusMovedIntoDrawer"] is True

    assert it["closedExpanded"] == "false", "Esc 应关闭抽屉"
    assert it["closedDrawer"] is False
    assert it["closedScrim"] is False
    assert it["closedFocusOnToggle"] is True, "关闭后焦点应回到汉堡按钮"
    assert it["scrimClickClosed"] is True, "点击遮罩应关闭抽屉"


# --------------------------------------------------------------------------
# Task 2 · 主页 Hero 与特性条
# --------------------------------------------------------------------------

def test_home_hero_structure(rendered):
    html = body(rendered, "home")
    assert 'class="hero"' in html
    assert 'class="hero-copy"' in html

    assert "<picture" in html and 'class="hero-media"' in html
    assert 'type="image/webp"' in html
    for fragment in (
        "/static/img/hero.webp 1920w", "/static/img/hero-960.webp 960w",
        "/static/img/hero.jpg 1920w", "/static/img/hero-960.jpg 960w",
    ):
        assert fragment in html, f"srcset 缺少 {fragment}"
    assert html.count('sizes="100vw"') == 2

    img = re.search(r"<img\b([^>]*)>", html)
    assert img is not None, "hero 缺少 <img> 回退"
    img_attrs = img.group(1)
    assert 'src="/static/img/hero.jpg"' in img_attrs
    assert f'alt="{HERO_ALT}"' in img_attrs


def test_home_hero_copy_verbatim(rendered):
    html = body(rendered, "home")
    h1 = re.search(r"<h1\b[^>]*>(.*?)</h1>", html, re.S)
    assert h1 is not None
    assert HERO_TITLE_LINES[0] in h1.group(1)
    assert HERO_TITLE_LINES[1] in h1.group(1)
    assert "<br" in h1.group(1), "标题两行需要换行"

    for line in HERO_SUBTITLE:
        assert line in html, f"副文案缺失：{line}"

    assert "hero-underline" in html
    underline = re.search(r'<span[^>]*class="hero-underline"[^>]*>', html)
    assert underline is not None and 'aria-hidden="true"' in underline.group(0)

    assert "hero-heart" in html, "标题区缺少装饰心形"
    heart = re.search(r'<span[^>]*class="hero-heart"[^>]*>', html)
    assert heart is not None and 'aria-hidden="true"' in heart.group(0)


def test_home_hero_buttons(rendered):
    html = body(rendered, "home")
    primary = button_by_text(html, "开始记录")
    secondary = button_by_text(html, "了解更多")
    assert primary is not None and "btn-primary" in primary[0]
    assert secondary is not None and "btn-ghost" in secondary[0]
    for attrs, inner in (primary, secondary):
        assert 'aria-hidden="true"' in inner, "按钮图标应 aria-hidden"
        assert "<svg" in inner


def test_home_button_navigation_targets(rendered):
    assert rendered["navLoggedOutPrimary"] == "/login?redirect=%2Fnotes%2Fnew"
    assert rendered["navLoggedOutSecondary"] == "/about"
    assert rendered["navLoggedInPrimary"] == "/notes/new"


def test_home_features_four_items(rendered):
    html = body(rendered, "home")
    assert 'class="features"' in html
    assert html.count('class="feature"') == 4
    assert html.count('class="feature-icon"') == 4
    for title, desc in FEATURES:
        assert title in html, f"特性标题缺失：{title}"
        assert desc in html, f"特性说明缺失：{desc}"


# --------------------------------------------------------------------------
# Task 3 · 关于页
# --------------------------------------------------------------------------

def test_about_page_sections(rendered):
    html = body(rendered, "about")
    assert 'class="about-page"' in html
    assert html.count('class="paper"') == 4, "关于页应有四个纸卡片区块"
    assert "关于个人笔记" in html
    assert ABOUT_INTRO in html


def test_about_feature_list(rendered):
    html = body(rendered, "about")
    for item in ABOUT_FEATURES:
        assert item in html, f"功能清单缺失：{item}"
    assert html.count("<li") >= len(ABOUT_FEATURES)


def test_about_tech_stack(rendered):
    html = body(rendered, "about")
    for label, value in TECH_STACK:
        assert label in html, f"技术栈缺少项：{label}"
        assert value in html, f"技术栈缺少值：{value}"


def test_about_credits_and_contact_placeholder(rendered):
    html = body(rendered, "about")
    assert ABOUT_CREDITS in html
    assert f"联系邮箱：{CONTACT_EMAIL}" in html
