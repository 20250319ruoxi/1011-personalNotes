import re

CODE_FENCE_RE = re.compile(r"```.*?```", re.S)
INLINE_CODE_RE = re.compile(r"`[^`]*`")
IMAGE_RE = re.compile(r"!\[[^\]]*\]\([^)]*\)")
LINK_RE = re.compile(r"\[([^\]]*)\]\([^)]*\)")
HEADING_RE = re.compile(r"^\s{0,3}#{1,6}\s*", re.M)
QUOTE_RE = re.compile(r"^\s{0,3}>\s?", re.M)
LIST_RE = re.compile(r"^\s{0,3}([-*+]|\d+\.)\s+", re.M)
EMPHASIS_RE = re.compile(r"(\*\*|__|\*|_|~~)")
HTML_TAG_RE = re.compile(r"<[^>]+>")
BLANK_RE = re.compile(r"\s+")


def to_plain_text(md, limit=80):
    """剥离常见 Markdown 语法与原始 HTML 标签，供列表摘要使用。

    注意：本函数只用于生成纯文本摘要，不承担安全清洗职责；
    面向浏览器的渲染与清洗在 static/js/markdown.js 中由 DOMPurify 完成。
    """
    if not md:
        return ""
    text = CODE_FENCE_RE.sub(" ", md)
    text = INLINE_CODE_RE.sub(" ", text)
    text = IMAGE_RE.sub(" ", text)
    text = LINK_RE.sub(r"\1", text)
    text = HEADING_RE.sub("", text)
    text = QUOTE_RE.sub("", text)
    text = LIST_RE.sub("", text)
    text = EMPHASIS_RE.sub("", text)
    text = HTML_TAG_RE.sub(" ", text)
    text = BLANK_RE.sub(" ", text).strip()
    return text[:limit]
