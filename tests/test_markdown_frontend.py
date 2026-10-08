"""Phase 5 Task 1 · Markdown 渲染与清洗模块契约（Node + 最小 DOM 双端真实执行）。

本环境（Windows 无浏览器、无 jsdom）无法真实运行 vendor 里的 marked / DOMPurify，
因此 `renderMarkdown` 的清洗效果**不能**在本环境直接断言。这里改用三条可执行验证：

1. 降级路径安全性（`window.DOMPurify` / `window.marked` 均缺失时）：输出只含转义文本，
   没有任何标签/属性可承载脚本 —— 安全由构造保证。
2. 清洗器配置断言：桩件捕获真正传入 `DOMPurify.sanitize` 的配置与注册的 hook，
   并实际调用 hook 验证外链补 `rel` / `target`。
3. 单一 HTML 出口不变式：全项目 `static/js/**` 的 `innerHTML` 赋值逐个分类，
   只允许「清空」「renderMarkdown 输出」「静态字面量」三类。

浏览器内的 6 条注入样例见 `tests/manual/xss-fixtures.md`（本环境无浏览器，标注为待人工确认）。
"""

from __future__ import annotations

import json
import re
import shutil
import subprocess
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parents[1]
JS_DIR = ROOT / "static" / "js"
HARNESS = ROOT / "tests" / "js" / "render_markdown.mjs"

FIXTURES = {
    "f1": "<script>alert('xss')</script>正文",
    "f2": '<img src=x onerror="alert(\'xss\')">',
    "f3": "[点我](javascript:alert('xss'))",
    "f4": '<iframe src="https://example.com"></iframe>',
    "f5": '<a href="https://example.com" onclick="alert(1)">外链</a>',
    "f6": "<style>body{display:none}</style>正文",
}


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


def test_markdown_module_exports(rendered):
    assert "importMarkdown" not in rendered["errors"], rendered["errors"]
    assert "fallback1" not in rendered["errors"], rendered["errors"]


# --------------------------------------------------------------------------
# 验证 1 · 降级路径安全（无 DOMPurify / 无 marked）
# --------------------------------------------------------------------------

def test_degraded_path_really_had_no_dependencies(rendered):
    """确认降级分支是被真实触发的：两个 vendor 全局都不存在。"""
    stubs = block(rendered, "stubsAbsent")
    assert stubs["dompurify"] == "undefined"
    assert stubs["marked"] == "undefined"


@pytest.mark.parametrize("key", sorted(FIXTURES))
def test_degraded_path_is_safe_by_construction(rendered, key):
    out = block(rendered, "fallback")[key]
    source = FIXTURES[key]

    assert out.startswith('<pre class="md-fallback">')
    assert out.endswith("</pre>")

    # 结构性证明：整段输出只有 <pre> 自身的开闭标签，其余全是转义后的文本。
    # 没有标签就没有属性，因此不存在任何可执行的 script/iframe/事件属性/javascript:。
    assert re.findall(r"<[^>]*>", out) == ['<pre class="md-fallback">', "</pre>"]

    inner = out[len('<pre class="md-fallback">'):-len("</pre>")]
    assert "<" not in inner, f"降级正文不得出现未转义的 '<'：{inner!r}"
    assert ">" not in inner, f"降级正文不得出现未转义的 '>'：{inner!r}"

    # 危险串只可能以「已转义的纯文本」出现，绝不处于标签/属性语境
    assert not re.search(r"<\s*(script|iframe|img|style|form|object|embed|link|meta)\b", out)
    assert not re.search(r"<\w[^>]*\bon(?:error|click|load)\s*=", out)
    assert '="javascript:' not in out
    assert not re.search(r"""(?:src|href)\s*=\s*["']""", out)

    # 原始载荷必须被 HTML 转义为文本后放进 <pre>
    if "<" in source:
        assert "&lt;" in out
    if ">" in source:
        assert "&gt;" in out


def test_degraded_path_escapes_script_fixture_verbatim(rendered):
    out = block(rendered, "fallback")["f1"]
    assert "&lt;script&gt;alert('xss')&lt;/script&gt;正文" in out


# --------------------------------------------------------------------------
# 验证 2 · 清洗器配置与 link hook（桩件捕获，真实调用）
# --------------------------------------------------------------------------

def test_marked_receives_gfm_and_breaks(rendered):
    calls = block(rendered, "captured")["calls"]
    assert len(calls) == 2, "两次 renderMarkdown 都应经过 DOMPurify.sanitize"
    assert calls[0]["source"] == "# 标题"
    assert calls[0]["options"] == {"gfm": True, "breaks": True}
    assert calls[0]["html"] == "<p># 标题</p>", "marked 的输出必须原样交给 DOMPurify.sanitize"
    assert block(rendered, "normalOnce") == "SANITIZED:<p># 标题</p>"
    assert block(rendered, "normalTwice") == "SANITIZED:<p>第二段</p>"


