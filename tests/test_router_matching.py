"""路由匹配契约：`/` 必须落在主页视图，不能掉进「页面不存在」。

回归背景（master 反馈的 bug）：`match()` 会把请求路径去掉尾部斜杠后再 `split('/')`，
而注册的模式未经同样归一化处理。`'/'` 模式 split 后是 `['', '']` 两段，归一化后的
`location.pathname === '/'` split 出来只有 `['']` 一段，长度不等被跳过，于是首页
永远匹配不到路由，落到 `notFoundRoute`，表现为「首页显示页面不存在、点返回首页没反应」。

本文件用 Node DOM harness 真实调用 `router.js::navigate()`，逐条路径断言视图归属。
"""
from __future__ import annotations

import json
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
HARNESS = ROOT / "tests" / "js" / "render_router.mjs"


@pytest.fixture(scope="module")
def routing() -> dict:
    node = shutil.which("node")
    if not node:
        pytest.skip("未检测到 node，跳过路由匹配契约测试")
    proc = subprocess.run(
        [node, str(HARNESS)], cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, f"node 路由 harness 失败：\n{proc.stdout}\n{proc.stderr}"
    return json.loads(proc.stdout)


def case(routing: dict, key: str) -> dict:
    value = routing["cases"].get(key)
    assert value, f"{key} 用例未产出结果：{routing['errors']}"
    return value


def test_harness_reports_no_errors(routing):
    assert routing["errors"] == {}, routing["errors"]


def test_root_path_renders_home_view(routing):
    """核心回归：未登录访问 `/` 必须渲染主页，而不是「页面不存在」。"""
    root = case(routing, "root")
    assert root["hasHero"], f"`/` 未渲染主页 Hero。实际 HTML：{root['htmlHead']}"
    assert not root["hasFallbackView"], f"`/` 掉进了「页面不存在」视图：{root['htmlHead']}"


def test_root_path_stays_on_root(routing):
    root = case(routing, "root")
    assert root["finalPath"] == "/"
    assert root["historyUrls"] == ["/"], f"`/` 期间发生了额外跳转：{root['historyUrls']}"


def test_about_path_still_renders_about_view(routing):
    """不得为了修首页而破坏其它固定路径的匹配。"""
    about = case(routing, "about")
    assert about["hasAbout"], f"`/about` 未渲染关于页：{about['htmlHead']}"
    assert not about["hasFallbackView"], f"`/about` 掉进了「页面不存在」视图：{about['htmlHead']}"


def test_unknown_path_renders_fallback_view(routing):
    """真正未注册的路径仍要落到「页面不存在」。"""
    missing = case(routing, "missing")
    assert missing["hasFallbackView"], f"未注册路径没有落到兜底视图：{missing['htmlHead']}"
    assert not missing["hasHero"]


def test_protected_route_redirects_to_login_when_logged_out(routing):
    """登录守卫不受本次修改影响。"""
    guard = case(routing, "guard")
    assert guard["finalPath"].startswith("/login?redirect="), guard["finalPath"]
    assert len(guard["historyUrls"]) == 2, f"守卫未产生二次跳转：{guard['historyUrls']}"
    assert guard["historyUrls"][-1].startswith("/login?redirect="), guard["historyUrls"]


def test_trailing_slash_path_is_normalized(routing):
    """带尾斜杠的路径必须归一化到同一视图（两侧同时去尾斜杠后才比较）。"""
    trailing = case(routing, "aboutTrailing")
    assert trailing["hasAbout"], f"`/about/` 未渲染关于页：{trailing['htmlHead']}"
    assert not trailing["hasFallbackView"], f"`/about/` 掉进了兜底视图：{trailing['htmlHead']}"
