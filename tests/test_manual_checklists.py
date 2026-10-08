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

def phase5_section() -> str:
    text = VISUAL.read_text(encoding="utf-8")
    assert "## Phase 5 · 笔记前端" in text, "视觉清单缺少 Phase 5 段落"
    return text.split("## Phase 5 · 笔记前端", 1)[1]


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
