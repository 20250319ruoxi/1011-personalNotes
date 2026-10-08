/* render_markdown.mjs — Phase 5 Task 1：Markdown 渲染与清洗模块的执行契约 harness。
 *
 * 本环境（Windows 无浏览器、无 jsdom）无法真实运行 vendor 里的 DOMPurify / marked，
 * 因此这里做三类**可执行**验证：
 *   A. 降级路径安全性：window.DOMPurify / window.marked 均缺失时调用 renderMarkdown，
 *      断言返回的 <pre> 只含转义文本、没有任何可执行结构（安全由构造本身保证）；
 *   B. 清洗器配置断言：用桩件捕获真正传给 DOMPurify.sanitize 的配置与注册的 hook，
 *      并实际调用 hook，验证外链补 rel="noopener noreferrer" 与 target="_blank"；
 *   C. markdownToPlainText 的空白折叠与截断。
 *
 * 用法：node tests/js/render_markdown.mjs  →  stdout 打印一行 JSON
 */
import { installDom } from './dom-shim.mjs';

const dom = installDom();
const { window } = dom;

const errors = {};
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};

const mod = await import('../../static/js/markdown.js')
  .catch((err) => { errors.importMarkdown = String(err.message).split('\n')[0]; return {}; });
const { renderMarkdown, markdownToPlainText } = mod;

/* ---- 6 个注入样例，与 tests/manual/xss-fixtures.md 逐条对应 ---- */
const FIXTURES = [
  "<script>alert('xss')</script>正文",
  '<img src=x onerror="alert(\'xss\')">',
  "[点我](javascript:alert('xss'))",
  '<iframe src="https://example.com"></iframe>',
  '<a href="https://example.com" onclick="alert(1)">外链</a>',
  '<style>body{display:none}</style>正文',
];

/* ==========================================================================
   A. 降级路径：DOMPurify 与 marked 都不可用（模拟 vendor 脚本加载失败）
   ========================================================================== */
const stubsAbsent = {
  dompurify: typeof window.DOMPurify,
  marked: typeof window.marked,
};
const fallback = {};
FIXTURES.forEach((input, i) => {
  fallback[`f${i + 1}`] = safe(`fallback${i + 1}`, () => renderMarkdown(input), null);
});

/* ==========================================================================
   B. 清洗器配置捕获（桩件）
   ========================================================================== */
const captured = { addHookCount: 0, calls: [] };
const anchorNode = {
  tagName: 'A',
  _attrs: { href: 'https://example.com' },
  getAttribute(name) { return this._attrs[name] === undefined ? null : this._attrs[name]; },
  setAttribute(name, value) { this._attrs[name] = String(value); },
};

window.marked = {
  parse(source, options) {
    captured.source = source;
    captured.options = options;
    return `<p>${source}</p>`;
  },
};
window.DOMPurify = {
  addHook(name, fn) {
    captured.addHookCount += 1;
    captured.hookName = name;
    captured.hook = fn;
  },
  sanitize(html, config) {
    captured.calls.push({ source: captured.source, options: captured.options, html, config });
    return `SANITIZED:${html}`;
  },
};

const normalOnce = safe('normalOnce', () => renderMarkdown('# 标题'), null);
const normalTwice = safe('normalTwice', () => renderMarkdown('第二段'), null);

let hookResult = null;
let hookNoHrefUntouched = null;
let hookNonAnchorUntouched = null;
safe('hook', () => {
  if (typeof captured.hook !== 'function') return;
  captured.hook(anchorNode);
  hookResult = { ...anchorNode._attrs };

  const noHref = {
    tagName: 'A', _attrs: {},
    getAttribute() { return null; },
    setAttribute(name, value) { this._attrs[name] = value; },
  };
  captured.hook(noHref);
  hookNoHrefUntouched = Object.keys(noHref._attrs).length === 0;

  const nonAnchor = {
    tagName: 'P', _attrs: {},
    getAttribute() { return 'https://example.com'; },
    setAttribute(name, value) { this._attrs[name] = value; },
  };
  captured.hook(nonAnchor);
  hookNonAnchorUntouched = Object.keys(nonAnchor._attrs).length === 0;
});

/* ==========================================================================
   C. markdownToPlainText
   ========================================================================== */
let plain = null;
safe('plain', () => {
  window.marked = { parse: () => '  你好   世界  ' };
  window.DOMPurify = { addHook() {}, sanitize: (html) => html };
  plain = {
    collapsed: markdownToPlainText('任意输入'),
    truncated: markdownToPlainText('任意输入', 2),
  };
});

process.stdout.write(JSON.stringify({
  errors,
  stubsAbsent,
  fallback,
  captured: {
    addHookCount: captured.addHookCount,
    hookName: captured.hookName,
    hasHook: typeof captured.hook === 'function',
    calls: captured.calls,
  },
  normalOnce,
  normalTwice,
  hookResult,
  hookNoHrefUntouched,
  hookNonAnchorUntouched,
  plain,
}) + '\n');
