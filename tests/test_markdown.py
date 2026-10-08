from core.markdown import to_plain_text


def test_strips_common_syntax():
    md = "# 标题\n\n这是**加粗**与*斜体*，还有 `代码` 与 [链接](https://example.com)。\n\n- 列表项\n> 引用"
    text = to_plain_text(md, limit=200)
    assert "#" not in text and "*" not in text and "`" not in text
    assert "标题" in text and "加粗" in text and "斜体" in text
    assert "链接" in text and "https://example.com" not in text
    assert "列表项" in text and "引用" in text


def test_drops_code_fence_and_image_url():
    md = "开头\n\n```python\nprint('x')\n```\n\n![图](/static/uploads/a.png)\n\n结尾"
    text = to_plain_text(md, limit=200)
    assert "print" not in text
    assert "/static/uploads/a.png" not in text
    assert text.startswith("开头")
    assert text.endswith("结尾")


def test_truncates_to_limit_and_collapses_blank():
    assert len(to_plain_text("一" * 200, limit=80)) == 80
    assert to_plain_text("a\n\n\n b", limit=80) == "a b"
    assert to_plain_text("", limit=80) == ""
    assert to_plain_text(None, limit=80) == ""


def test_strips_raw_html_tags():
    assert "<script>" not in to_plain_text("<script>alert(1)</script>正文", limit=80)
