"""Phase 5 Task 2 / Task 4 · 笔记列表页、工具条、卡片、分页、详情页契约。

本环境无浏览器，因此用 `tests/js/render_notes.mjs`（复用 `tests/js/dom-shim.mjs` 最小 DOM 双端）
在 Node 中真实调用 `static/js/notes.js` 的 `renderNoteList` / `renderNoteGrid` /
`renderNoteDetail` 与 `ui.js` 的 `noteCard` / `pagination`，断言生成的标记、文案与交互落点。

CSS 部分用极小的嵌套感知解析器断言 `notes.css` 的布局/令牌契约；像素观感见
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
HARNESS = ROOT / "tests" / "js" / "render_notes.mjs"
DETAIL_HARNESS = ROOT / "tests" / "js" / "render_note_detail.mjs"

EMPTY_ALL = "还没有笔记，去写下第一篇吧"
EMPTY_FILTERED = "没有找到符合条件的笔记"
EMPTY_NOTE = "（空白笔记）"
UNTITLED = "无标题"
SEARCH_PLACEHOLDER = "搜索标题或正文…"
STALE_TITLE = "内容已失效"
NOT_FOUND_TITLE = "笔记不存在或已被删除"

# Phase 7 Task 2 · 收藏按钮
FAVORITE_TEXT = "收藏"
FAVORITED_TEXT = "已收藏"
FAVORITE_CLASS = "favorite-btn"
UNFAVORITE_TITLE = "取消收藏"
UNFAVORITE_MESSAGE = "确定要取消收藏这篇笔记吗？"
ALREADY_FAVORITED_MESSAGE = "已收藏过该笔记"


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
    """harness 内的任何静默失败都会记进 errors，必须为空。"""
    assert rendered["errors"] == {}, rendered["errors"]


@pytest.fixture(scope="module")
def detail() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("未检测到 node，跳过 Node DOM 渲染契约测试")
    proc = subprocess.run(
        [node, str(DETAIL_HARNESS)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, f"node 渲染失败：\n{proc.stdout}\n{proc.stderr}"
    return json.loads(proc.stdout)


def test_detail_harness_reports_no_errors(detail):
    assert detail["errors"] == {}, detail["errors"]


# ==========================================================================
# 极简 CSS 解析（嵌套感知，与 tests/test_static_pages.py 同风格）
# ==========================================================================

def strip_comments(css: str) -> str:
    return re.sub(r"/\*.*?\*/", "", css, flags=re.S)


def parse_css(css: str) -> list[tuple[str | None, str, str]]:
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
def notes_css() -> str:
    return (CSS_DIR / "notes.css").read_text(encoding="utf-8")


# ==========================================================================
# Task 2 · 导出与工具条
# ==========================================================================

def test_notes_module_exports(rendered):
    assert "importNotes" not in rendered["errors"], rendered["errors"]
    assert block(rendered, "gridExport")["isFunction"] is True


def test_toolbar_status_filter_buttons(rendered):
    t = block(rendered, "toolbar")
    assert "note-toolbar" in t["html"]
    assert [(b["text"], b["value"]) for b in t["statusButtons"]] == [
        ("全部", "all"), ("草稿", "draft"), ("私密", "private"), ("已分享", "public"),
    ]
    active = [b for b in t["statusButtons"] if b["active"]]
    assert len(active) == 1 and active[0]["value"] == "all"
    assert [b["pressed"] for b in t["statusButtons"]] == ["true", "false", "false", "false"]


def test_toolbar_tag_select_and_search_input(rendered):
    t = block(rendered, "toolbar")
    assert t["tagOptions"][0] == {"value": "", "text": "全部标签"}
    assert [o["text"] for o in t["tagOptions"][1:]] == ["生活", "工作"]
    assert t["search"]["type"] == "search"
    assert t["search"]["placeholder"] == SEARCH_PLACEHOLDER
    assert t["search"]["ariaLabel"], "搜索框需要 aria-label"


def test_toolbar_sort_buttons(rendered):
    t = block(rendered, "toolbar")
    assert [(b["text"], b["value"]) for b in t["sortButtons"]] == [
        ("按更新时间", "updated"), ("按创建时间", "created"),
    ]
    active = [b for b in t["sortButtons"] if b["active"]]
    assert len(active) == 1 and active[0]["value"] == "updated"


def test_toolbar_hides_clear_filters_without_filters(rendered):
    assert block(rendered, "toolbar")["hasClear"] is False


# ==========================================================================
# Task 2 · 骨架 / 卡片 / 分页
# ==========================================================================

def test_loading_shows_six_skeletons(rendered):
    assert block(rendered, "skeletonCount") == 6


def test_cards_render_title_summary_badge_time_tags(rendered):
    data = block(rendered, "list")
    assert data["cardCount"] == 2
    assert data["paperClass"] == [True, True], "卡片必须是纸张容器（.paper）"
    assert data["titleTexts"] == ["第一篇", UNTITLED]
    assert data["summaries"] == ["这是第一篇的摘要", EMPTY_NOTE]
    assert [b["text"] for b in data["badges"]] == ["草稿", "已分享"]
    assert "badge-draft" in data["badges"][0]["cls"]
    assert "badge-public" in data["badges"][1]["cls"]
    assert data["tags"] == ["生活", "随笔"]
    for value in data["times"]:
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", value), value
    assert data["hasSkeletonLeft"] == 0, "加载完成后骨架必须移除"


def test_pagination_text_and_bounds(rendered):
    data = block(rendered, "list")
    assert data["paginationInfo"] == "第 1 / 3 页"
    assert data["paginationTotal"] == "共 25 篇"

    pages = block(rendered, "pages")
    assert pages["firstPrevDisabled"] is True
    assert pages["firstNextDisabled"] is False
    assert pages["nextNavUrl"] == "/notes?page=2"
    assert pages["lastInfo"] == "第 3 / 3 页"
    assert pages["lastPrevDisabled"] is False
    assert pages["lastNextDisabled"] is True


def test_pagination_unit(rendered):
    pag = block(rendered, "pagination")
    assert pag["single"] == {
        "info": "第 1 / 1 页", "total": "共 0 篇",
        "prevDisabled": True, "nextDisabled": True,
    }
    assert pag["midInfo"] == "第 2 / 3 页"
    assert pag["picked"] == [1, 3], "上一页/下一页分别回调 page-1 / page+1"


def test_card_click_navigates_to_detail(rendered):
    assert block(rendered, "cardClick")["navUrl"] == "/notes/11"


# ==========================================================================
# Task 2 · 空态与筛选交互
# ==========================================================================

def test_empty_state_without_filters(rendered):
    empty = block(rendered, "emptyAll")
    assert empty["title"] == EMPTY_ALL
    assert empty["actionText"] == "写第一篇笔记"
    assert empty["navUrl"] == "/notes/new"
    assert empty["hasGrid"] is False


def test_empty_state_with_filters(rendered):
    empty = block(rendered, "emptyFiltered")
    assert empty["title"] == EMPTY_FILTERED
    assert empty["actionText"] == "清除筛选"
    assert empty["navUrl"] == "/notes"


def test_clear_filters_button_only_when_filtered(rendered):
    clear = block(rendered, "clearFilters")
    assert clear["visible"] is True
    assert clear["draftActive"] == "true"
    assert clear["navUrl"] == "/notes"


def test_status_filter_click_updates_url(rendered):
    assert block(rendered, "statusClick")["navUrl"] == "/notes?status=private"


def test_sort_click_keeps_filters_and_resets_page(rendered):
    assert block(rendered, "sortClick")["navUrl"] == "/notes?status=draft&sort=created"


def test_search_is_debounced_and_resets_page(rendered):
    d = block(rendered, "debounce")
    assert d["navBeforeWait"] == 0, "300ms 内不得跳转"
    assert d["navAfterWait"] == 1, "防抖后只跳转一次"
    assert d["lastUrl"] == "/notes?q=" + "%E5%85%B3%E9%94%AE%E8%AF%8D"
    assert "page=" not in d["lastUrl"], "搜索跳转必须把 page 重置为 1"


# ==========================================================================
# Task 2 · 失效占位 / 网格复用 / 登录守卫
# ==========================================================================

def test_stale_card_placeholder(rendered):
    stale = block(rendered, "stale")
    assert stale["isStale"] is True
    assert "note-card" in stale["className"] and "is-stale" in stale["className"]
    assert stale["title"] == STALE_TITLE
    assert stale["hasSummary"] is False, "失效占位不展示摘要"
    assert stale["openedOnCardClick"] == 0, "失效卡片不提供打开行为"
    assert stale["removeText"] == "移除"
    assert stale["removedOnRemoveClick"] == 1
    assert "badge" not in stale["html"], "失效占位不展示状态徽标"


def test_render_note_grid_is_reusable(rendered):
    g = block(rendered, "gridExport")
    assert g["hostCardCount"] == 2
    assert g["hostHasToolbar"] is False, "网格自身不渲染工具条（供 /me 复用）"


def test_notes_route_requires_auth(rendered):
    guard = block(rendered, "guard")
    assert guard["lastUrl"] == "/login?redirect=%2Fnotes"
    assert guard["method"] == "replace"


# ==========================================================================
# Task 2 · notes.css 布局与令牌契约
# ==========================================================================

def test_notes_css_has_no_hardcoded_color(notes_css):
    match = HARDCODED_COLOR.search(strip_comments(notes_css))
    assert match is None, f"notes.css 出现硬编码色值：{match.group(0)!r}（应引用 base.css 令牌）"


def test_note_toolbar_layout(notes_css):
    body = find_rule(notes_css, ".note-toolbar")
    assert body is not None
    assert prop(body, "display:flex")
    assert prop(body, "flex-wrap:wrap")
    assert prop(body, "gap:var(--sp-3)")
    assert prop(body, "align-items:center")
    assert prop(body, "margin-bottom:var(--sp-6)")


def test_segmented_group(notes_css):
    body = find_rule(notes_css, ".segmented")
    assert body is not None
    assert prop(body, "border-radius:var(--r-1)")
    inner = find_rule(notes_css, ".segmented button")
    assert inner is not None and prop(inner, "border:0")
    active = find_rule(notes_css, ".segmented button.is-active")
    assert active is not None and prop(active, "background:var(--c-accent)")


def test_search_input_dimensions(notes_css):
    body = find_rule(notes_css, ".note-search")
    assert body is not None
    assert prop(body, "flex:1")
    assert prop(body, "min-width:200px")
    assert prop(body, "max-width:360px")
    assert prop(body, "height:40px")


def test_note_grid_auto_fill(notes_css):
    body = find_rule(notes_css, ".note-grid")
    assert body is not None
    assert prop(body, "display:grid")
    assert prop(body, "grid-template-columns:repeat(auto-fill, minmax(280px, 1fr))")
    assert prop(body, "gap:var(--sp-6)")


def test_note_card_paper_styles(notes_css):
    body = find_rule(notes_css, ".note-card")
    assert body is not None
    assert prop(body, "background-image:url(\"/static/img/paper.jpg\")")
    assert prop(body, "background-color:var(--c-paper-fallback)")
    assert prop(body, "border:var(--bd)")
    assert prop(body, "border-radius:var(--r-2)")
    assert prop(body, "padding:var(--sp-6)")


def test_note_card_hover_and_reduced_motion(notes_css):
    hover = find_rule(notes_css, ".note-card:hover")
    assert hover is not None
    assert prop(hover, "box-shadow:var(--sd-card)")
    assert prop(hover, "transform:translateY(-2px)")

    reduced = find_rule(notes_css, ".note-card:hover", media="prefers-reduced-motion: reduce")
    assert reduced is not None, "prefers-reduced-motion 下必须有降级规则"
    assert prop(reduced, "transform:none")


def test_note_summary_clamp(notes_css):
    body = find_rule(notes_css, ".note-summary")
    assert body is not None
    assert prop(body, "font-size:var(--fs-sm)")
    assert prop(body, "color:var(--c-text-muted-strong)")
    assert prop(body, "display:-webkit-box")
    assert prop(body, "-webkit-line-clamp:3")
    assert prop(body, "-webkit-box-orient:vertical")
    assert prop(body, "overflow:hidden")


def test_badge_and_stale_styles(notes_css):
    badge = find_rule(notes_css, ".badge")
    assert badge is not None
    assert prop(badge, "font-size:var(--fs-xs)")
    assert prop(badge, "padding:2px 8px")
    assert prop(badge, "border-radius:999px")

    assert find_rule(notes_css, ".badge-draft") is not None
    assert find_rule(notes_css, ".badge-private") is not None
    assert find_rule(notes_css, ".badge-public") is not None

    stale = find_rule(notes_css, ".note-card.is-stale")
    assert stale is not None and prop(stale, "opacity:.7")


def test_pagination_centered(notes_css):
    body = find_rule(notes_css, ".pagination")
    assert body is not None
    assert prop(body, "justify-content:center")
    assert prop(body, "gap:var(--sp-4)")


def test_notes_css_mobile_breakpoint(notes_css):
    grid = find_rule(notes_css, ".note-grid", media="max-width: 768px")
    assert grid is not None and prop(grid, "grid-template-columns:1fr")

    search = find_rule(notes_css, ".note-search", media="max-width: 768px")
    assert search is not None
    assert prop(search, "flex:1 1 100%") and prop(search, "max-width:none")


# ==========================================================================
# Task 4 · 笔记详情页
# ==========================================================================

def test_detail_loading_and_exports(detail):
    d = block(detail, "detail")
    assert d["exportIsFunction"] is True
    assert d["loadingSkeletons"] == 2, "详情载入中显示骨架"


def test_detail_structure_and_meta(detail):
    d = block(detail, "detail")
    assert d["paperClass"] is True, "详情正文承载在纸张容器上"
    assert d["title"] == "我的第一篇"
    assert d["badgeText"] == "私密"
    assert "badge-private" in d["badgeClass"]
    assert d["tags"] == ["生活", "随笔"]
    assert d["lengthText"] == "共 7 字"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", d["timeText"]), d["timeText"]


def test_detail_body_is_rendered_markdown(detail):
    d = block(detail, "detail")
    assert d["bodyHasMarkdownClass"] is True
    assert d["bodyHtml"] == d["bodyExpected"], "正文必须等于 renderMarkdown(content_md)"


def test_detail_actions_are_favorite_edit_delete(detail):
    """Phase 7 Task 2 起操作条为「收藏 / 编辑 / 删除」，收藏按钮排在编辑之前。"""
    d = block(detail, "detail")
    assert d["actionTexts"] == [FAVORITE_TEXT, "编辑", "删除"]
    assert "btn-secondary" in d["actionClasses"][0]
    assert FAVORITE_CLASS in d["actionClasses"][0]
    assert "btn-secondary" in d["actionClasses"][1]
    assert "btn-danger" in d["actionClasses"][2]
    assert d["hasShareButton"] is False, "详情页不放独立分享按钮（由分享面板承担）"
    assert d["hasFavoriteButton"] is True


def test_detail_empty_title_and_content(detail):
    e = block(detail, "empties")
    assert e["title"] == UNTITLED
    assert e["bodyText"] == EMPTY_NOTE
    assert e["bodyHtml"] == "", "空白笔记不渲染任何 HTML"


def test_detail_edit_navigates_to_editor(detail):
    assert block(detail, "editAction")["navUrl"] == "/notes/11/edit"


def test_detail_delete_confirmation_copy(detail):
    r = block(detail, "remove")
    assert r["dialogTitle"] == "删除笔记"
    assert r["dialogMessage"] == "确定要删除这篇笔记吗？删除后无法恢复。"
    assert r["role"] == "dialog"
    assert r["ariaModal"] == "true"
    assert r["confirmText"] == "确定删除"
    assert "btn-danger" in r["confirmClass"]
    assert r["cancelText"] == "取消"
    assert r["deleteCallsAfterCancel"] == 0, "取消后不得发起删除请求"


def test_detail_delete_confirmed_returns_to_list(detail):
    r = block(detail, "remove")
    assert r["deletePath"] == "/api/notes/11"
    assert r["toast"] == "已删除"
    assert r["navUrl"] == "/notes"


def test_detail_missing_note_shows_empty_state(detail):
    m = block(detail, "missing")
    assert m["title"] == NOT_FOUND_TITLE
    assert m["actionText"] == "返回笔记列表"
    assert m["navUrl"] == "/notes"


def test_detail_css(notes_css):
    title = find_rule(notes_css, ".detail-title")
    assert title is not None
    assert prop(title, "font-size:var(--fs-h2)")
    assert prop(title, "font-weight:600")

    meta = find_rule(notes_css, ".detail-meta")
    assert meta is not None
    assert prop(meta, "font-size:var(--fs-sm)")
    assert prop(meta, "color:var(--c-text-muted-strong)")
    assert prop(meta, "display:flex")
    assert prop(meta, "flex-wrap:wrap")
    assert prop(meta, "gap:var(--sp-3)")
    assert prop(meta, "align-items:center")

    body = find_rule(notes_css, ".detail-body")
    assert body is not None
    assert prop(body, "max-width:var(--reading-max)")
    assert prop(body, "margin:0 auto")

    actions = find_rule(notes_css, ".detail-actions")
    assert actions is not None
    assert prop(actions, "display:flex")
    assert prop(actions, "gap:var(--sp-3)")
    assert prop(actions, "border-top:var(--bd)")


def test_detail_actions_mobile(notes_css):
    actions = find_rule(notes_css, ".detail-actions", media="max-width: 768px")
    assert actions is not None and prop(actions, "flex-wrap:wrap")

    btn = find_rule(notes_css, ".detail-actions .btn", media="max-width: 768px")
    assert btn is not None and prop(btn, "flex:1 1 45%")


# ==========================================================================
# Phase 7 Task 2 · 详情页收藏按钮
# ==========================================================================

def test_detail_favorite_button_initial_state(detail):
    """渲染时并行查询收藏列表；未收藏时显示「收藏」且不置 aria-pressed。"""
    f = block(detail, "favorite")
    assert f["actionOrder"] == [FAVORITE_TEXT, "编辑", "删除"]
    assert f["initialText"] == FAVORITE_TEXT
    assert FAVORITE_CLASS in f["initialClass"]
    assert "is-favorited" not in f["initialClass"]
    assert f["initialPressed"] == "false"
    assert f["listGetPath"] == "/api/favorites?page_size=50"


def test_detail_favorite_click_posts_and_flips(detail):
    f = block(detail, "favorite")
    assert f["postPath"] == "/api/favorites"
    assert json.loads(f["postBody"]) == {"note_id": 11}
    assert f["afterText"] == FAVORITED_TEXT
    assert "is-favorited" in f["afterClass"]
    assert f["afterPressed"] == "true"


def test_detail_already_favorited_flips_and_toasts_backend_message(detail):
    """ALREADY_FAVORITED 不当作失败流程：直接置为「已收藏」并 toast 后端 message。"""
    f = block(detail, "favorite")
    assert f["alreadyText"] == FAVORITED_TEXT
    assert "is-favorited" in f["alreadyClass"]
    assert f["alreadyToast"] == ALREADY_FAVORITED_MESSAGE


def test_detail_prefavorited_state_comes_from_favorites_list(detail):
    f = block(detail, "favorite")
    assert f["preOnText"] == FAVORITED_TEXT
    assert "is-favorited" in f["preOnClass"]


def test_detail_unfavorite_confirmation_copy(detail):
    f = block(detail, "favorite")
    assert f["dialogTitle"] == UNFAVORITE_TITLE
    assert f["dialogMessage"] == UNFAVORITE_MESSAGE
    assert f["dialogRole"] == "dialog"
    assert f["dialogAriaModal"] == "true"
    assert f["confirmText"] == UNFAVORITE_TITLE
    assert f["deleteAfterCancel"] == 0, "取消后不得发起取消收藏请求"
    assert f["textAfterCancel"] == FAVORITED_TEXT, "取消后按钮保持「已收藏」"


def test_detail_unfavorite_confirmed_deletes_and_flips_back(detail):
    f = block(detail, "favorite")
    assert f["deletePath"] == "/api/favorites/11"
    assert f["textAfterDelete"] == FAVORITE_TEXT
    assert "is-favorited" not in f["classAfterDelete"]
    assert f["pressedAfterDelete"] == "false"


def test_favorite_button_style_uses_tokens(notes_css):
    body = find_rule(notes_css, ".btn.is-favorited")
    assert body is not None, "缺少 .btn.is-favorited（已收藏态主色描边）"
    assert prop(body, "border-color:var(--c-primary-hover)")
    assert prop(body, "color:var(--c-primary-hover)")
