"""Phase 6 Task 4 · 评论区组件 CommentList 与详情页接入契约。

本环境无浏览器，因此用 `tests/js/render_comments.mjs`（复用 `tests/js/dom-shim.mjs` 最小 DOM 双端）
在 Node 中真实调用 `static/js/comments.js` 的 `renderComments`，断言头部计数、两态表单、
列表项、删除二次确认、空态、发表评论与分页。

分享面板与详情页挂载的断言见 `tests/test_share_frontend.py`（同一个 `render_share.mjs` harness）。
CSS 用极小的嵌套感知解析器断言 `notes.css` 的评论样式契约。
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
HARNESS = ROOT / "tests" / "js" / "render_comments.mjs"

HEADING_ZERO = "评论（0）"
HEADING_TWO = "评论（2）"
HEADING_THREE = "评论（3）"
HEADING_ONE = "评论（1）"
HEADING_TWELVE = "评论（12）"
EMPTY_TEXT = "还没有评论，来说点什么吧"
PLACEHOLDER = "写下你的想法…"
SUBMIT_TEXT = "发表评论"
LOGGED_OUT_HINT = "登录后可发表评论"
LOGIN_BUTTON = "去登录"
POSTED_TOAST = "已发表评论"
DELETE_TITLE = "删除评论"
DELETE_MESSAGE = "确定要删除这条评论吗？删除后无法恢复。"
DELETE_CONFIRM = "确定删除"
LOAD_MORE = "加载更多"


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
def notes_css() -> str:
    return (CSS_DIR / "notes.css").read_text(encoding="utf-8")


# ==========================================================================
# 加载骨架
# ==========================================================================

def test_loading_shows_three_skeleton_rows(rendered):
    s = block(rendered, "loadingState")
    assert s["skeletons"] == 3, "评论区加载中显示 3 行骨架"
    assert s["skeletonsAfterLoad"] == 0, "加载完成后骨架必须移除"


# ==========================================================================
# 列表
# ==========================================================================

def test_comment_list_heading_uses_total(rendered):
    assert block(rendered, "commentsList")["heading"] == HEADING_TWO


def test_comment_item_structure(rendered):
    c = block(rendered, "commentsList")
    assert c["items"] == 2
    assert c["avatars"] == ["a", "b"], "首字头像"
    assert c["authors"] == ["alice", "bob"]
    assert c["bodies"] == ["第一条评论", "第二条\n带换行"], "正文逐字（换行由 CSS pre-wrap 保留）"
    for value in c["times"]:
        assert value, "评论需要展示时间"


def test_delete_button_only_when_can_delete(rendered):
    c = block(rendered, "commentsList")
    assert c["deleteButtons"] == 1, "can_delete=false 的评论不得出现删除按钮"
    assert c["deleteText"] == ["删除"]


def test_logged_in_form(rendered):
    c = block(rendered, "commentsList")
    assert c["textareaPlaceholder"] == PLACEHOLDER
    assert c["textareaMaxlength"] == "1000"
    assert SUBMIT_TEXT in c["submitTexts"]


def test_list_requests_once_and_no_more_button(rendered):
    c = block(rendered, "commentsList")
    assert c["listPath"] == ["/api/notes/11/comments"]
    assert c["hasMore"] is False, "全部加载完不显示「加载更多」"
    assert c["emptyText"] == "", "有评论时不显示空态文案"


# ==========================================================================
# 空态
# ==========================================================================

def test_empty_state(rendered):
    e = block(rendered, "commentsEmpty")
    assert e["heading"] == HEADING_ZERO
    assert e["emptyText"] == EMPTY_TEXT
    assert e["items"] == 0
    assert e["hasMore"] is False
    assert e["hasTextarea"] is True, "空态下仍可发表评论"


# ==========================================================================
# 未登录
# ==========================================================================

def test_logged_out_form_replaced_by_hint(rendered):
    o = block(rendered, "commentsLoggedOut")
    assert o["hint"] == LOGGED_OUT_HINT
    assert o["hasTextarea"] is False, "未登录时输入区被替换"
    assert o["buttonText"] == LOGIN_BUTTON


def test_logged_out_login_button_keeps_return_path(rendered):
    o = block(rendered, "commentsLoggedOut")
    assert o["navUrl"] == "/login?redirect=%2Fs%2Ftok-123", o["navUrl"]


# ==========================================================================
# 发表评论
# ==========================================================================

def test_post_comment_clears_input_appends_and_toasts(rendered):
    p = block(rendered, "commentsPost")
    assert p["postPath"] == "/api/notes/11/comments"
    assert json.loads(p["postBody"]) == {"content": "我的新评论"}
    assert p["textareaValue"] == "", "提交后清空输入框"
    assert p["items"] == 3, "新评论追加到列表末尾"
    assert p["lastBody"] == "我的新评论"
    assert p["heading"] == HEADING_THREE, "total 加一"
    assert p["toast"] == POSTED_TOAST


# ==========================================================================
# 删除
# ==========================================================================

def test_delete_confirmation_copy(rendered):
    d = block(rendered, "commentsDelete")
    assert d["title"] == DELETE_TITLE
    assert d["message"] == DELETE_MESSAGE
    assert d["confirmText"] == DELETE_CONFIRM
    assert "btn-danger" in d["confirmClass"]
    assert d["deleteAfterCancel"] == 0, "取消后不得发起删除请求"


def test_delete_confirmed_removes_from_list(rendered):
    d = block(rendered, "commentsDelete")
    assert d["deletePath"] == "/api/comments/1"
    assert d["items"] == 1
    assert d["heading"] == HEADING_ONE
    assert d["authors"] == ["bob"], "被删除的评论从列表消失"


# ==========================================================================
# 分页
# ==========================================================================

def test_load_more_appends_pages(rendered):
    m = block(rendered, "commentsMore")
    assert m["firstHeading"] == HEADING_TWELVE
    assert m["firstItems"] == 5
    assert m["firstHasMore"] is True, "total > page_size 时显示「加载更多」"
    assert m["paths"] == [
        "/api/notes/11/comments",
        "/api/notes/11/comments?page=2&page_size=5",
    ]
    assert m["secondItems"] == 10
    assert m["secondHasMore"] is True
    assert m["thirdItems"] == 12
    assert m["thirdHasMore"] is False, "全部加载完按钮消失"
    assert m["lastBody"] == "评论11"


# ==========================================================================
# 加载失败
# ==========================================================================

def test_list_failure_does_not_break_page(rendered):
    f = block(rendered, "commentsFail")
    assert f["items"] == 0
    assert f["skeletons"] == 0, "失败后骨架必须移除"
    assert f["errorText"] == "请求的内容不存在", "展示后端 message"


# ==========================================================================
# notes.css 评论样式契约
# ==========================================================================

def test_notes_css_still_has_no_hardcoded_color(notes_css):
    match = HARDCODED_COLOR.search(strip_comments(notes_css))
    assert match is None, f"notes.css 出现硬编码色值：{match.group(0)!r}"


def test_comment_rule(notes_css):
    body = find_rule(notes_css, ".comment")
    assert body is not None, "缺少 .comment"
    assert prop(body, "border-top:var(--bd)")
    assert prop(body, "padding:var(--sp-4) 0")


def test_comment_avatar_rule(notes_css):
    body = find_rule(notes_css, ".comment-avatar")
    assert body is not None, "缺少 .comment-avatar"
    assert prop(body, "width:32px")
    assert prop(body, "height:32px")
    assert prop(body, "border-radius:50%")
    assert prop(body, "background:var(--c-accent)")
    assert prop(body, "color:var(--c-text)")


def test_comment_body_preserves_newlines(notes_css):
    body = find_rule(notes_css, ".comment-body")
    assert body is not None, "缺少 .comment-body"
    assert prop(body, "white-space:pre-wrap")


def test_comment_delete_is_a_text_button(notes_css):
    body = find_rule(notes_css, ".comment-delete")
    assert body is not None, "缺少 .comment-delete"
    assert prop(body, "background:none")
    assert prop(body, "border:0")
    assert prop(body, "color:var(--c-text-muted-strong)")


# ==========================================================================
# 键盘可达性（Tab 序列的 DOM 顺序近似）
# ==========================================================================

def test_comments_keyboard_order(rendered):
    order = block(rendered, "commentsList")["interactiveOrder"]
    assert order == ["textarea:写下你的想法…", "button:发表评论", "button:删除"], order


def test_comments_layout_rules(notes_css):
    title = find_rule(notes_css, ".comments-title")
    assert title is not None, "缺少 .comments-title"

    form = find_rule(notes_css, ".comment-form")
    assert form is not None, "缺少 .comment-form"
    assert prop(form, "margin-bottom:var(--sp-6)")

    empty = find_rule(notes_css, ".comment-empty")
    assert empty is not None, "缺少 .comment-empty"
    assert prop(empty, "color:var(--c-text-muted-strong)")

    more = find_rule(notes_css, ".comment-more")
    assert more is not None, "缺少 .comment-more"
