"""对比度核算工具回归：直接执行手工工具，要求退出码 0。

`tests/manual/check_contrast.py` 是手工清单工具（不进 pytest 收集），这里用一层
薄包装把它纳入自动回归，防止设计令牌被改回不达标的值。
"""

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
TOOL = ROOT / "tests" / "manual" / "check_contrast.py"


def test_contrast_tool_passes():
    proc = subprocess.run(
        [sys.executable, str(TOOL)],
        cwd=ROOT, capture_output=True, text=True, encoding="utf-8",
    )
    assert proc.returncode == 0, (
        "对比度核算未通过：\n" + proc.stdout + proc.stderr
    )
    assert "全部达标" in proc.stdout
