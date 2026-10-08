"""Phase 5 手工验收清单的契约：确认 14 行视觉清单与 6 条 XSS 结论「已填写」，且没有把
本环境无法验证的浏览器行为谎报为通过。

本环境（Windows 无浏览器、无 jsdom）无法截图、无法运行 DOMPurify。因此两个手工清单文件
必须逐行给出结论：要么标注「待人工确认（本环境无浏览器）」，要么引用具体可执行的自动断言
（`test_...`）。本测试强制这一约定，避免出现空行或没有依据的「通过」。
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
MANUAL = ROOT / "tests" / "manual"
XSS = MANUAL / "xss-fixtures.md"
VISUAL = MANUAL / "visual-checklist.md"

PENDING = "待人工确认（本环境无浏览器）"

XSS_PAYLOADS = [
    "<script>alert('xss')</script>正文",
    '<img src=x onerror="alert(\'xss\')">',
    "[点我](javascript:alert('xss'))",
    '<iframe src="https://example.com"></iframe>',
    '<a href="https://example.com" onclick="alert(1)">外链</a>',
    "<style>body{display:none}</style>正文",
]


def table_rows(text: str, columns: int, numbered: bool = True) -> list[list[str]]:
    rows = []
    for line in text.splitlines():
        stripped = line.strip()
        if not stripped.startswith("|"):
            continue
        cells = [c.strip() for c in stripped.strip("|").split("|")]
        if len(cells) != columns:
            continue
        if numbered and not cells[0].isdigit():
            continue
        rows.append(cells)
    return rows


# ==========================================================================
# xss-fixtures.md
# ==========================================================================

def test_xss_fixtures_file_exists():
    assert XSS.exists(), "缺少 tests/manual/xss-fixtures.md"


def test_xss_fixtures_has_six_numbered_rows():
    text = XSS.read_text(encoding="utf-8")
    rows = table_rows(text, columns=5)
    assert [int(r[0]) for r in rows] == [1, 2, 3, 4, 5, 6], [r[0] for r in rows]


def test_xss_fixtures_payloads_verbatim():
    text = XSS.read_text(encoding="utf-8")
    for payload in XSS_PAYLOADS:
        assert payload in text, f"样例缺失：{payload}"


def test_xss_fixtures_every_row_is_marked_pending():
    text = XSS.read_text(encoding="utf-8")
    rows = table_rows(text, columns=5)
    for row in rows:
        assert PENDING in row[4], f"第 {row[0]} 行未按要求标注：{row[4]!r}"
    assert "没有可用浏览器" in text
    assert "没有 jsdom" in text


def test_xss_fixtures_documents_the_three_executable_verifications():
    text = XSS.read_text(encoding="utf-8")
    assert "tests/test_markdown_frontend.py" in text
    assert "降级路径安全" in text
    assert "清洗器配置断言" in text
    assert "单一 HTML 出口不变式" in text


# ==========================================================================
# visual-checklist.md · Phase 5
# ==========================================================================

def _section(header: str) -> str:
    """取某个二级标题下的正文，遇到下一个二级标题即停止。

    后续阶段会把新章节追加到文件末尾；若不截断，早期阶段的解析器会把新章节的行
    也算进来（Phase 6 的表格同样是 6 列且从 1 开始编号），导致行数断言失真。
    """
    text = VISUAL.read_text(encoding="utf-8")
    assert header in text, f"视觉清单缺少 {header} 段落"
    rest = text.split(header, 1)[1]
    return re.split(r"\n## ", rest, maxsplit=1)[0]


def phase5_section() -> str:
    return _section("## Phase 5 · 笔记前端")


def phase6_section() -> str:
    return _section("## Phase 6 · 分享与评论")


def defined_test_names() -> set[str]:
    names: set[str] = set()
    for path in (ROOT / "tests").glob("test_*.py"):
        names.update(re.findall(r"^def (test_\w+)", path.read_text(encoding="utf-8"), re.M))
    return names


def referenced_test_names(text: str) -> set[str]:
    """行内反引号里引用的 `test_xxx` 名字（不含 `tests/xxx.py` 这类路径）。"""
    return set(re.findall(r"`(test_\w+)`", text))


def test_visual_checklist_has_phase5_section():
    assert VISUAL.exists(), "缺少 tests/manual/visual-checklist.md"
    assert phase5_section().strip(), "Phase 5 段落为空"


def test_visual_checklist_has_fourteen_rows():
    rows = table_rows(phase5_section(), columns=6)
    assert [int(r[0]) for r in rows] == list(range(1, 15)), [r[0] for r in rows]


def test_visual_checklist_rows_are_either_pending_or_backed_by_a_test():
    rows = table_rows(phase5_section(), columns=6)
    for row in rows:
        result = row[5]
        assert result, f"第 {row[0]} 行「结果」为空"
        assert PENDING in result or "test_" in result, (
            f"第 {row[0]} 行既未标注待人工确认，也未引用任何自动断言：{result!r}"
        )


def test_visual_checklist_declares_environment_gap():
    text = phase5_section()
    assert "没有可用浏览器" in text or "无浏览器" in text


def test_visual_checklist_appends_xss_conclusions():
    text = phase5_section()
    assert "xss-fixtures.md" in text
    assert "保存后刷新" in text, "缺少「保存后刷新详情页仍被清洗」结论项"
    assert re.search(r"6\s*(条|行)", text), "缺少 XSS 6 条结论汇总"


# ==========================================================================
# visual-checklist.md · Phase 6
# ==========================================================================

def test_visual_checklist_has_phase6_section():
    assert phase6_section().strip(), "Phase 6 段落为空"


def test_visual_checklist_phase6_has_thirteen_rows():
    rows = table_rows(phase6_section(), columns=6)
    assert [int(r[0]) for r in rows] == list(range(1, 14)), [r[0] for r in rows]


def test_visual_checklist_phase6_rows_are_pending_or_backed_by_a_test():
    for row in table_rows(phase6_section(), columns=6):
        result = row[5]
        assert result, f"Phase 6 第 {row[0]} 行「结果」为空"
        assert PENDING in result or "test_" in result, (
            f"Phase 6 第 {row[0]} 行既未标注待人工确认，也未引用任何自动断言：{result!r}"
        )


def test_visual_checklist_phase6_references_only_existing_tests():
    """Phase 6 行内引用的每个 `test_xxx` 都必须真的存在于 tests/ 下。"""
    available = defined_test_names()
    assert available, "未在 tests/ 下发现任何测试函数，疑似扫描失效"
    referenced = referenced_test_names(phase6_section())
    assert referenced, "Phase 6 段落未引用任何自动断言"
    missing = sorted(referenced - available)
    assert not missing, f"Phase 6 清单引用了不存在的测试：{missing}"


def test_visual_checklist_phase6_declares_environment_gap():
    text = phase6_section()
    assert "没有可用浏览器" in text or "无浏览器" in text


def test_visual_checklist_phase6_covers_the_thirteen_required_states():
    text = phase6_section()
    for keyword in ("待人工确认（本环境无浏览器）", "该分享链接已失效", "访问密码错误",
                    "尝试过于频繁，请稍后再试", "留空表示不需要密码", "链接已复制",
                    "关闭分享", "还没有评论，来说点什么吧", "登录后可发表评论",
                    "确定要删除这条评论吗？删除后无法恢复。"):
        assert keyword in text, f"Phase 6 清单缺少关键检查点：{keyword}"


# ==========================================================================
# visual-checklist.md · Phase 7
# ==========================================================================

def phase7_section() -> str:
    return _section("## Phase 7 · 收藏、足迹与个人主页")


def test_visual_checklist_has_phase7_section():
    assert phase7_section().strip(), "Phase 7 段落为空"


def test_visual_checklist_phase7_has_twelve_rows():
    rows = table_rows(phase7_section(), columns=6)
    assert [int(r[0]) for r in rows] == list(range(1, 13)), [r[0] for r in rows]


def test_visual_checklist_phase7_rows_are_pending_or_backed_by_a_test():
    for row in table_rows(phase7_section(), columns=6):
        result = row[5]
        assert result, f"Phase 7 第 {row[0]} 行「结果」为空"
        assert PENDING in result or "test_" in result, (
            f"Phase 7 第 {row[0]} 行既未标注待人工确认，也未引用任何自动断言：{result!r}"
        )


def test_visual_checklist_phase7_references_only_existing_tests():
    """Phase 7 行内引用的每个 `test_xxx` 都必须真的存在于 tests/ 下。"""
    available = defined_test_names()
    assert available, "未在 tests/ 下发现任何测试函数，疑似扫描失效"
    referenced = referenced_test_names(phase7_section())
    assert referenced, "Phase 7 段落未引用任何自动断言"
    missing = sorted(referenced - available)
    assert not missing, f"Phase 7 清单引用了不存在的测试：{missing}"


def test_visual_checklist_phase7_declares_environment_gap():
    text = phase7_section()
    assert "没有可用浏览器" in text or "无浏览器" in text


def test_visual_checklist_phase7_covers_the_twelve_required_states():
    text = phase7_section()
    for keyword in ("待人工确认（本环境无浏览器）", "个人信息", "我的笔记", "我的收藏", "浏览足迹",
                    "还没有笔记，去写下第一篇吧", "还没有收藏", "还没有浏览记录",
                    "还没有填写简介", "内容已失效", "移除", "取消收藏",
                    "保存资料", "修改密码", "密码强度文案",
                    "确定要清空全部浏览记录吗？此操作不可恢复。",
                    "/login?redirect=/s/<token>", "已收藏"):
        assert keyword in text, f"Phase 7 清单缺少关键检查点：{keyword}"
