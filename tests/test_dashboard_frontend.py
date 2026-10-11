"""工作台（/dashboard）契约：统计卡口径、最近文章、按钮跳转与空态。

回归背景（master 反馈的 bug）：「已发布」卡片统计的是 `status=private` 的条数，
而「已分享」（`status=public`）既不属草稿也不属 private，于是最近文章里明明标着
「已分享」，工作台却显示「已发布 0」。现改为「全部 − 草稿」，本文件锁住该口径。

本环境无浏览器，用 Node DOM harness 真实调用 `dashboard.js::renderDashboard()`，
再用可控的 fetch 桩件断言渲染结果。
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "js" / "render_dashboard.mjs"

RECENT_EMPTY_TEXT = "还没有文章，点右上角「新建文章」写下第一篇吧"
FOOT_TEXT = "用心记录，让知识更有价值。© 个人笔记"


@pytest.fixture(scope="module")
def view() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("未检测到 node，跳过工作台契约测试")
    proc = subprocess.run(
        [node, str(HARNESS)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, f"node 工作台 harness 失败：\n{proc.stdout}\n{proc.stderr}"
    return json.loads(proc.stdout)


def data(view: dict) -> dict:
    assert view["errors"] == {}, view["errors"]
    return view["view"]


def test_dashboard_layout(view):
    v = data(view)
    assert v["title"] == "工作台"
    assert v["headButtons"] == ["新建文章", "我的文章"]
    assert v["statLabels"] == ["草稿", "已发布", "收藏"]
    assert v["recentHeading"] == "最近文章"
    assert v["foot"] == FOOT_TEXT


def test_published_count_includes_shared_notes(view):
    """核心回归：3 篇里 1 篇草稿，则「已发布」= 2（含 1 篇私密 + 1 篇已分享）。"""
    v = data(view)
    assert v["statValues"] == ["1", "2", "2"], v["statValues"]
    assert "已分享" in [row["badge"] for row in v["rows"]], v["rows"]


def test_published_uses_all_minus_draft(view):
    """口径来自两个真实存在且语义明确的请求，而不是靠 private 单点统计。"""
    v = data(view)
    assert "/api/notes?page_size=1" in v["fetchedPaths"], v["fetchedPaths"]
    assert "/api/notes?status=draft&page_size=1" in v["fetchedPaths"], v["fetchedPaths"]
    assert "/api/notes?status=private&page_size=1" not in v["fetchedPaths"], (
        "不得再按 private 单独统计「已发布」，否则会漏掉已分享的笔记"
    )


def test_recent_rows_show_badge_and_untitled_fallback(view):
    v = data(view)
    assert [row["badge"] for row in v["rows"]] == ["已分享", "已发布", "草稿"]
    assert v["rows"][2]["title"] == "无标题", "标题为空时显示「无标题」"


def test_head_buttons_navigate(view):
    v = data(view)
    assert v["afterCreateUrl"] == "/notes/new"
    assert v["afterMineUrl"] == "/notes"


def test_empty_state_and_zero_stats(view):
    v = data(view)
    assert v["emptyText"] == RECENT_EMPTY_TEXT
    assert v["emptyStatValues"] == ["0", "0", "0"]
