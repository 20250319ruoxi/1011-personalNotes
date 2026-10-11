"""Phase 6 Task 3 / Task 4 · 分享页、密码锁屏、分享面板与详情页接入契约。

本环境无浏览器，因此用 `tests/js/render_share.mjs`（复用 `tests/js/dom-shim.mjs` 最小 DOM 双端）
在 Node 中真实调用 `static/js/share.js` 的 `renderSharePage` / `renderSharePanel`，断言生成的
标记、文案、ARIA、交互落点与请求序列。

CSS 部分用极小的嵌套感知解析器断言 `share.css` 的布局/令牌契约；像素观感见
`tests/manual/visual-checklist.md`（标注为待人工确认）。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
CSS_DIR = ROOT / "static" / "css"
JS_DIR = ROOT / "static" / "js"
HARNESS = ROOT / "tests" / "js" / "render_share.mjs"

# 文案（规格 Components 表逐字）
LOCK_TITLE = "该笔记需要密码访问"
LOCK_BUTTON = "确认访问"
LOCK_WRONG = "访问密码错误"
RATE_LIMITED = "尝试过于频繁，请稍后再试"
EXPIRED_TITLE = "该分享链接已失效"
EXPIRED_DESC = "作者可能已关闭分享，或链接不正确。"
HOME_BUTTON = "返回首页"
SERVER_ERROR = "服务器开小差了，请稍后重试"
SHARE_TITLE = "分享的笔记"
UNTITLED = "无标题"
ENABLE_BUTTON = "保存并发布"
PASSWORD_PLACEHOLDER = "留空表示不需要密码"
COPY_BUTTON = "复制链接"
COPIED_TOAST = "链接已复制"
MANUAL_COPY = "请手动复制"
CLOSE_SHARE = "关闭分享"
CLOSE_MESSAGE = "关闭后该链接将立即失效，已收藏或浏览过的人将无法再打开。"
# Phase 7 Task 2 · 分享页收藏按钮
FAVORITE_TEXT = "收藏"
FAVORITED_TEXT = "已收藏"
FAVORITE_CLASS = "favorite-btn"
UNFAVORITE_TITLE = "取消收藏"
UNFAVORITE_MESSAGE = "确定要取消收藏这篇笔记吗？"

# 下载为 .md
DOWNLOAD_TEXT = "下载 .md"
DOWNLOAD_TYPE = "text/markdown;charset=utf-8"


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


def block(rendered: dict, key):
    value = rendered.get(key)
    assert value, f"{key} 渲染失败：{rendered.get('errors')}"
    return value


def test_harness_reports_no_errors(rendered):
    assert rendered["errors"] == {}, rendered["errors"]


# ==========================================================================
# 极简 CSS 解析（与 tests/test_notes_frontend.py 同风格）
# ==========================================================================

def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def parse_css(css: str):
    css = strip_comments(css)
    out = []
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


def norm(body: str) -> str:
    return re.sub(r"\s*:\s*", ":", re.sub(r"\s+", " ", body)).strip()


def find_rule(css_text: str, selector: str, media: str | None = None,
              occurrence: int = 0) -> str | None:
    hits = [body for m, sel, body in parse_css(css_text)
            if norm(sel) == selector and (media is None or (m is not None and media in m))]
    return hits[occurrence] if len(hits) > occurrence else None


def prop(body: str, declaration: str) -> bool:
    return declaration in norm(body)


HARDCODED_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|(?<!-)\brgba?\(|hsla?\(")


@pytest.fixture(scope="module")
def share_css() -> str:
    return (CSS_DIR / "share.css").read_text(encoding="utf-8")


# ==========================================================================
# Task 3 · 分享页：无密码直接阅读
# ==========================================================================

def test_share_page_exports_and_loading(rendered):
    p = block(rendered, "sharePage")
    assert p["exportIsFunction"] is True, "share.js 必须导出 renderSharePage"
    assert p["loadingSkeletons"] >= 1, "加载中要有骨架"
    assert p["hasSkeletonLeft"] == 0, "加载完成后骨架必须移除"


def test_share_page_renders_paper_article(rendered):
    p = block(rendered, "sharePage")
    assert p["hasPage"] is True, "缺少 .share-page 容器"
    assert "share-article" in (p["articleClass"] or "")
    assert p["paperClass"] is True, "分享正文必须承载在纸张容器上"
    assert p["title"] == SHARE_TITLE
    assert p["bodyHasMarkdownClass"] is True
    assert p["bodyHtml"] == p["bodyExpected"], "正文必须等于 renderMarkdown(content_md)"


def test_share_page_meta_shows_author_and_tags(rendered):
    p = block(rendered, "sharePage")
    assert p["avatarText"] == "a", "作者头像使用用户名首字"
    assert "alice" in p["metaText"]
    assert "更新于" in p["metaText"]
    assert p["tags"] == ["分享", "生活"]


def test_share_page_slots_and_title(rendered):
    p = block(rendered, "sharePage")
    assert p["hasActions"] is True, "缺少 .share-actions / #share-actions 容器"
    assert p["actionButtonTexts"] == [FAVORITE_TEXT, DOWNLOAD_TEXT], (
        "分享页操作区为「收藏 + 下载 .md」（Phase 7 Task 2 插入收藏、本轮插入下载）"
    )
    assert p["hasComments"] is True, "缺少 #share-comments 容器"
    assert p["titleTag"] == f"「{SHARE_TITLE}」- 个人笔记"


def test_share_page_has_only_reader_actions(rendered):
    """分享页是读者视角：不得出现编辑 / 删除 / 分享面板入口，只放收藏与下载。"""
    p = block(rendered, "sharePage")
    for banned in ("编辑", "删除", "关闭分享", "更新密码", "复制链接"):
        assert banned not in p["buttonTexts"], f"分享页不得出现「{banned}」入口"
    assert FAVORITE_TEXT in p["buttonTexts"]
    assert DOWNLOAD_TEXT in p["buttonTexts"]
    assert p["hasLock"] is False


def test_share_page_download_saves_markdown_source(rendered):
    """读者点「下载 .md」：文件名 = 标题.md，Blob 内容 = Markdown 原文。"""
    d = block(rendered, "shareDownload")
    assert d["fileName"] == "分享的笔记.md"
    assert d["blobCount"] == 1, "一次点击只触发一次下载"
    assert d["text"] == "# 正文\n内容"
    assert d["type"] == DOWNLOAD_TYPE


def test_share_page_requests_the_token_once(rendered):
    p = block(rendered, "sharePage")
    assert "/api/share/tok-123" in p["getPaths"]


def test_share_page_untitled_fallback(rendered):
    u = block(rendered, "untitled")
    assert u["title"] == UNTITLED


# ==========================================================================
# Task 3 · 密码锁屏
# ==========================================================================

def test_lock_screen_structure(rendered):
    lock = block(rendered, "lock")
    assert lock["exists"] is True, "缺少 .share-lock"
    assert lock["paper"] is True, "锁屏必须是纸张卡片"
    assert lock["heading"] == LOCK_TITLE
    assert lock["inputType"] == "password"
    assert lock["inputAutocomplete"] == "current-password"
    assert lock["labelCount"] >= 1, "密码输入需要 <label>"
    assert lock["formExists"] is True
    assert lock["submitTexts"] == [LOCK_BUTTON]
    assert lock["submitType"] == "submit"
    assert lock["iconAriaHidden"] is True, "锁形图标必须 aria-hidden"
    assert lock["hasSvgMarkup"] is True, "锁形图标为内联 SVG"
    assert lock["interactiveOrder"] == ["input:password", "button:确认访问"], (
        "锁屏 Tab 序列：密码输入 → 确认访问"
    )
    assert lock["hasArticle"] is False, "未解锁不得渲染正文"


def test_lock_screen_keeps_default_title(rendered):
    assert block(rendered, "lock")["titleTag"] == "个人笔记"


def test_lock_wrong_password_shakes_and_shows_error(rendered):
    w = block(rendered, "lockWrong")
    assert w["shaking"] is True, "密码错误必须给 .share-lock 加 .is-shaking"
    assert w["errorText"] == LOCK_WRONG
    assert w["buttonDisabled"] is False, "失败后按钮必须恢复可用"
    assert w["buttonText"] == LOCK_BUTTON
    assert w["hasArticle"] is False
    assert w["verifyCalls"] == 1
    assert w["shakingAfter300ms"] is False, "抖动类必须在 300ms 后移除"


def test_lock_rate_limited_disables_submit(rendered):
    r = block(rendered, "lockRate")
    assert r["errorText"] == RATE_LIMITED
    assert r["buttonDisabled"] is True, "限流后必须禁用提交按钮"
    assert r["buttonAttrDisabled"] is True
    assert r["hasArticle"] is False


def test_lock_success_renders_article_without_refetch(rendered):
    o = block(rendered, "lockOk")
    assert o["title"] == SHARE_TITLE
    assert o["hasLock"] is False
    assert o["hasArticle"] is True
    assert o["titleTag"] == f"「{SHARE_TITLE}」- 个人笔记"
    assert o["verifyCalls"] == 1
    assert o["shareGetsBefore"] == 1
    assert o["shareGetsAfter"] == 1, "校验成功后直接用返回数据渲染，不得重新请求 /api/share"
    assert o["hasComments"] is True


# ==========================================================================
# Task 3 · 失效与通用错误
# ==========================================================================

def test_expired_share_link_state(rendered):
    e = block(rendered, "expired")
    assert e["hasEmpty"] is True
    assert e["title"] == EXPIRED_TITLE
    assert e["description"] == EXPIRED_DESC
    assert e["hasHomeButton"] is True
    assert e["hasArticle"] is False
    assert e["hasLock"] is False
    assert e["titleTag"] == "个人笔记", "渲染未成功时 <title> 保持「个人笔记」"
    assert e["navUrl"] == "/", "「返回首页」必须回到 /"


def test_generic_error_shows_backend_message(rendered):
    g = block(rendered, "generic")
    assert g["title"] == SERVER_ERROR
    assert g["hasArticle"] is False
    assert g["hasLock"] is False


# ==========================================================================
# Task 3 · 路由注册
# ==========================================================================

def test_share_route_is_public(rendered):
    r = block(rendered, "routing")
    assert r["pathname"] == "/s/tok-123", "未登录访问 /s/:token 不得被重定向到 /login"
    assert "login" not in (r["lastUrl"] or "")
    assert r["hasPage"] is True
    assert r["hasArticle"] is True


# ==========================================================================
# Task 4 · 作者分享面板 SharePanel
# ==========================================================================

def test_panel_off_state(rendered):
    p = block(rendered, "panelOff")
    assert p["exists"] is True, "缺少 .share-panel"
    assert p["checkboxCount"] == 0, "开关已改为显式「保存并发布」按钮，不得再出现复选框"
    assert p["actionButton"] == ENABLE_BUTTON
    assert p["passwordPlaceholder"] == PASSWORD_PLACEHOLDER
    assert p["passwordMaxlength"] == "64"
    assert p["hasLinkRow"] is False, "未发布时不得显示链接行"
    assert p["readonlyInputs"] == 0
    for banned in (COPY_BUTTON, CLOSE_SHARE, "更新密码"):
        assert banned not in p["buttonTexts"]


def test_panel_on_state(rendered):
    p = block(rendered, "panelOn")
    assert p["linkValue"] == "http://localhost/s/tok-123", "链接框必须是只读绝对地址"
    assert p["actionButton"] == "更新密码", "已发布后首操作按钮换成「更新密码」"
    assert p["checkboxCount"] == 0
    assert ENABLE_BUTTON not in p["buttonTexts"], "已发布后不再显示「保存并发布」"
    for text in (COPY_BUTTON, CLOSE_SHARE, "更新密码"):
        assert text in p["buttonTexts"], f"已发布时要显示「{text}」"
    assert p["hintText"] == "该链接无需密码"


def test_panel_on_state_reports_password(rendered):
    assert block(rendered, "panelOnPw")["hintText"] == "该链接已设置密码"


def test_panel_enable_posts_password_and_shows_link(rendered):
    p = block(rendered, "panelEnable")
    assert p["postPath"] == "/api/notes/11/share"
    assert json.loads(p["postBody"]) == {"password": "secret12"}
    assert p["linkValue"] == "http://localhost/s/tok-123"
    assert COPY_BUTTON in p["buttonTexts"]
    assert p["onChangeCalls"] == 1, "发布成功后要通知详情页刷新状态徽标"
    assert p["hintText"] == "该链接已设置密码"


def test_panel_copy_success_toasts(rendered):
    p = block(rendered, "panelCopy")
    assert p["written"] == "http://localhost/s/tok-123"
    assert p["toast"] == COPIED_TOAST


def test_panel_copy_failure_falls_back(rendered):
    p = block(rendered, "panelCopyFail")
    assert p["written"] == 0, "复制失败不得写入剪贴板"
    assert p["toast"] == MANUAL_COPY


def test_panel_update_password_uses_same_endpoint(rendered):
    p = block(rendered, "panelUpdate")
    assert p["postPath"] == "/api/notes/11/share"
    assert json.loads(p["postBody"]) == {"password": "newpass9"}
    assert p["onChangeCalls"] == 1
    assert p["linkStillThere"] is True


def test_panel_close_share_confirmation(rendered):
    p = block(rendered, "panelClose")
    assert p["title"] == CLOSE_SHARE
    assert p["message"] == CLOSE_MESSAGE
    assert p["confirmText"] == CLOSE_SHARE
    assert "btn-danger" in p["confirmClass"]
    assert p["deleteAfterCancel"] == 0, "取消后不得发起关闭分享请求"


def test_panel_close_share_confirmed(rendered):
    p = block(rendered, "panelClose")
    assert p["deletePath"] == "/api/notes/11/share"
    assert p["hasLinkRow"] is False, "关闭后隐藏链接行"
    assert p["actionButton"] == ENABLE_BUTTON, "关闭后恢复「保存并发布」按钮"
    assert p["onChangeCalls"] == 1


# ==========================================================================
# Task 4 · 详情页接入（分享面板 + 评论区）
# ==========================================================================

def test_detail_mounts_share_panel_and_comments(rendered):
    d = block(rendered, "detailMount")
    assert d["hasShareSlot"] is True, "缺少 #share-panel-slot"
    assert d["shareSlotPaper"] is True, "分享面板槽位必须是纸张容器"
    assert d["hasPanel"] is True
    assert d["hasCommentsSlot"] is True, "缺少 #comments-slot"
    assert d["hasComments"] is True, "详情页必须挂载共用评论区"
    assert d["commentsTitle"] == "评论（0）"
    assert d["commentsPaths"] == ["/api/notes/11/comments"]


def test_detail_actions_include_favorite(rendered):
    d = block(rendered, "detailMount")
    assert d["actionTexts"] == [FAVORITE_TEXT, DOWNLOAD_TEXT, "编辑", "删除"]
    assert FAVORITE_CLASS in d["actionClasses"][0]
    assert "btn-secondary" in d["actionClasses"][1]
    assert "btn-secondary" in d["actionClasses"][2]
    assert "btn-danger" in d["actionClasses"][3]


def test_detail_slot_order(rendered):
    d = block(rendered, "detailMount")
    order = d["order"]
    assert order["body"] < order["panel"] < order["comments"] < order["actions"], order


# ==========================================================================
# Task 3 · share.css 布局与令牌契约
# ==========================================================================

def test_share_css_has_no_hardcoded_color(share_css):
    match = HARDCODED_COLOR.search(strip_comments(share_css))
    assert match is None, f"share.css 出现硬编码色值：{match.group(0)!r}（应引用 base.css 令牌）"


def test_share_page_and_article_rules(share_css):
    page = find_rule(share_css, ".share-page")
    assert page is not None, "缺少 .share-page"
    assert prop(page, "max-width:var(--page-max)")
    assert prop(page, "margin:0 auto")
    assert prop(page, "padding:var(--sp-8) var(--gutter) var(--sp-16)")

    article = find_rule(share_css, ".share-article")
    assert article is not None, "缺少 .share-article"
    # 2026-10 改版：分享文章卡由羊皮纸纹理改为暖白卡面，羊皮纸移作整页背景
    assert prop(article, "background-color:var(--c-card)")
    assert prop(article, "border:var(--bd)")
    assert prop(article, "border-radius:var(--r-2)")
    assert prop(article, "padding:var(--sp-8)")

    body = find_rule(share_css, ".share-body")
    assert body is not None, "缺少 .share-body"
    assert prop(body, "max-width:var(--reading-max)")
    assert prop(body, "margin:0 auto")


def test_share_meta_rule(share_css):
    meta = find_rule(share_css, ".share-meta")
    assert meta is not None, "缺少 .share-meta"
    assert prop(meta, "display:flex")
    assert prop(meta, "flex-wrap:wrap")
    assert prop(meta, "gap:var(--sp-3)")
    assert prop(meta, "align-items:center")
    assert prop(meta, "font-size:var(--fs-sm)")
    assert prop(meta, "color:var(--c-text-muted-strong)")


def test_share_lock_rules(share_css):
    lock = find_rule(share_css, ".share-lock")
    assert lock is not None, "缺少 .share-lock"
    assert prop(lock, "width:min(420px, 100%)")
    assert prop(lock, "margin:var(--sp-16) auto")
    assert prop(lock, "text-align:center")

    inp = find_rule(share_css, ".share-lock input")
    assert inp is not None and prop(inp, "height:44px")

    icon = find_rule(share_css, ".share-lock-icon")
    assert icon is not None, "缺少 .share-lock-icon"
    assert prop(icon, "width:40px") and prop(icon, "height:40px")
    assert prop(icon, "border-radius:50%")
    assert prop(icon, "background:var(--c-primary)")
    assert prop(icon, "color:var(--c-text)")


def test_share_shake_animation(share_css):
    keyframes = [body for media, _sel, body in parse_css(share_css)
                 if media and "keyframes shake" in media]
    assert keyframes, "缺少 @keyframes shake"
    joined = " | ".join(norm(b) for b in keyframes)
    assert "transform:translateX(0)" in joined
    assert "transform:translateX(-6px)" in joined
    assert "transform:translateX(6px)" in joined

    shaking = find_rule(share_css, ".share-lock.is-shaking")
    assert shaking is not None, "缺少 .share-lock.is-shaking"
    assert prop(shaking, "animation:shake .3s")


def test_share_css_mobile_breakpoint(share_css):
    article = find_rule(share_css, ".share-article", media="max-width: 768px")
    assert article is not None, "缺少 ≤768px 的 .share-article 规则"
    assert prop(article, "padding:var(--sp-4)")


# ==========================================================================
# Task 4 · share.css 分享面板契约
# ==========================================================================

def test_share_panel_rule(share_css):
    panel = find_rule(share_css, ".share-panel")
    assert panel is not None, "缺少 .share-panel"
    assert prop(panel, "padding:var(--sp-4)")
    assert prop(panel, "gap:var(--sp-3)")
    assert prop(panel, "display:flex")
    assert prop(panel, "flex-direction:column")


def test_share_actions_rule(share_css):
    """开关已改为显式「保存并发布」按钮，样式随之由 .switch 换成 .share-actions。"""
    row = find_rule(share_css, ".share-actions")
    assert row is not None, "缺少 .share-actions"
    assert prop(row, "display:flex")
    assert prop(row, "align-items:center")
    assert prop(row, "gap:var(--sp-3)")
    assert find_rule(share_css, ".switch") is None, "开关已移除，不得残留 .switch 规则"


def test_share_panel_link_row_rule(share_css):
    row = find_rule(share_css, ".share-panel .link-row")
    assert row is not None, "缺少 .share-panel .link-row"
    assert prop(row, "display:flex")
    assert prop(row, "gap:var(--sp-3)")

    narrow = find_rule(share_css, ".share-panel .link-row", media="max-width: 768px")
    assert narrow is not None, "缺少 ≤768px 的 .share-panel .link-row 规则"
    assert prop(narrow, "flex-direction:column")


# ==========================================================================
# Phase 7 Task 2 · 分享页收藏按钮
# ==========================================================================

def test_share_collect_logged_out_redirects_to_login(rendered):
    """未登录点击收藏 → 跳 `/login?redirect=<当前路径>`，不做静默失败，也不查询收藏列表。"""
    f = block(rendered, "shareFavorite")
    assert f["anonText"] == FAVORITE_TEXT
    assert f["anonFavoriteRequests"] == 0, "未登录不得查询 /api/favorites（会触发 UNAUTHORIZED 跳转）"
    assert f["anonPostCalls"] == 0, "未登录不得直接收藏"
    assert f["anonNavUrl"] == "/login?redirect=%2Fs%2Ftok-123"


def test_share_collect_logged_in_queries_then_posts(rendered):
    f = block(rendered, "shareFavorite")
    assert f["loginText"] == FAVORITE_TEXT
    assert f["loginPressed"] == "false"
    assert f["loginFavoriteRequests"] == 1, "登录后渲染时应查询收藏状态"
    assert f["postPath"] == "/api/favorites"
    assert json.loads(f["postBody"]) == {"note_id": 7}
    assert f["loginAfterText"] == FAVORITED_TEXT
    assert "is-favorited" in f["loginAfterClass"]
    assert f["loginAfterPressed"] == "true"


def test_share_collect_prefavorited_state(rendered):
    f = block(rendered, "shareFavorite")
    assert f["preOnText"] == FAVORITED_TEXT
    assert FAVORITE_CLASS in f["preOnClass"]
    assert "is-favorited" in f["preOnClass"]


def test_share_collect_unfavorite_confirmation_and_delete(rendered):
    f = block(rendered, "shareFavorite")
    assert f["dialogTitle"] == UNFAVORITE_TITLE
    assert f["dialogMessage"] == UNFAVORITE_MESSAGE
    assert f["confirmText"] == UNFAVORITE_TITLE
    assert f["deleteAfterCancel"] == 0, "取消后不得发起取消收藏请求"
    assert f["deletePath"] == "/api/favorites/7"
    assert f["textAfterDelete"] == FAVORITE_TEXT
    assert "is-favorited" not in f["classAfterDelete"]
    assert f["actionCount"] == 2, "分享页操作区为「收藏 + 下载 .md」"


def test_share_actions_rule(share_css):
    actions = find_rule(share_css, ".share-actions")
    assert actions is not None, "缺少 .share-actions"
    assert prop(actions, "display:flex")
    assert prop(actions, "gap:var(--sp-3)")
    assert prop(actions, "margin-top:var(--sp-6)")


def test_share_js_parses():
    node = shutil.which("node")
    if not node:
        pytest.skip("未检测到 node，跳过 JS 语法检查")
    for name in ("share.js", "comments.js"):
        path = JS_DIR / name
        if not path.exists():
            continue
        proc = subprocess.run([node, "--check", str(path)], cwd=ROOT,
                              capture_output=True, text=True, encoding="utf-8")
        assert proc.returncode == 0, f"{name} 语法错误：\n{proc.stderr}"
