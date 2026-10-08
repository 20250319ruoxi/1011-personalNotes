#!/usr/bin/env python
"""check_contrast.py — 手工对比度核算工具（不属于 pytest 套件）。

从 ``static/css/base.css`` 的 ``:root`` 块读取真实十六进制令牌值，逐一核算
WCAG 2.1 相对亮度对比度：

* 文本/背景组合要求 >= 4.5:1（WCAG 1.4.3 AA）
* 交互组件边界（非文本）要求 >= 3.0:1（WCAG 1.4.11）

用法::

    .venv/Scripts/python.exe tests/manual/check_contrast.py

全部达标退出码 0；任一不达标或令牌缺失退出码 1，并打印实测表。
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

BASE_CSS = Path(__file__).resolve().parents[2] / "static" / "css" / "base.css"

TEXT_MIN = 4.5
BOUNDARY_MIN = 3.0

# (说明, 前景令牌, 背景令牌)
TEXT_PAIRS: list[tuple[str, str, str]] = [
    ("主按钮静止 文字/底色", "c-text", "c-accent"),
    ("主按钮悬停 文字/底色", "c-text", "c-primary"),
    ("正文 文字/页面底", "c-text", "c-page"),
    ("次文字强化 文字/页面底", "c-text-muted-strong", "c-page"),
    ("链接 文字/页面底", "c-info-strong", "c-page"),
    ("链接悬停 文字/页面底", "c-link-hover", "c-page"),
    ("危险按钮 文字/卡片底", "c-danger-strong", "c-surface"),
    ("危险按钮悬停 白字/危险底", "c-surface", "c-danger-strong"),
    ("字段错误 文字/页面底", "c-danger-strong", "c-page"),
    ("成功 toast 白字/底色", "c-surface", "c-success-strong"),
    ("失败 toast 白字/底色", "c-surface", "c-danger-strong"),
    ("信息 toast 白字/底色", "c-surface", "c-info-strong"),
    ("顶栏激活链接 文字/顶栏底", "c-link-hover", "c-surface"),
]

BOUNDARY_PAIRS: list[tuple[str, str, str]] = [
    ("交互描边/页面底", "c-border-strong", "c-page"),
    ("交互描边/卡片底", "c-border-strong", "c-surface"),
    ("焦点环描边/页面底", "c-border-strong", "c-page"),
]


def parse_root_tokens(css_text: str) -> dict[str, str]:
    """提取 :root 块内的 ``--name: #hex;`` 声明。"""
    match = re.search(r":root\s*\{(.*?)\}", css_text, re.S)
    if not match:
        raise SystemExit("未在 base.css 中找到 :root 块")
    body = match.group(1)
    body = re.sub(r"/\*.*?\*/", "", body, flags=re.S)
    tokens: dict[str, str] = {}
    for name, value in re.findall(r"--([\w-]+)\s*:\s*([^;]+);", body):
        tokens[name] = value.strip()
    return tokens


def to_rgb(value: str) -> tuple[int, int, int]:
    text = value.strip()
    if text.startswith("#"):
        hex_digits = text[1:]
        if len(hex_digits) == 3:
            hex_digits = "".join(ch * 2 for ch in hex_digits)
        if len(hex_digits) != 6:
            raise ValueError(f"无法解析颜色: {value!r}")
        return tuple(int(hex_digits[i:i + 2], 16) for i in (0, 2, 4))  # type: ignore[return-value]
    match = re.match(r"rgba?\(([^)]+)\)", text)
    if match:
        parts = [p.strip() for p in match.group(1).split(",")]
        return tuple(int(float(p)) for p in parts[:3])  # type: ignore[return-value]
    raise ValueError(f"无法解析颜色: {value!r}")


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    def channel(value: int) -> float:
        c = value / 255.0
        return c / 12.92 if c <= 0.03928 else ((c + 0.055) / 1.055) ** 2.4

    r, g, b = (channel(c) for c in rgb)
    return 0.2126 * r + 0.7152 * g + 0.0722 * b


def contrast_ratio(fg: tuple[int, int, int], bg: tuple[int, int, int]) -> float:
    l1, l2 = relative_luminance(fg), relative_luminance(bg)
    lighter, darker = max(l1, l2), min(l1, l2)
    return (lighter + 0.05) / (darker + 0.05)


def resolve(token: str, tokens: dict[str, str]) -> tuple[str, tuple[int, int, int]]:
    if token not in tokens:
        raise SystemExit(f"缺少设计令牌 --{token}（请在 base.css :root 中定义）")
    raw = tokens[token]
    return raw, to_rgb(raw)


def main() -> int:
    tokens = parse_root_tokens(BASE_CSS.read_text(encoding="utf-8"))
    failures: list[str] = []

    def run_group(title: str, pairs: list[tuple[str, str, str]], minimum: float) -> None:
        print(f"\n{title}（要求 ≥ {minimum:.1f}:1）")
        print("-" * 78)
        print(f"{'组合':<30}{'前景':<12}{'背景':<12}{'对比度':>10}  结果")
        for label, fg_token, bg_token in pairs:
            fg_raw, fg_rgb = resolve(fg_token, tokens)
            bg_raw, bg_rgb = resolve(bg_token, tokens)
            ratio = contrast_ratio(fg_rgb, bg_rgb)
            ok = ratio >= minimum
            print(f"{label:<30}{fg_raw:<12}{bg_raw:<12}{ratio:>9.2f}:1  {'PASS' if ok else 'FAIL'}")
            if not ok:
                failures.append(f"{label}: {ratio:.2f}:1 < {minimum:.1f}:1 ({fg_raw} on {bg_raw})")

    run_group("文本/背景对比度", TEXT_PAIRS, TEXT_MIN)
    run_group("交互组件边界对比度", BOUNDARY_PAIRS, BOUNDARY_MIN)

    print()
    if failures:
        print(f"未达标 {len(failures)} 项：")
        for item in failures:
            print(f"  - {item}")
        return 1
    print("全部达标。")
    return 0


if __name__ == "__main__":
    sys.exit(main())
