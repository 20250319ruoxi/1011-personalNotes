// markdown.js — 全项目唯一的 Markdown 渲染入口：marked 渲染 + DOMPurify 清洗 + try/catch 降级。
// 约束：编辑器预览、笔记详情页、后续的分享页都必须走 renderMarkdown()；
//       任何模块都不得自行把用户内容写入 innerHTML。
//       不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。

const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'em', 'del',
  'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub',
];

const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'colspan', 'rowspan', 'class'];

let hookInstalled = false;

function installLinkHook() {
  if (hookInstalled || !window.DOMPurify) return;
  window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookInstalled = true;
}

export function renderMarkdown(markdown) {
  const source = markdown == null ? '' : String(markdown);
  try {
    installLinkHook();
    const html = window.marked.parse(source, { gfm: true, breaks: true });
    return window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'object', 'embed', 'link', 'meta'],
      FORBID_ATTR: ['style', 'srcset', 'formaction'],
      ALLOW_DATA_ATTR: false,
    });
  } catch (error) {
    // 渲染或清洗失败时降级为纯文本，绝不让原始 HTML 进入 DOM
    const pre = document.createElement('pre');
    pre.className = 'md-fallback';
    pre.textContent = source;
    return pre.outerHTML;
  }
}

export function markdownToPlainText(markdown, limit = 80) {
  const holder = document.createElement('div');
  holder.innerHTML = renderMarkdown(markdown);
  return (holder.textContent || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}
