"""对比度核算工具回归：直接执行手工工具，要求退出码 0。

`tests/manual/check_contrast.py` 是手工清单工具（不进 pytest 收集），这里用一层
薄包装把它纳入自动回归，防止设计令牌被改回不达标的值。
"""

import importlib.util
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tests" / "manual" / "check_contrast.py"
BASE_CSS = ROOT / "static" / "css" / "base.css"


def test_contrast_tool_passes():
    proc = subprocess.run(
        [sys.executable, str(TOOL)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, (
        "对比度核算未通过：\n" + proc.stdout + proc.stderr
    )
    assert "全部达标" in proc.stdout


def _load_tool():
    spec = importlib.util.spec_from_file_location("check_contrast", TOOL)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_focus_ring_indicator_meets_non_text_contrast():
    """`:focus-visible` 的 2px 描边对页面底必须 ≥ 3:1（WCAG 1.4.11 非文本对比度）。

    复用 `check_contrast.py` 的真实亮度算法，直接从 base.css 的 `:focus-visible`
    规则读出描边令牌，避免设计与核算脱节；并要求该令牌已纳入手工工具的
    「交互组件边界」分组，保证手工清单同样覆盖焦点环。
    """
    css = BASE_CSS.read_text(encoding="utf-8")
    match = re.search(
        r":focus-visible\s*\{[^}]*outline:\s*2px\s+solid\s+var\(--([\w-]+)\)", css)
    assert match, "base.css 的 :focus-visible 未声明 `outline: 2px solid var(--token)`"
    token = match.group(1)

    tool = _load_tool()
    tokens = tool.parse_root_tokens(css)
    assert token in tokens, f"焦点环令牌 --{token} 未在 :root 中定义"
    ratio = tool.contrast_ratio(tool.to_rgb(tokens[token]), tool.to_rgb(tokens["c-page"]))
    assert ratio >= 3.0, f"焦点环描边对页面底仅 {ratio:.2f}:1（要求 ≥3.0:1）"

    tool_src = TOOL.read_text(encoding="utf-8")
    assert "焦点环描边" in tool_src, "check_contrast.py 缺少焦点环对应的组件边界组合"
    assert f'"{token}"' in tool_src, f"check_contrast.py 未引用焦点环令牌 {token}"