def test_sanitizer_config_forbids_dangerous_tags(rendered):
    cfg = block(rendered, "captured")["calls"][0]["config"]
    assert cfg is not None
    for tag in ("script", "iframe", "style", "form", "object", "embed", "link", "meta"):
        assert tag in cfg["FORBID_TAGS"], f"FORBID_TAGS 缺少 {tag}"
    for tag in ("p", "a", "img", "pre", "code", "table", "blockquote", "strong", "em"):
        assert tag in cfg["ALLOWED_TAGS"], f"ALLOWED_TAGS 缺少 {tag}"
    # 白名单与禁止清单不得自相矛盾
    for tag in ("script", "iframe", "style", "form", "object", "embed", "link", "meta"):
        assert tag not in cfg["ALLOWED_TAGS"]


def test_sanitizer_config_forbids_dangerous_attrs(rendered):
    cfg = block(rendered, "captured")["calls"][0]["config"]
    for attr in ("style", "srcset", "formaction"):
        assert attr in cfg["FORBID_ATTR"], f"FORBID_ATTR 缺少 {attr}"
    assert cfg["ALLOW_DATA_ATTR"] is False
    for attr in ("onerror", "onclick", "onload"):
        assert attr not in cfg["ALLOWED_ATTR"]


def test_link_hook_registered_once_on_after_sanitize_attributes(rendered):
    c = block(rendered, "captured")
    assert c["hookName"] == "afterSanitizeAttributes"
    assert c["hasHook"] is True
    assert c["addHookCount"] == 1, "hook 是全局的，只能注册一次"


def test_link_hook_adds_rel_and_target_only_for_anchors_with_href(rendered):
    hook = block(rendered, "hookResult")
    assert hook["target"] == "_blank"
    assert hook["rel"] == "noopener noreferrer"
    assert block(rendered, "hookNoHrefUntouched") is True
    assert block(rendered, "hookNonAnchorUntouched") is True


# --------------------------------------------------------------------------
# 验证 3 · markdownToPlainText
# --------------------------------------------------------------------------

def test_markdown_to_plain_text_collapses_and_truncates(rendered):
    plain = block(rendered, "plain")
    # 空白连续段折叠为单个空格并去掉首尾空白
    assert plain["collapsed"] == "你好 世界"
    assert plain["truncated"] == "你好"


# --------------------------------------------------------------------------
# 验证 3 · 单一 HTML 出口不变式（静态源码走查）
# --------------------------------------------------------------------------

INNERHTML_ASSIGN = re.compile(r"\.innerHTML\s*=\s*(.+?);\s*$", re.M)
STATIC_LITERAL = re.compile(r"^(?P<q>['\"`])(?P<body>.*)(?P=q)$", re.S)

# 已人工核对、确认不接受用户输入的既有写入点（Phase 2 遗留）。
# 每个条目都必须给出「为什么不可能承载用户内容」的理由，便于复核。
INNERHTML_ALLOWLIST = {
    ("home.js", "markup"):
        "iconEl() 的 markup 形参只接收同文件 ICONS 里的静态 SVG 字符串字面量，无任何用户输入来源",
}


def classify_innerhtml(rhs: str, filename: str = "") -> str:
    text = rhs.strip()
    if text in ("''", '""', ""):
        return "clear"
    if re.search(r"\brenderMarkdown\s*\(", text):
        return "renderMarkdown"
    m = STATIC_LITERAL.match(text)
    if m and "${" not in m.group("body") and "+" not in m.group("body"):
        return "static-literal"
    if (filename, text) in INNERHTML_ALLOWLIST:
        return "allowlisted-static"
    return "unsafe"


def collect_innerhtml_hits() -> list[tuple[str, int, str, str]]:
    hits = []
    for path in sorted(JS_DIR.glob("*.js")):
        source = path.read_text(encoding="utf-8")
        for m in INNERHTML_ASSIGN.finditer(source):
            line = source.count("\n", 0, m.start()) + 1
            rhs = m.group(1).strip()
            hits.append((path.name, line, rhs, classify_innerhtml(rhs, path.name)))
    return hits


def test_innerhtml_hits_are_classified_and_reported():
    hits = collect_innerhtml_hits()
    report = "\n".join(
        f"  {name}:{line}  ->  {rhs}   [{kind}]" for name, line, rhs, kind in hits
    )
    print("\ninnerHTML 赋值清单（file:line -> rhs [分类]）：\n" + report)

    assert hits, "static/js 下未发现任何 innerHTML 赋值，疑似扫描失效"
    unsafe = [h for h in hits if h[3] == "unsafe"]
    assert not unsafe, "存在未分类（可能注入用户内容）的 innerHTML 赋值：\n" + report


def test_innerhtml_allowlist_entries_still_match_a_real_sink():
    """allowlist 不得腐坏：每条豁免都必须仍然对应源码中的真实写入点。"""
    hits = collect_innerhtml_hits()
    live = {(name, rhs) for name, _line, rhs, _kind in hits}
    stale = sorted(set(INNERHTML_ALLOWLIST) - live)
    assert not stale, f"innerHTML 豁免清单已过期，请复核：{stale}"


def test_no_dangerous_html_sink_api_is_used():
    offenders = []
    for path in sorted(JS_DIR.glob("*.js")):
        source = path.read_text(encoding="utf-8")
        for needle in ("insertAdjacentHTML", "outerHTML =", "document.write("):
            for m in re.finditer(re.escape(needle), source):
                line = source.count("\n", 0, m.start()) + 1
                offenders.append(f"{path.name}:{line} -> {needle}")
    assert not offenders, "使用了高风险 HTML 注入 API：\n" + "\n".join(offenders)
