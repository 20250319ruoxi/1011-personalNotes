"""Phase 7 Task 3 / Task 4 · 个人主页四 Tab 渲染契约。

本环境无浏览器，因此用 `tests/js/render_profile.mjs`（复用 `tests/js/dom-shim.mjs` 最小 DOM 双端）
在 Node 中真实调用 `static/js/profile.js` 的 `renderProfile`、`static/js/notes.js` 的
`renderNoteGrid`、`static/js/ui.js` 的 `staleCard` / `favoriteButton`，断言生成的标记、
文案、ARIA、请求序列与交互落点；并用极小的嵌套感知解析器断言 `profile.css` 的令牌契约。

像素观感 / 焦点环 / 动画见 `tests/manual/visual-checklist.md`（标注为待人工确认，不视为通过）。
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
HARNESS = ROOT / "tests" / "js" / "render_profile.mjs"

# 规格 Components 表逐字文案
TAB_LABELS = ["个人信息", "我的笔记", "我的收藏", "浏览足迹"]
EMPTY_NOTES = "还没有笔记，去写下第一篇吧"
EMPTY_FAVORITES = "还没有收藏"
EMPTY_HISTORY = "还没有浏览记录"
STALE_TITLE = "内容已失效"
REMOVE_TEXT = "移除"
UNFAVORITE_TEXT = "取消收藏"
SAVE_BUTTON = "保存资料"
PASSWORD_BUTTON = "修改密码"
CLEAR_HISTORY = "清空浏览记录"
CLEAR_MESSAGE = "确定要清空全部浏览记录吗？此操作不可恢复。"
CLEAR_CONFIRM = "清空"
BLOCKED_MESSAGE = "需要先通过分享链接访问并解锁"
NO_BIO = "还没有填写简介"
SAVED_TOAST = "已保存"
PASSWORD_TOAST = "密码已修改"
CLEARED_TOAST = "已清空浏览记录"
PASSWORD_WRONG = "原密码不正确"
PASSWORD_WEAK = "密码长度需为 8-64 位，且包含字母与数字"
PASSWORD_MISMATCH = "两次输入的密码不一致"
SEARCH_PLACEHOLDER = "搜索标题或正文…"


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


# ==========================================================================
# 极简 CSS 解析（与 tests/test_notes_frontend.py 同风格）
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


def find_rule_in(css_text: str, selector: str, media: str | None = None) -> str | None:
    """选择器组（逗号分隔）匹配：只要求目标选择器是其中一项。"""
    hits = [body for m, sel, body in parse_css(css_text)
            if selector in norm(sel) and (media is None or (m is not None and media in m))]
    return hits[0] if hits else None


def prop(body: str, declaration: str) -> bool:
    return declaration in norm(body)


HARDCODED_COLOR = re.compile(r"#[0-9a-fA-F]{3,8}\b|(?<!-)\brgba?\(|hsla?\(")


@pytest.fixture(scope="module")
def profile_css() -> str:
    return (CSS_DIR / "profile.css").read_text(encoding="utf-8")


# ==========================================================================
# A. Tab 栏：标签 / 激活态 / URL 同步
# ==========================================================================

def test_profile_exports_and_panel(rendered):
    assert "importProfile" not in rendered["errors"], rendered["errors"]
    t = block(rendered, "tabs")
    assert t["exists"] is True, "缺少 .profile-tabs"
    assert t["hasPanel"] is True, "缺少 .profile-panel"


def test_tab_labels_verbatim(rendered):
    assert block(rendered, "tabs")["labels"] == TAB_LABELS


def test_tab_buttons_are_tabs(rendered):
    assert block(rendered, "tabs")["roles"] == ["tab"] * 4


def test_default_tab_is_info_and_marked_active(rendered):
    t = block(rendered, "tabs")
    assert t["activeCount"] == 1, "同时只能有一个激活 Tab"
    assert t["activeLabel"] == TAB_LABELS[0]
    assert t["activeCurrent"] == "true", '激活 Tab 需要 aria-current="true"'
    assert t["inactiveCurrent"] == [None, None, None], "非激活 Tab 不得带 aria-current"


def test_tab_from_url_query(rendered):
    assert block(rendered, "tabs")["urlActiveLabel"] == TAB_LABELS[3], "?tab=history 必须落到「浏览足迹」"


def test_invalid_tab_falls_back_to_info(rendered):
    assert block(rendered, "tabs")["invalidActiveLabel"] == TAB_LABELS[0]


def test_tab_click_pushes_url_and_switches_panel(rendered):
    t = block(rendered, "tabs")
    assert t["clickedUrl"] == "/me?tab=history"
    assert t["clickedMethod"] == "push", "Tab 切换必须 push 历史（可前进后退）"
    assert t["afterClickActive"] == TAB_LABELS[3]
    assert t["afterClickHasClear"] is True, "切换后渲染的是「浏览足迹」面板"
    # harness 在点击前清空足迹数据：空态出现即证明面板确实切到了「浏览足迹」
    assert t["afterClickCards"] == 0
    assert t["afterClickEmptyText"] == EMPTY_HISTORY


# ==========================================================================
# B. 个人信息 Tab
# ==========================================================================

def test_info_card_shows_avatar_username_email_bio_joined(rendered):
    i = block(rendered, "info")
    assert i["hasCard"] is True, "缺少 .profile-card"
    assert i["cardPaper"] is True, "资料卡片必须是纸张容器"
    assert i["avatarText"] == "a", "无 avatar 时用用户名首字色块"
    assert i["avatarClass"] == "profile-avatar"
    assert i["avatarHasImg"] is False
    assert i["username"] == "alice"
    assert i["email"] == "alice@example.com"
    assert i["bio"] == NO_BIO, "空简介显示「还没有填写简介」"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2} \d{2}:\d{2}", i["joined"]), i["joined"]


def test_info_avatar_uses_img_when_url_present(rendered):
    i = block(rendered, "info")
    assert i["avatarImgSrc"] == "/static/uploads/u1-a.png"
    assert i["avatarImgAlt"], "头像图片必须有 alt"
    assert i["bioFilled"] == "一句话简介"


def test_info_edit_form_fields(rendered):
    i = block(rendered, "info")
    assert i["usernamePrefill"] == "alice", "用户名输入需预填当前用户名"
    assert i["bioMaxlength"] == "200", "简介 textarea 需 maxlength=200"
    assert i["hasSaveButton"] is True, f"缺少「{SAVE_BUTTON}」按钮"
    assert i["formLabelCount"] >= 2, "用户名与简介都需要 <label>"


def test_info_password_form_three_inputs(rendered):
    i = block(rendered, "info")
    assert i["passwordInputs"] == ["old_password", "new_password", "confirm_password"]
    assert i["passwordTypes"] == ["password"] * 3
    assert i["hasPasswordButton"] is True, f"缺少「{PASSWORD_BUTTON}」按钮"
    assert "profile-password-error" in i["passwordErrorClass"]


def test_save_profile_puts_and_updates_store_and_header(rendered):
    s = block(rendered, "save")
    assert s["putPath"] == "/api/users/me/profile"
    assert json.loads(s["putBody"]) == {"username": "zoe", "bio": "新的简介"}
    assert s["storeUsername"] == "zoe", "保存后必须写回 store"
    assert s["storeBio"] == "新的简介"
    assert s["storeNotifications"] >= 1, "必须经 store.setUser 触发通知（顶栏随之重绘）"
    assert s["toast"] == SAVED_TOAST
    assert s["cardUsername"] == "zoe", "页面卡片必须同步更新"
    assert s["cardBio"] == "新的简介"
    assert s["headerAvatarText"] == "z", "顶栏头像色块必须即时跟随新用户名"


# ==========================================================================
# C. 修改密码：本地校验复用 auth.js 的 FIELD_MESSAGES
# ==========================================================================

def test_password_local_validation_rejects_weak_before_request(rendered):
    p = block(rendered, "password")
    assert p["weakError"] == PASSWORD_WEAK
    assert p["weakRequests"] == 0, "本地校验不通过时不得发起请求"


def test_password_local_validation_rejects_mismatch_before_request(rendered):
    p = block(rendered, "password")
    assert p["mismatchError"] == PASSWORD_MISMATCH
    assert p["mismatchRequests"] == 0


def test_password_change_submits_clears_inputs_and_toasts(rendered):
    p = block(rendered, "password")
    assert p["putPath"] == "/api/users/me/password"
    assert json.loads(p["putBody"]) == {
        "old_password": "passw0rd", "new_password": "newpass12", "confirm_password": "newpass12",
    }
    assert p["toast"] == PASSWORD_TOAST
    assert p["clearedValues"] == ["", "", ""], "成功后必须清空三个输入框"
    assert p["errorAfterOk"] in ("", None), "成功后不得残留错误文案"


def test_password_server_error_toasts_backend_message(rendered):
    assert block(rendered, "password")["serverToast"] == PASSWORD_WRONG


# ==========================================================================
# D. 我的笔记 Tab：工具条 + 复用 renderNoteGrid
# ==========================================================================

def test_notes_tab_reuses_toolbar_and_grid(rendered):
    n = block(rendered, "notesTab")
    assert n["hasToolbar"] is True, "缺少 .note-toolbar"
    assert n["hasGrid"] is True, "「我的笔记」必须复用 renderNoteGrid（.note-grid）"
    assert n["cardTitles"] == ["我的笔记"]
    assert n["gridQuery"].startswith("/api/notes?")


def test_notes_tab_mini_toolbar_has_status_tag_search_but_no_sort(rendered):
    n = block(rendered, "notesTab")
    assert n["segmentedCount"] == 1, "只保留一组分段控件（状态筛选）；排序固定为更新时间"
    assert n["statusButtons"] == ["全部", "草稿", "私密", "已分享"]
    assert n["sortButtons"] == [], "「我的笔记」不得出现排序切换"
    assert n["tagOptions"][0] == "全部标签"
    assert n["searchType"] == "search"
    assert n["searchPlaceholder"] == SEARCH_PLACEHOLDER


def test_notes_tab_empty_state(rendered):
    n = block(rendered, "notesTab")
    assert n["emptyTitle"] == EMPTY_NOTES
    assert n["emptyAction"] == "写第一篇笔记"


# ==========================================================================
# E. 我的收藏 Tab
# ==========================================================================

def test_favorites_list_available_and_stale_entries(rendered):
    f = block(rendered, "favoritesTab")
    assert f["cards"] == 2
    assert f["titles"] == ["收藏·可用", STALE_TITLE], "失效条目标题位置显示「内容已失效」"
    assert f["staleCount"] == 1
    assert f["staleTitle"] == STALE_TITLE
    assert f["staleAuthor"] == "bob", "失效条目副文案显示作者名"
    assert f["staleRemoveText"] == REMOVE_TEXT
    assert f["unfavoriteCount"] == 1
    assert f["unfavoriteText"] == [UNFAVORITE_TEXT]
    assert f["unfavoriteTargets"] == ["收藏·可用"], "「取消收藏」只挂在可用的收藏条目上"
    assert f["hasPagination"] is True
    assert f["hasGrid"] is True
    assert f["getPath"].startswith("/api/favorites?")


def test_favorites_open_available_probes_then_navigates_to_detail(rendered):
    f = block(rendered, "favoritesTab")
    # 第一次是「打开前探测可读性」，第二次是跳到详情页后详情页自身拉取正文
    assert f["openProbe"] >= 1, "打开前需探测详情可读性（GET /api/notes/21）"
    assert f["openUrl"] == "/notes/21"
    assert f["openToast"] is None, "可读时不应有提示"


def test_favorites_open_blocked_shows_explicit_message(rendered):
    """未解锁的他人分享：详情接口返回 NOT_FOUND 时必须明确提示，而不是静默失败。"""
    f = block(rendered, "favoritesTab")
    assert f["blockedToast"] == BLOCKED_MESSAGE
    assert f["blockedUrl"] is None, "不可读时不得跳转"


def test_favorites_remove_stale_entry(rendered):
    f = block(rendered, "favoritesTab")
    assert f["removePath"] == "/api/favorites/22"
    assert f["cardsAfterRemove"] == 1
    assert f["staleAfterRemove"] == 0


def test_favorites_unfavorite_available_entry(rendered):
    f = block(rendered, "favoritesTab")
    assert f["unfavDeletePath"] == "/api/favorites/21"
    assert f["stopPropagationCalled"] is True, "「取消收藏」必须阻止冒泡"
    assert f["unfavNavUrl"] is None, "点「取消收藏」不得同时打开笔记"
    assert f["cardsAfterUnfav"] == 0


def test_favorites_empty_state(rendered):
    assert block(rendered, "favoritesTab")["emptyTitle"] == EMPTY_FAVORITES


# ==========================================================================
# F. 浏览足迹 Tab
# ==========================================================================

def test_history_list_shows_title_author_and_relative_time(rendered):
    h = block(rendered, "historyTab")
    assert h["cards"] == 2
    assert h["titles"] == ["足迹·可用", STALE_TITLE]
    assert h["authors"] == ["alice", "bob"]
    assert h["staleCount"] == 1
    assert len(h["times"]) == 1, "可用条目展示相对时间；失效占位不展示时间"
    assert re.fullmatch(r"\d+ 分钟前", h["times"][0]), h["times"][0]
    assert h["hasClearButton"] is True
    assert h["hasPagination"] is True
    assert h["getPath"].startswith("/api/history?")


def test_clear_history_confirmation_copy(rendered):
    h = block(rendered, "historyTab")
    assert h["dialogTitle"] == CLEAR_HISTORY
    assert h["dialogMessage"] == CLEAR_MESSAGE
    assert h["confirmText"] == CLEAR_CONFIRM
    assert "btn-danger" in h["confirmClass"]
    assert h["cancelText"] == "取消"
    assert h["deleteAfterCancel"] == 0, "取消后不得清空"


def test_clear_history_confirmed_empties_list(rendered):
    h = block(rendered, "historyTab")
    assert h["clearPath"] == "/api/history"
    assert h["cardsAfterClear"] == 0
    assert h["emptyAfterClear"] == EMPTY_HISTORY
    assert h["toast"] == CLEARED_TOAST


def test_history_remove_stale_entry(rendered):
    h = block(rendered, "historyTab")
    assert h["removePath"] == "/api/history/32"
    assert h["cardsAfterRemove"] == 1


def test_history_empty_state(rendered):
    assert block(rendered, "historyTab")["emptyTitle"] == EMPTY_HISTORY


# ==========================================================================
# G. ui.js staleCard
# ==========================================================================

def test_stale_card_contract(rendered):
    s = block(rendered, "stale")
    assert s["isStale"] is True
    assert s["paper"] is True
    assert s["className"] == "note-card paper is-stale"
    assert s["title"] == STALE_TITLE
    assert s["author"] == "bob"
    assert s["removeText"] == REMOVE_TEXT
    assert s["tabindex"] is None, "失效卡片标题不可点击（无 tabindex）"
    assert s["role"] is None, "失效卡片不声明 role=link"
    assert s["removedCalls"] == 1


# ==========================================================================
# H. ui.js favoriteButton 单元契约
# ==========================================================================

def test_favorite_button_unit_contract(rendered):
    f = block(rendered, "favBtnUnit")
    assert f["offText"] == "收藏"
    assert f["offPressed"] == "false"
    assert "favorite-btn" in f["offClass"]
    assert f["onText"] == "已收藏"
    assert f["onPressed"] == "true"
    assert "is-favorited" in f["onClass"]


# ==========================================================================
# I. DOM 顺序（Tab 可达性近似）与路由守卫
# ==========================================================================

def test_profile_interactive_order(rendered):
    k = block(rendered, "keyboard")
    assert k["tabOrder"] == TAB_LABELS
    assert k["panelOrder"] == [
        "username", "bio", SAVE_BUTTON,
        "old_password", "new_password", "confirm_password", PASSWORD_BUTTON,
    ], k["panelOrder"]


def test_me_route_requires_auth(rendered):
    r = block(rendered, "routing")
    assert r["lastUrl"] == "/login?redirect=%2Fme"
    assert r["method"] == "replace"
    assert r["hasProfile"] is False, "未登录不得渲染个人主页"


# ==========================================================================
# J. profile.css 契约
# ==========================================================================

def test_profile_css_has_no_hardcoded_color(profile_css):
    match = HARDCODED_COLOR.search(strip_comments(profile_css))
    assert match is None, f"profile.css 出现硬编码色值：{match.group(0)!r}（应引用 base.css 令牌）"


def test_profile_tabs_rule(profile_css):
    bar = find_rule(profile_css, ".profile-tabs")
    assert bar is not None, "缺少 .profile-tabs"
    assert prop(bar, "display:flex")
    assert prop(bar, "gap:var(--sp-6)")
    assert prop(bar, "border-bottom:var(--bd)")

    btn = find_rule(profile_css, ".profile-tabs button")
    assert btn is not None, "缺少 .profile-tabs button"
    assert prop(btn, "min-height:44px"), "触摸目标 ≥ 44px"

    active = find_rule(profile_css, ".profile-tabs button.is-active")
    assert active is not None, "缺少 .profile-tabs button.is-active"
    assert prop(active, "border-bottom:3px solid var(--c-primary-hover)")
    assert prop(active, "color:var(--c-text)")


def test_profile_page_container(profile_css):
    page = find_rule(profile_css, ".profile-page")
    assert page is not None, "缺少 .profile-page"
    assert prop(page, "max-width:var(--page-max)")
    assert prop(page, "margin:0 auto")
    assert prop(page, "padding:var(--sp-8) var(--gutter) var(--sp-16)")


def test_profile_card_and_avatar_rules(profile_css):
    card = find_rule(profile_css, ".profile-card")
    assert card is not None, "缺少 .profile-card"
    assert prop(card, 'background-image:url("/static/img/paper.jpg")')
    assert prop(card, "background-color:var(--c-paper-fallback)")
    assert prop(card, "border:var(--bd)")

    avatar = find_rule(profile_css, ".profile-avatar")
    assert avatar is not None, "缺少 .profile-avatar"
    assert prop(avatar, "width:64px")
    assert prop(avatar, "height:64px")
    assert prop(avatar, "border-radius:50%")
    assert prop(avatar, "background:var(--c-accent)")
    assert prop(avatar, "color:var(--c-text)")


def test_profile_form_grid_and_mobile(profile_css):
    form = find_rule(profile_css, ".profile-form")
    assert form is not None, "缺少 .profile-form"
    assert prop(form, "display:grid")
    assert prop(form, "grid-template-columns:1fr 1fr")
    assert prop(form, "gap:var(--sp-4)")

    mobile = find_rule_in(profile_css, ".profile-form", media="max-width: 768px")
    assert mobile is not None, "缺少 ≤768px 的 .profile-form 规则"
    assert prop(mobile, "grid-template-columns:1fr")

    btn = find_rule_in(profile_css, ".profile-form .btn", media="max-width: 768px")
    assert btn is not None, "缺少 ≤768px 的表单按钮整宽规则"
    assert prop(btn, "width:100%")


def test_profile_grid_reuses_note_grid_columns(profile_css):
    grid = find_rule(profile_css, ".profile-grid")
    assert grid is not None, "缺少 .profile-grid"
    assert prop(grid, "display:grid")
    assert prop(grid, "grid-template-columns:repeat(auto-fill, minmax(280px, 1fr))")
    assert prop(grid, "gap:var(--sp-6)")


def test_stale_actions_rule(profile_css):
    actions = find_rule(profile_css, ".stale-actions")
    assert actions is not None, "缺少 .stale-actions"
    assert prop(actions, "display:flex")
    assert prop(actions, "justify-content:flex-end")
