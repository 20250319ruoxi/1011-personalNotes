"""Phase 5 Task 3 · 分栏实时预览编辑器（含脏标记、离开拦截、标签、插图、快捷键）契约。

本环境无浏览器，因此用 `tests/js/render_editor.mjs`（复用 `tests/js/dom-shim.mjs` 最小 DOM 双端）
在 Node 中真实调用 `static/js/editor.js` 的 `renderEditor`、`store` 的脏标记接口、`router` 的
离开拦截与 `beforeunload`，断言标记、文案与行为。CSS 部分断言 `editor.css` 的布局/令牌契约。
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
HARNESS = ROOT / "tests" / "js" / "render_editor.mjs"

TITLE_PLACEHOLDER = "请输入标题"
TAG_PLACEHOLDER = "添加标签后按回车"
DISCARD_TITLE = "放弃未保存的更改？"
DISCARD_MESSAGE = "当前笔记有未保存的修改，离开将丢失这些内容。"


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
# CSS 解析辅助
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
              occurrence: int = 0, exact: bool = True) -> str | None:
    def matches(sel: str) -> bool:
        return norm(sel) == selector if exact else selector in norm(sel)

    hits = [body for m, sel, body in parse_css(css_text)
            if matches(sel) and (media is None or (m is not None and media in m))]
    return hits[occurrence] if len(hits) > occurrence else None


def prop(body: str, declaration: str) -> bool:
    return declaration in norm(body)


HARDCODED_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|(?<!-)\brgba?\(|hsla?\(")


@pytest.fixture(scope="module")
def editor_css() -> str:
    return (CSS_DIR / "editor.css").read_text(encoding="utf-8")


@pytest.fixture(scope="module")
def base_css_text() -> str:
    return (CSS_DIR / "base.css").read_text(encoding="utf-8")


# ==========================================================================
# store 脏标记接口
# ==========================================================================

def test_store_dirty_api_replaces_raw_page(rendered):
    api = block(rendered, "dirtyApi")
    assert api["hasSetDirty"] is True
    assert api["hasCanLeave"] is True
    assert api["rawPageRemoved"] is True, "rawPage 必须被 dirty / dirtyGuard 取代"
    assert api["dirtyGuardField"] is True
    assert api["leavesWithoutGuard"] is True
    assert api["blockedByGuard"] is False


def test_navigate_is_blocked_while_dirty_and_clears_flag(rendered):
    g = block(rendered, "navGuard")
    assert g["blockedCalls"] == 0, "用户选择「取消」时不得跳转"
    assert g["dirtyStillTrue"] is True
    assert g["allowedLastUrl"] == "/notes"
    assert g["dirtyClearedAfterLeave"] is True


def test_beforeunload_guards_only_when_dirty(rendered):
    u = block(rendered, "unload")
    assert u["preventedWhenDirty"] == 1
    assert u["preventedWhenClean"] == 0


# ==========================================================================
# 新建模式结构
# ==========================================================================

def test_editor_module_exports_and_loading(rendered):
    new = block(rendered, "newMode")
    assert new["exportIsFunction"] is True
    assert new["loadingSkeletons"] == 0, "新建模式无需加载骨架"
    assert block(rendered, "editMode")["loadingSkeletons"] == 2, "编辑模式载入时显示骨架"


def test_editor_new_mode_structure(rendered):
    new = block(rendered, "newMode")
    html = new["html"]
    assert "editor-wrap" in html
    assert new["paperClass"] is True and new["paperHasPaper"] is True
    assert new["titlePlaceholder"] == TITLE_PLACEHOLDER
    assert new["titleMaxlength"] == "200"
    assert new["tagPlaceholder"] == TAG_PLACEHOLDER
    for label in ("存草稿", "保存并发布", "插入图片"):
        assert label in new["buttons"], f"缺少按钮「{label}」"
    assert new["textarea"] is True
    assert "markdown-body" in new["previewClass"]


def test_editor_mobile_tabs_and_file_input(rendered):
    new = block(rendered, "newMode")
    assert [t["text"] for t in new["tabs"]] == ["编辑", "预览"]
    assert [t["pressed"] for t in new["tabs"]] == ["true", "false"]
    assert "is-showing-source" in new["panesClass"]
    assert new["fileType"] == "file"
    assert new["fileAccept"] == "image/png,image/jpeg,image/gif,image/webp"


def test_editor_interactive_elements_are_reachable_in_dom_order(rendered):
    """清单行 13：Tab 应依次可达标题、标签、两个按钮、正文、插入图片。"""
    new = block(rendered, "newMode")
    order = new["interactiveOrder"]
    labels = [item["text"] or item["placeholder"] for item in order]
    assert labels == [
        TITLE_PLACEHOLDER, TAG_PLACEHOLDER, "存草稿", "保存并发布", "编辑", "预览",
        "在这里写下你的想法，支持 Markdown", "插入图片", "",
    ], labels
    assert [item["tag"] for item in order] == [
        "input", "input", "button", "button", "button", "button", "textarea", "button", "input",
    ]


def test_editor_tabs_hidden_on_desktop_visible_on_mobile(editor_css):
    desktop = find_rule(editor_css, ".editor-tabs")
    assert desktop is not None and prop(desktop, "display:none")
    mobile = find_rule(editor_css, ".editor-tabs", media="max-width: 768px")
    assert mobile is not None and prop(mobile, "display:flex")


def test_editor_status_bar_new_note(rendered):
    new = block(rendered, "newMode")
    assert new["statusSave"] == "已保存"
    assert new["statusTime"] == "新建笔记"
    assert new["statusCount"] == "共 0 字"


# ==========================================================================
# 实时预览与状态
# ==========================================================================

def test_preview_is_debounced_and_routed_through_render_markdown(rendered):
    p = block(rendered, "preview")
    assert p["immediate"] is True, "120ms 防抖：输入后不得立刻更新"
    assert p["after"] == p["expected"], "预览必须等于 renderMarkdown() 的输出"
    assert p["rawNotInjected"] is True, "textarea 原文不得直接写入预览"


def test_status_count_and_dirty_marker(rendered):
    s = block(rendered, "status")
    assert s["count"] == "共 4 字", "字数按去掉空白后的字符数统计"
    assert s["saveBeforeDirty"] == "已保存"
    assert s["saveAfterDirty"] == "未保存的更改"
    assert s["storeDirty"] is True


# ==========================================================================
# 标签输入
# ==========================================================================

def test_tag_input_enter_dedupe_backspace_and_cap(rendered):
    t = block(rendered, "tags")
    assert t["afterFirst"] == ["生活"]
    assert t["afterDuplicate"] == ["生活"], "重复标签应被忽略"
    assert t["afterBackspace"] == [], "空输入时 Backspace 删除最后一个标签"
    assert t["maxFive"] == 5
    assert t["afterSixAttempts"] == ["一", "二", "三", "四", "五"]


def test_tag_suggestions_capped_and_clickable(rendered):
    s = block(rendered, "suggest")
    assert s["capped"] is True
    assert len(s["items"]) == 6, "联想下拉最多 6 项"
    assert all(item.startswith("写") for item in s["items"]), "联想按输入前缀过滤"
    assert s["chipsAfterClick"] == [s["items"][0]]
    assert s["suggestionsCleared"] is True


# ==========================================================================
# 存草稿 / 保存并发布
# ==========================================================================

def test_save_draft_posts_and_rewrites_url(rendered):
    d = block(rendered, "saveDraft")
    assert d["postPath"] == "/api/notes"
    assert d["body"] == {
        "title": "我的标题", "content_md": "正文内容", "tags": [], "status": "draft",
    }
    assert d["csrfHeader"] == "csrf-1", "写请求必须带 X-CSRF-Token"
    assert d["toast"] == "已保存为草稿"
    assert d["statusSave"] == "已保存"
    assert d["locationPath"] == "/notes/7/edit", "首次保存后地址栏应变为编辑地址"
    assert d["replaceCall"] == {"method": "replace", "url": "/notes/7/edit"}
    assert d["storeDirty"] is False


def test_publish_button_is_removed(rendered):
    """「发布」已按需求收掉：编辑器只剩「存草稿」与「保存并发布」。"""
    new = block(rendered, "newMode")
    assert "发布" not in new["buttons"], new["buttons"]
    assert "保存并发布" in new["buttons"]


def test_save_draft_on_published_note_keeps_status(rendered):
    p = block(rendered, "saveDraftKeeps")
    assert p["dialog"] is False, "「存草稿」不做二次确认"
    assert p["path"] == "/api/notes/7"
    assert p["body"]["status"] == "private", "已发布笔记免疫降级"
    assert p["toast"] == "已保存，文章保持「已发布」"
    assert p["statusSave"] == "已保存"
    assert "保存并发布" in p["buttons"]


# ==========================================================================
# 保存并发布 / 已分享笔记只读
# ==========================================================================

def test_save_and_publish_requires_confirmation(rendered):
    p = block(rendered, "savePublish")
    assert p["dialogTitle"] == "保存并发布"
    assert p["confirmText"] == "保存并发布"
    assert p["mutationsAfterCancel"] == 0, "取消后不得发起保存或分享请求"


def test_save_and_publish_saves_then_shares_then_locks(rendered):
    p = block(rendered, "savePublish")
    assert p["methods"] == ["PUT /api/notes/7", "POST /api/notes/7/share"], p["methods"]
    assert p["putBody"]["status"] == "private", "内容仍按「离开草稿后不改状态」的规则保存"
    assert p["sharePath"] == "/api/notes/7/share"
    assert p["hasLockedNotice"] is True, "发布后编辑器应立即转为只读"
    assert p["titleReadOnly"] is True
    assert p["toast"] == "已发布并开启分享"
    for gone in ("存草稿", "发布", "保存并发布", "插入图片"):
        assert gone not in p["buttons"], f"发布后不得再显示「{gone}」"


def test_shared_note_editor_is_read_only(rendered):
    p = block(rendered, "lockedNote")
    assert p["hasNotice"] is True, "已分享笔记必须提示「已发布，不可编辑」"
    assert p["titleReadOnly"] is True
    assert p["contentReadOnly"] is True
    assert p["tagDisabled"] is True
    assert p["hasFileInput"] is False, "只读态不得保留插图入口"
    for gone in ("存草稿", "发布", "保存并发布", "插入图片"):
        assert gone not in p["buttons"], f"只读态不得出现「{gone}」"
    assert "打开详情页" in p["buttons"]
    assert p["statusSave"] == "已发布"


# ==========================================================================
# 编辑模式 / 不存在 / 保存失败
# ==========================================================================

def test_editor_edit_mode_prefills_note(rendered):
    e = block(rendered, "editMode")
    assert e["title"] == "已有标题"
    assert e["content"] == "## 小标题"
    assert e["tags"] == ["生活"]
    assert e["statusSave"] == "已保存"
    assert re.fullmatch(r"更新于 \d{1,2}/\d{1,2} \d{2}:\d{2}", e["statusTime"]), e["statusTime"]


def test_editor_not_found_shows_empty_state(rendered):
    n = block(rendered, "notFound")
    assert n["title"] == "笔记不存在或已被删除"
    assert n["actionText"] == "返回笔记列表"
    assert n["navUrl"] == "/notes"


def test_save_failure_keeps_input_and_reports_state(rendered):
    f = block(rendered, "failSave")
    assert f["titleKept"] == "不该丢的标题"
    assert f["contentKept"] == "不该丢的正文"
    assert f["statusSave"] == "保存失败，请重试"
    assert f["toast"] == "输入内容超出长度限制"


def test_ctrl_s_saves_draft_and_prevents_default(rendered):
    s = block(rendered, "shortcut")
    assert s["prevented"] == 1, "Ctrl+S 必须阻止浏览器默认保存"
    assert s["postCalled"] is True
    assert s["toast"] == "已保存为草稿"


# ==========================================================================
# 插图 / 分栏切换 / 滚动同步
# ==========================================================================

def test_image_upload_inserts_markdown_at_cursor(rendered):
    i = block(rendered, "image")
    assert i["uploadCalled"] is True
    assert i["usedFormData"] is True, "上传必须走 multipart FormData"
    assert i["value"] == "前文![](/static/uploads/u1-abc.png)后文"


def test_mobile_pane_toggle(rendered):
    t = block(rendered, "tabsToggle")
    assert "is-showing-source" in t["defaultClass"]
    assert "is-showing-preview" in t["afterPreview"]
    assert t["previewPressed"] == "true"
    assert t["afterSource"] == t["defaultClass"]
    assert t["sourcePressed"] == "true"


def test_scroll_sync_uses_percentage(rendered):
    s = block(rendered, "scrollSync")
    assert s["previewScrollTop"] == s["expected"]


def test_notes_new_route_wins_over_dynamic_id_route(rendered):
    """/notes/new 必须命中编辑器路由，不能被 /notes/:id 抢先匹配。"""
    r = block(rendered, "routing")
    assert r["pathname"] == "/notes/new"
    assert r["hasEditor"] is True
    assert r["hasDetail"] is False
    assert r["hasList"] is False


# ==========================================================================
# editor.css 契约
# ==========================================================================

def test_editor_css_has_no_hardcoded_color(editor_css):
    match = HARDCODED_COLOR.search(strip_comments(editor_css))
    assert match is None, f"editor.css 出现硬编码色值：{match.group(0)!r}（应引用 base.css 令牌）"


def test_code_background_token_exists_in_base(base_css_text):
    tokens = dict(re.findall(r"--([\w-]+)\s*:\s*([^;]+);", strip_comments(base_css_text)))
    assert tokens.get("c-code-bg", "").strip() == "rgba(195, 164, 123, .16)"


def test_editor_wrap_and_card(editor_css):
    wrap = find_rule(editor_css, ".editor-wrap")
    assert wrap is not None
    assert prop(wrap, "max-width:var(--page-max)")
    assert prop(wrap, "margin:0 auto")
    assert prop(wrap, "padding:var(--sp-6) var(--gutter) var(--sp-12)")

    paper = find_rule(editor_css, ".editor-paper")
    assert paper is not None
    assert prop(paper, "border-radius:var(--r-2)")
    assert prop(paper, "padding:var(--sp-6)")
    # 2026-10 改版：编辑卡片由羊皮纸纹理改为暖白卡面，羊皮纸移作整页背景
    assert prop(paper, "background-color:var(--c-card)")
    assert prop(paper, "border:var(--bd)")


def test_editor_head_and_title(editor_css):
    head = find_rule(editor_css, ".editor-head")
    assert head is not None
    assert prop(head, "display:flex")
    assert prop(head, "gap:var(--sp-3)")
    assert prop(head, "align-items:center")

    title = find_rule(editor_css, ".editor-title")
    assert title is not None
    assert prop(title, "font-size:var(--fs-h2)")
    assert prop(title, "font-weight:600")
    assert prop(title, "border:none")
    assert prop(title, "background:transparent")
    assert prop(title, "outline:none")
    assert prop(title, "width:100%")


def test_editor_panes_split(editor_css):
    panes = find_rule(editor_css, ".editor-panes")
    assert panes is not None
    assert prop(panes, "display:grid")
    assert prop(panes, "grid-template-columns:1fr 1fr")
    assert prop(panes, "gap:0")
    assert prop(panes, "margin-top:var(--sp-4)")
    assert prop(panes, "border-top:var(--bd)")

    source = find_rule(editor_css, ".pane-source textarea")
    assert source is not None
    assert prop(source, "width:100%")
    assert prop(source, "min-height:52vh")
    assert prop(source, "border:none")
    assert prop(source, "background:transparent")
    assert prop(source, "resize:none")
    assert "ui-monospace,Consolas,monospace" in norm(source)
    assert prop(source, "font-size:var(--fs-sm)")
    assert prop(source, "line-height:1.8")
    assert prop(source, "outline:none")

    preview = find_rule(editor_css, ".pane-preview")
    assert preview is not None
    assert prop(preview, "min-height:52vh")
    assert prop(preview, "overflow-y:auto")
    assert prop(preview, "padding-left:var(--sp-6)")
    assert prop(preview, "border-left:var(--bd)")


def test_markdown_body_typography(editor_css):
    heading = find_rule(editor_css, ".markdown-body h1", exact=False)
    assert heading is not None and prop(heading, "font-size:var(--fs-h2)")

    paragraph = find_rule(editor_css, ".markdown-body p")
    assert paragraph is not None
    assert prop(paragraph, "font-size:var(--fs-base)")
    assert prop(paragraph, "line-height:var(--lh-reading)")

    code = find_rule(editor_css, ".markdown-body code", exact=False)
    assert code is not None
    assert prop(code, "background:var(--c-code-bg)")
    assert prop(code, "border-radius:4px")

    pre = find_rule(editor_css, ".markdown-body pre", exact=False)
    assert pre is not None
    assert prop(pre, "background:var(--c-page)")
    assert prop(pre, "padding:var(--sp-4)")
    assert prop(pre, "overflow-x:auto")

    quote = find_rule(editor_css, ".markdown-body blockquote", exact=False)
    assert quote is not None
    assert "3px solid var(--c-accent)" in norm(quote)
    assert prop(quote, "color:var(--c-text-muted-strong)")

    img = find_rule(editor_css, ".markdown-body img", exact=False)
    assert img is not None and prop(img, "max-width:100%")

    table = find_rule(editor_css, ".markdown-body table", exact=False)
    assert table is not None and prop(table, "width:100%")
    cell = find_rule(editor_css, ".markdown-body th", exact=False)
    assert cell is not None and "1px solid var(--c-border)" in norm(cell)


def test_editor_status_and_mobile_breakpoint(editor_css):
    status = find_rule(editor_css, ".editor-status", exact=False)
    assert status is not None
    assert prop(status, "font-size:var(--fs-xs)")
    assert prop(status, "color:var(--c-text-muted)")

    panes = find_rule(editor_css, ".editor-panes", media="max-width: 768px")
    assert panes is not None and prop(panes, "grid-template-columns:1fr")

    preview = find_rule(editor_css, ".pane-preview", media="max-width: 768px")
    assert preview is not None
    assert prop(preview, "border-left:none")
    assert prop(preview, "padding-left:0")

    showing = find_rule(editor_css, ".editor-panes.is-showing-preview", media="max-width: 768px",
                        exact=False)
    assert showing is not None, "≤768px 需支持编辑/预览切换"
