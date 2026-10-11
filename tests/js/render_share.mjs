/* render_share.mjs — Phase 6 Task 3/4：分享页、密码锁屏、分享面板与详情页接入渲染契约。
 *
 * 复用 tests/js/dom-shim.mjs 最小 DOM 双端，在 Node 中真实调用 static/js/share.js 的
 * renderSharePage / renderSharePanel、static/js/comments.js 的 renderComments，以及
 * static/js/notes.js 的 renderNoteDetail，把结果序列化成 JSON 供 pytest 断言。
 * fetch 用可控桩件替换，覆盖无密码、需密码、密码错误、限流、已失效、通用错误、
 * 面板开启/复制/更新密码/关闭分享与详情页挂载。
 *
 * 用法：node tests/js/render_share.mjs  →  stdout 打印一行 JSON
 */
import { installDom, serialize } from './dom-shim.mjs';

const dom = installDom();
const { document, window, location, historyCalls } = dom;

const headerEl = document.createElement('header');
headerEl.id = 'app-header';
const appEl = document.createElement('main');
appEl.id = 'app';
const toastRoot = document.createElement('div');
toastRoot.id = 'toast-root';
const dialogRoot = document.createElement('div');
dialogRoot.id = 'dialog-root';
document.body.append(headerEl, appEl, toastRoot, dialogRoot);

/* ---- 下载捕获：记录 Blob 内容与 <a download> 的文件名，避免真的触发浏览器下载 ---- */
const downloads = [];
let lastDownloadName = null;
globalThis.Blob = class {
  constructor(parts, options) {
    this.parts = parts;
    this.type = (options && options.type) || '';
    downloads.push(this);
  }
};
globalThis.URL = { createObjectURL: () => 'blob:test', revokeObjectURL() {} };
const realCreateElement = document.createElement.bind(document);
document.createElement = (tag) => {
  const el = realCreateElement(tag);
  if (String(tag).toLowerCase() === 'a') {
    const realClick = el.click.bind(el);
    el.click = () => { lastDownloadName = el.download; realClick(); };
  }
  return el;
};

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = async () => { await tick(); await tick(); await tick(); await tick(); };

const errors = {};
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};
const safeAsync = async (key, fn, fallback = null) => {
  try { return await fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};

window.marked = { parse: (source) => `MD[${source}]` };
window.DOMPurify = { addHook() {}, sanitize: (html) => `SAN${html}` };

/* clipboard 桩件：可切换「可用 / 被拒绝」两种结果 */
const clipboardWrites = [];
let clipboardMode = 'ok';
Object.defineProperty(globalThis, 'navigator', {
  value: {
    userAgent: 'node-dom-shim',
    clipboard: {
      writeText: async (text) => {
        if (clipboardMode === 'fail') throw new Error('clipboard denied');
        clipboardWrites.push(text);
      },
    },
  },
  configurable: true, writable: true,
});

const CONTENT = '# 正文\n内容';
const SHARE = {
  note: {
    id: 7, title: '分享的笔记', content_md: CONTENT, tags: ['分享', '生活'],
    published_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-02T03:04:05Z',
  },
  author: { username: 'alice', avatar: null },
};

/* ---- 可控 fetch 桩件 ---- */
let shareMode = 'ok';        // ok | locked | disabled | error
let verifyMode = 'ok';       // ok | wrong | rate
let shareFails = false;      // POST /notes/<id>/share 失败
let lastSharePassword = null;
let favoritesMode = 'empty'; // empty | has-note（收藏列表是否已含当前分享笔记）
let favoritePost = 'ok';     // ok | already
const fetchCalls = [];

globalThis.fetch = async (path, opts = {}) => {
  const url = String(path);
  const method = opts.method || 'GET';
  fetchCalls.push({ path: url, method, body: opts.body || null });
  const okBody = (data, message = '操作成功') => ({ json: async () => ({ code: 'OK', message, data }) });
  const errBody = (code, message) => ({ json: async () => ({ code, message, data: null }) });

  if (url.startsWith('/api/auth/me')) return okBody({ user: null, csrf_token: null });

  if (url.startsWith('/api/favorites')) {
    if (method === 'POST') {
      if (favoritePost === 'already') return errBody('ALREADY_FAVORITED', '已收藏过该笔记');
      return okBody(null, '已收藏');
    }
    if (method === 'DELETE') return okBody(null, '已取消收藏');
    const hit = favoritesMode === 'has-note';
    return okBody({
      items: hit ? [{ note: { id: 7 }, available: true }] : [],
      total: hit ? 1 : 0, page: 1, page_size: 50,
    });
  }

  if (url.startsWith('/api/comments/')) {
    if (method === 'DELETE') return okBody(null, '评论已删除');
    return okBody(null);
  }

  if (url.startsWith('/api/share/') && url.endsWith('/verify')) {
    if (verifyMode === 'wrong') return errBody('SHARE_PASSWORD_WRONG', '访问密码错误');
    if (verifyMode === 'rate') return errBody('RATE_LIMITED', '尝试过于频繁，请稍后再试');
    return okBody(SHARE);
  }
  if (url.startsWith('/api/share/') && url.endsWith('/comments')) {
    return okBody({ items: [], total: 0, page: 1, page_size: 10 });
  }
  if (url.startsWith('/api/share/')) {
    if (shareMode === 'locked') return errBody('SHARE_PASSWORD_REQUIRED', '该笔记需要密码访问');
    if (shareMode === 'disabled') return errBody('SHARE_DISABLED', '该分享链接已失效');
    if (shareMode === 'error') return errBody('INTERNAL_ERROR', '服务器开小差了，请稍后重试');
    return okBody(SHARE);
  }

  if (url.startsWith('/api/notes/') && url.endsWith('/share')) {
    if (method === 'DELETE') return okBody(null, '已关闭分享');
    let sent = null;
    try { sent = opts.body ? JSON.parse(opts.body) : null; } catch (_) { sent = null; }
    lastSharePassword = sent && sent.password ? sent.password : null;
    if (shareFails) return errBody('NOT_FOUND', '请求的内容不存在');
    return okBody({ share_url: '/s/tok-123', has_password: !!lastSharePassword },
                  '已开启分享');
  }
  if (url.startsWith('/api/notes/') && url.endsWith('/comments')) {
    return okBody({ items: [], total: 0, page: 1, page_size: 10 });
  }
  if (url.startsWith('/api/notes/')) {
    return okBody({ note: { ...DETAIL_NOTE, ...detailOverride } });
  }
  return okBody(null);
};

const DETAIL_NOTE = {
  id: 11, title: '我的第一篇', status: 'private', tags: ['生活'],
  content_md: CONTENT, created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-02T03:04:05Z', share_token: null, has_share_password: false,
};
let detailOverride = {};

const { store } = await import('../../static/js/store.js');
const { renderMarkdown } = await import('../../static/js/markdown.js');
const shareModule = await import('../../static/js/share.js')
  .catch((err) => ({ __importError: String(err.message).split('\n')[0] }));
if (shareModule.__importError) errors.importShare = shareModule.__importError;
const { renderSharePage, renderSharePanel } = shareModule;

const all = (root, sel) => root.querySelectorAll(sel);
const field = (root, sel) => root.querySelector(sel);
/* 按 DOM 顺序列出可交互元素（Tab 序列的可断言近似） */
const interactive = (root) => all(root, 'textarea, input, button, a').map((el) =>
  `${el.tagName}:${(el.textContent || '').trim()
    || el.getAttribute('placeholder') || el.getAttribute('type') || ''}`);
const btnByText = (root, text) =>
  all(root, 'button').find((b) => b.textContent.trim() === text) || null;
const lastToast = () => (toastRoot.children.length
  ? toastRoot.children[toastRoot.children.length - 1].textContent : null);

const resetShell = () => {
  appEl.innerHTML = '';
  toastRoot.innerHTML = '';
  dialogRoot.innerHTML = '';
  historyCalls.length = 0;
  fetchCalls.length = 0;
  document.title = '个人笔记';
};

const renderShare = async (mode, token = 'tok-123') => {
  resetShell();
  shareMode = mode;
  verifyMode = 'ok';
  location.pathname = `/s/${token}`;
  location.search = '';
  const skeletons = (() => {
    safe('renderSharePage', () => renderSharePage(appEl, { token }));
    return all(appEl, '.skeleton').length;
  })();
  await flush();
  return skeletons;
};

const submitLock = async () => {
  const lockEl = field(appEl, '.share-lock');
  if (!lockEl) throw new Error('锁屏不存在，无法提交');
  const form = lockEl.querySelector('form');
  if (!form) throw new Error('锁屏缺少 form');
  await form.dispatchEvent({ type: 'submit', preventDefault() {} });
};

/* ==========================================================================
   A. 分享页 · 无密码直接阅读
   ========================================================================== */
const sharePage = {};
sharePage.exportIsFunction = typeof renderSharePage === 'function';
sharePage.loadingSkeletons = await renderShare('ok');
await flush();
safe('sharePage', () => {
  const page = field(appEl, '.share-page');
  sharePage.hasPage = !!page;
  const article = field(appEl, '.share-article');
  sharePage.articleClass = article ? article.className : null;
  sharePage.paperClass = article ? article.classList.contains('paper') : false;
  const title = field(appEl, '.share-title');
  sharePage.title = title ? title.textContent : null;
  const meta = field(appEl, '.share-meta');
  sharePage.metaText = meta ? meta.textContent : null;
  sharePage.avatarText = field(appEl, '.share-avatar')
    ? field(appEl, '.share-avatar').textContent : null;
  sharePage.tags = all(appEl, '.tag-chip').map((el) => el.textContent);
  const body = field(appEl, '.share-body');
  sharePage.bodyHtml = body ? body.innerHTML : null;
  sharePage.bodyExpected = renderMarkdown(CONTENT);
  sharePage.bodyHasMarkdownClass = body ? body.classList.contains('markdown-body') : false;
  sharePage.hasActions = !!field(appEl, '#share-actions');
  sharePage.actionsEmpty = field(appEl, '#share-actions')
    ? field(appEl, '#share-actions').children.length === 0 : null;
  const actionsEl = field(appEl, '#share-actions');
  sharePage.actionButtonTexts = actionsEl
    ? all(actionsEl, 'button').map((b) => b.textContent.trim()) : null;
  sharePage.actionButtonPressed = actionsEl
    ? all(actionsEl, 'button').map((b) => b.getAttribute('aria-pressed')) : null;
  sharePage.actionClasses = actionsEl
    ? all(actionsEl, 'button').map((b) => b.className) : null;
  sharePage.hasComments = !!field(appEl, '#share-comments');
  sharePage.titleTag = document.title;
  sharePage.buttonTexts = all(appEl, 'button').map((b) => b.textContent.trim());
  sharePage.linkTexts = all(appEl, 'a').map((a) => a.textContent.trim());
  sharePage.hasLock = !!field(appEl, '.share-lock');
  sharePage.hasSkeletonLeft = all(appEl, '.skeleton').length;
  sharePage.getPaths = fetchCalls.filter((c) => c.method === 'GET').map((c) => c.path);
});

/* ==========================================================================
   A'. 下载 .md：读者把 Markdown 原文存到本地
   ========================================================================== */
const shareDownload = {};
await renderShare('ok');
safe('shareDownloadClick', () => {
  const btn = all(appEl, 'button').find((b) => b.textContent.trim() === '下载 .md');
  if (!btn) throw new Error('分享页操作区缺少「下载 .md」按钮');
  downloads.length = 0;
  lastDownloadName = null;
  btn.click();
});
safe('shareDownloadRead', () => {
  shareDownload.fileName = lastDownloadName;
  shareDownload.blobCount = downloads.length;
  shareDownload.text = downloads.length ? downloads[0].parts[0] : null;
  shareDownload.type = downloads.length ? downloads[0].type : null;
});

/* 空标题回退「无标题」 */
const untitled = {};
await safeAsync('untitled', async () => {
  resetShell();
  shareMode = 'ok';
  location.pathname = '/s/tok-123';
  const original = SHARE.note.title;
  SHARE.note.title = '';
  renderSharePage(appEl, { token: 'tok-123' });
  await flush();
  const t = field(appEl, '.share-title');
  untitled.title = t ? t.textContent : null;
  untitled.tags = all(appEl, '.tag-chip').map((el) => el.textContent);
  SHARE.note.title = original;
});

/* ==========================================================================
   B. 分享页 · 需密码 → 锁屏
   ========================================================================== */
const lock = {};
await renderShare('locked');
await flush();
safe('lock', () => {
  const el = field(appEl, '.share-lock');
  lock.exists = !!el;
  lock.classes = el ? el.className : null;
  lock.paper = el ? el.classList.contains('paper') : false;
  lock.html = el ? serialize(el) : null;
  lock.heading = el && el.querySelector('h2') ? el.querySelector('h2').textContent : null;
  const input = el ? el.querySelector('input') : null;
  lock.inputType = input ? input.type : null;
  lock.inputAutocomplete = input ? input.getAttribute('autocomplete') : null;
  lock.inputMaxlength = input ? input.getAttribute('maxlength') : null;
  lock.labelCount = el ? all(el, 'label').length : 0;
  lock.formExists = el ? !!el.querySelector('form') : false;
  lock.submitTexts = el ? all(el, 'button').map((b) => b.textContent.trim()) : [];
  lock.submitType = el && el.querySelector('button') ? el.querySelector('button').type : null;
  lock.errorText = el && el.querySelector('.field-error')
    ? el.querySelector('.field-error').textContent : null;
  lock.iconAriaHidden = el ? /aria-hidden="true"/.test(serialize(el)) : false;
  lock.hasSvgMarkup = el ? /<svg[\s>]/.test(serialize(el)) : false;
  lock.interactiveOrder = el ? interactive(el) : null;
  lock.hasArticle = !!field(appEl, '.share-article');
  lock.titleTag = document.title;
});

/* ==========================================================================
   C. 锁屏 · 密码错误 → 抖动 + 「访问密码错误」
   ========================================================================== */
const lockWrong = {};
await renderShare('locked');
await flush();
verifyMode = 'wrong';
await safeAsync('lockWrong', async () => { await submitLock(); });
await flush();
safe('lockWrongRead', () => {
  const el = field(appEl, '.share-lock');
  lockWrong.shaking = el ? el.classList.contains('is-shaking') : null;
  lockWrong.errorText = el && el.querySelector('.field-error')
    ? el.querySelector('.field-error').textContent : null;
  const btn = el ? el.querySelector('button') : null;
  lockWrong.buttonDisabled = btn ? !!btn.disabled : null;
  lockWrong.buttonText = btn ? btn.textContent.trim() : null;
  lockWrong.hasArticle = !!field(appEl, '.share-article');
  lockWrong.verifyCalls = fetchCalls.filter((c) => c.path.endsWith('/verify')).length;
});
await tick(400);
lockWrong.shakingAfter300ms = safe('lockWrongAfter', () => {
  const el = field(appEl, '.share-lock');
  return el ? el.classList.contains('is-shaking') : null;
});

/* ==========================================================================
   D. 锁屏 · 限流 → 提示文案 + 按钮禁用
   ========================================================================== */
const lockRate = {};
await renderShare('locked');
await flush();
verifyMode = 'rate';
await safeAsync('lockRate', async () => { await submitLock(); });
await flush();
safe('lockRateRead', () => {
  const el = field(appEl, '.share-lock');
  lockRate.errorText = el && el.querySelector('.field-error')
    ? el.querySelector('.field-error').textContent : null;
  const btn = el ? el.querySelector('button') : null;
  lockRate.buttonDisabled = btn ? !!btn.disabled : null;
  lockRate.buttonAttrDisabled = btn ? btn.hasAttribute('disabled') : null;
  lockRate.hasArticle = !!field(appEl, '.share-article');
});

/* ==========================================================================
   E. 锁屏 · 校验成功 → 直接渲染文章（不重新请求）
   ========================================================================== */
const lockOk = {};
await renderShare('locked');
await flush();
verifyMode = 'ok';
const shareGetsBefore = fetchCalls.filter(
  (c) => c.method === 'GET' && c.path.startsWith('/api/share/') && !c.path.endsWith('/comments')).length;
await safeAsync('lockOk', async () => { await submitLock(); });
await flush();
safe('lockOkRead', () => {
  const title = field(appEl, '.share-title');
  lockOk.title = title ? title.textContent : null;
  lockOk.hasLock = !!field(appEl, '.share-lock');
  lockOk.hasArticle = !!field(appEl, '.share-article');
  lockOk.titleTag = document.title;
  lockOk.shareGetsBefore = shareGetsBefore;
  lockOk.shareGetsAfter = fetchCalls.filter(
    (c) => c.method === 'GET' && c.path.startsWith('/api/share/')
      && !c.path.endsWith('/comments')).length;
  lockOk.verifyCalls = fetchCalls.filter((c) => c.path.endsWith('/verify')).length;
  lockOk.hasComments = !!field(appEl, '#share-comments');
});

/* ==========================================================================
   F. 分享页 · 链接已失效
   ========================================================================== */
const expired = {};
await renderShare('disabled');
await flush();
safe('expired', () => {
  const box = field(appEl, '.empty-state');
  expired.hasEmpty = !!box;
  expired.title = box && box.querySelector('h2') ? box.querySelector('h2').textContent : null;
  const ps = box ? all(box, 'p') : [];
  expired.description = ps.length ? ps[0].textContent : null;
  const btn = btnByText(appEl, '返回首页');
  expired.hasHomeButton = !!btn;
  expired.hasArticle = !!field(appEl, '.share-article');
  expired.hasLock = !!field(appEl, '.share-lock');
  expired.titleTag = document.title;
  if (btn) btn.click();
});
await flush();
expired.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   G. 分享页 · 通用错误显示后端 message
   ========================================================================== */
const generic = {};
await renderShare('error');
await flush();
safe('generic', () => {
  const box = field(appEl, '.empty-state');
  generic.title = box && box.querySelector('h2') ? box.querySelector('h2').textContent : null;
  generic.hasArticle = !!field(appEl, '.share-article');
  generic.hasLock = !!field(appEl, '.share-lock');
});

/* ==========================================================================
   H. 路由注册 · /s/:token 公开可达（未登录不跳登录页）
   ========================================================================== */
const routing = {};
store.setUser(null, null);
location.pathname = '/s/tok-123';
location.search = '';
appEl.innerHTML = '';
historyCalls.length = 0;
fetchCalls.length = 0;
shareMode = 'ok';
const routerModule = await safeAsync('routerImport', async () => import('../../static/js/router.js'));
if (routerModule) {
  await safeAsync('routingNavigate', async () => { await routerModule.navigate('/s/tok-123'); });
  await flush();
}
safe('routing', () => {
  routing.pathname = location.pathname;
  routing.lastUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
  routing.hasPage = !!field(appEl, '.share-page');
  routing.hasArticle = !!field(appEl, '.share-article');
});

/* ==========================================================================
   I. 作者分享面板 SharePanel
   ========================================================================== */
const panelHost = document.createElement('section');
panelHost.id = 'panel-host';

const PANEL_PRIVATE = {
  id: 11, title: '我的第一篇', status: 'private', share_token: null,
  has_share_password: false,
};
const PANEL_PUBLIC = {
  id: 11, title: '我的第一篇', status: 'public', share_token: 'tok-123',
  has_share_password: false,
};
const PANEL_PUBLIC_PW = { ...PANEL_PUBLIC, has_share_password: true };

let onChangeCalls = 0;
const renderPanel = async (note) => {
  resetShell();
  appEl.appendChild(panelHost);
  onChangeCalls = 0;
  lastSharePassword = null;
  shareFails = false;
  clipboardWrites.length = 0;
  clipboardMode = 'ok';
  safe('renderSharePanel', () => renderSharePanel(panelHost, note, {
    onChange: () => { onChangeCalls += 1; },
  }));
  await flush();
};

/* I-1 未开启分享 */
const panelOff = {};
await renderPanel(PANEL_PRIVATE);
safe('panelOff', () => {
  const panel = field(appEl, '.share-panel');
  panelOff.exists = !!panel;
  // 开关已改为显式「保存并发布」按钮：不得再出现复选框
  panelOff.checkboxCount = panel ? panel.querySelectorAll('input[type="checkbox"]').length : null;
  const actions = field(appEl, '.share-actions');
  const enable = actions ? actions.querySelectorAll('button')[0] : null;
  panelOff.actionButton = enable ? enable.textContent.trim() : null;
  const pw = panel ? panel.querySelector('input[type="password"]') : null;
  panelOff.passwordPlaceholder = pw ? pw.getAttribute('placeholder') : null;
  panelOff.passwordMaxlength = pw ? pw.getAttribute('maxlength') : null;
  panelOff.hasLinkRow = !!field(appEl, '.link-row');
  panelOff.readonlyInputs = all(appEl, 'input[readonly]').length;
  panelOff.buttonTexts = all(appEl, 'button').map((b) => b.textContent.trim());
});

/* I-2 已开启：链接行 + 复制 + 更新密码 + 关闭分享 */
const panelOn = {};
await renderPanel(PANEL_PUBLIC);
safe('panelOn', () => {
  const linkInput = field(appEl, 'input[readonly]');
  panelOn.linkValue = linkInput ? linkInput.value : null;
  panelOn.buttonTexts = all(appEl, 'button').map((b) => b.textContent.trim());
  // 已发布时首操作按钮换成「更新密码」
  const actions = field(appEl, '.share-actions');
  const first = actions ? actions.querySelectorAll('button')[0] : null;
  panelOn.actionButton = first ? first.textContent.trim() : null;
  panelOn.checkboxCount = all(appEl, 'input[type="checkbox"]').length;
  panelOn.hintText = field(appEl, '.field-hint') ? field(appEl, '.field-hint').textContent : null;
});

/* I-3 已开启且设密：是否设密提示 */
const panelOnPw = {};
await renderPanel(PANEL_PUBLIC_PW);
safe('panelOnPw', () => {
  panelOnPw.hintText = field(appEl, '.field-hint') ? field(appEl, '.field-hint').textContent : null;
});

/* I-4 点「保存并发布」 → POST 开启分享 */
const panelEnable = {};
await renderPanel(PANEL_PRIVATE);
safe('panelEnableClick', () => {
  const panel = field(appEl, '.share-panel');
  const pw = panel.querySelector('input[type="password"]');
  pw.value = 'secret12';
  btnByText(appEl, '保存并发布').click();
});
await flush();
safe('panelEnableRead', () => {
  const linkInput = field(appEl, 'input[readonly]');
  panelEnable.linkValue = linkInput ? linkInput.value : null;
  panelEnable.buttonTexts = all(appEl, 'button').map((b) => b.textContent.trim());
  const post = fetchCalls.find((c) => c.method === 'POST' && c.path.endsWith('/share'));
  panelEnable.postPath = post ? post.path : null;
  panelEnable.postBody = post ? post.body : null;
  panelEnable.onChangeCalls = onChangeCalls;
  panelEnable.hintText = field(appEl, '.field-hint') ? field(appEl, '.field-hint').textContent : null;
});

/* I-5 复制链接成功 → toast「链接已复制」 */
const panelCopy = {};
await renderPanel(PANEL_PUBLIC);
safe('panelCopyClick', () => { btnByText(appEl, '复制链接').click(); });
await flush();
safe('panelCopyRead', () => {
  panelCopy.toast = lastToast();
  panelCopy.written = clipboardWrites.length ? clipboardWrites[0] : null;
});

/* I-6 复制失败 → 回退提示「请手动复制」 */
const panelCopyFail = {};
await renderPanel(PANEL_PUBLIC);
clipboardMode = 'fail';
safe('panelCopyFailClick', () => { btnByText(appEl, '复制链接').click(); });
await flush();
safe('panelCopyFailRead', () => {
  panelCopyFail.toast = lastToast();
  panelCopyFail.written = clipboardWrites.length;
});

/* I-7 更新密码 → 同一接口 */
const panelUpdate = {};
await renderPanel(PANEL_PUBLIC);
safe('panelUpdateClick', () => {
  const pw = field(appEl, '.share-panel').querySelector('input[type="password"]');
  pw.value = 'newpass9';
  btnByText(appEl, '更新密码').click();
});
await flush();
safe('panelUpdateRead', () => {
  const post = fetchCalls.find((c) => c.method === 'POST' && c.path.endsWith('/share'));
  panelUpdate.postPath = post ? post.path : null;
  panelUpdate.postBody = post ? post.body : null;
  panelUpdate.onChangeCalls = onChangeCalls;
  panelUpdate.linkStillThere = !!field(appEl, 'input[readonly]');
});

/* I-8 关闭分享 → 二次确认 */
const panelClose = {};
await renderPanel(PANEL_PUBLIC);
safe('panelCloseClick', () => { btnByText(appEl, '关闭分享').click(); });
await flush();
safe('panelCloseDialog', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  panelClose.title = dialog ? dialog.querySelector('.dialog-title').textContent : null;
  panelClose.message = dialog ? dialog.querySelector('.dialog-message').textContent : null;
  const confirm = dialog
    ? all(dialog, 'button').find((b) => b.textContent.trim() === '关闭分享') : null;
  panelClose.confirmText = confirm ? confirm.textContent.trim() : null;
  panelClose.confirmClass = confirm ? confirm.className : null;
  const cancel = dialog ? all(dialog, 'button').find((b) => b.textContent.trim() === '取消') : null;
  if (cancel) cancel.click();
});
await flush();
panelClose.deleteAfterCancel = fetchCalls.filter((c) => c.method === 'DELETE').length;

safe('panelCloseReopen', () => { btnByText(appEl, '关闭分享').click(); });
await flush();
safe('panelCloseConfirm', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  const confirm = dialog
    ? all(dialog, 'button').find((b) => b.textContent.trim() === '关闭分享') : null;
  if (confirm) confirm.click();
});
await flush();
safe('panelCloseRead', () => {
  const del = fetchCalls.find((c) => c.method === 'DELETE');
  panelClose.deletePath = del ? del.path : null;
  panelClose.hasLinkRow = !!field(appEl, '.link-row');
  panelClose.onChangeCalls = onChangeCalls;
  const actions = field(appEl, '.share-actions');
  const first = actions ? actions.querySelectorAll('button')[0] : null;
  panelClose.actionButton = first ? first.textContent.trim() : null;
});

/* ==========================================================================
   J. 详情页接入：分享面板 + 评论区
   ========================================================================== */
const detailMount = {};
store.setUser({ id: 1, username: 'alice' }, 'csrf-1');
detailOverride = {};
location.pathname = '/notes/11';
location.search = '';
appEl.innerHTML = '';
toastRoot.innerHTML = '';
dialogRoot.innerHTML = '';
fetchCalls.length = 0;
const notesModule = await safeAsync('notesImport', async () => import('../../static/js/notes.js'));
if (notesModule) {
  await safeAsync('detailRender', async () => { notesModule.renderNoteDetail(appEl, { id: '11' }); });
  await flush();
  await flush();
}
safe('detailMount', () => {
  const shareSlot = field(appEl, '#share-panel-slot');
  detailMount.hasShareSlot = !!shareSlot;
  detailMount.shareSlotPaper = shareSlot ? shareSlot.classList.contains('paper') : null;
  detailMount.hasPanel = !!(shareSlot && shareSlot.querySelector('.share-panel'));
  const commentsSlot = field(appEl, '#comments-slot');
  detailMount.hasCommentsSlot = !!commentsSlot;
  detailMount.hasComments = !!(commentsSlot && commentsSlot.querySelector('.comments'));
  const actions = field(appEl, '.detail-actions');
  detailMount.actionTexts = actions ? all(actions, 'button').map((b) => b.textContent.trim()) : null;
  detailMount.actionClasses = actions ? all(actions, 'button').map((b) => b.className) : null;
  const order = (el) => (el && el.parentNode ? el.parentNode.children.indexOf(el) : -1);
  detailMount.order = {
    body: order(field(appEl, '.detail-body')),
    panel: order(shareSlot),
    comments: order(commentsSlot),
    actions: order(actions),
  };
  detailMount.commentsTitle = field(appEl, '.comments-title')
    ? field(appEl, '.comments-title').textContent : null;
  detailMount.commentsPaths = fetchCalls
    .filter((c) => c.path.includes('/comments')).map((c) => c.path);
});

/* ==========================================================================
   K. 分享页 · 收藏按钮（Phase 7 Task 2）
   ========================================================================== */
const shareFavorite = {};
const flushDeep = async () => {
  for (let i = 0; i < 8; i += 1) await tick();
};
/* 最小 DOM 双端不支持后代选择器，先取 #share-actions 再在其内部找 button */
const favBtn = () => {
  const box = field(appEl, '#share-actions');
  if (!box) return null;
  return all(box, 'button')
    .find((b) => ['收藏', '已收藏'].includes(b.textContent.trim())) || null;
};
const favActions = () => {
  const box = field(appEl, '#share-actions');
  return box ? all(box, 'button') : [];
};

/* K-1 未登录：显示「收藏」，点击跳登录并带回跳目标；且不查询收藏列表 */
store.setUser(null, null);
favoritesMode = 'empty';
await renderShare('ok');
await flushDeep();
safe('shareFavAnonRead', () => {
  const btn = favBtn();
  shareFavorite.anonText = btn ? btn.textContent.trim() : null;
  shareFavorite.anonClass = btn ? btn.className : null;
  shareFavorite.anonFavoriteRequests = fetchCalls
    .filter((c) => c.path.startsWith('/api/favorites')).length;
  historyCalls.length = 0;
  if (btn) btn.click();
});
await flushDeep();
safe('shareFavAnonNav', () => {
  shareFavorite.anonNavUrl = historyCalls.length
    ? historyCalls[historyCalls.length - 1].url : null;
  shareFavorite.anonPostCalls = fetchCalls
    .filter((c) => c.method === 'POST' && c.path.startsWith('/api/favorites')).length;
});

/* K-2 已登录且未收藏：点击 → POST /api/favorites → 「已收藏」+ .is-favorited */
store.setUser({ id: 1, username: 'alice' }, 'csrf-1');
favoritesMode = 'empty';
await renderShare('ok');
await flushDeep();
safe('shareFavLoginRead', () => {
  const btn = favBtn();
  shareFavorite.loginText = btn ? btn.textContent.trim() : null;
  shareFavorite.loginPressed = btn ? btn.getAttribute('aria-pressed') : null;
  shareFavorite.loginFavoriteRequests = fetchCalls
    .filter((c) => c.path.startsWith('/api/favorites?')).length;
  if (btn) btn.click();
});
await flushDeep();
safe('shareFavLoginPosted', () => {
  const btn = favBtn();
  shareFavorite.loginAfterText = btn ? btn.textContent.trim() : null;
  shareFavorite.loginAfterClass = btn ? btn.className : null;
  shareFavorite.loginAfterPressed = btn ? btn.getAttribute('aria-pressed') : null;
  const post = fetchCalls.find((c) => c.method === 'POST' && c.path === '/api/favorites');
  shareFavorite.postPath = post ? post.path : null;
  shareFavorite.postBody = post ? post.body : null;
});

/* K-3 已登录且已在收藏列表：初始即「已收藏」 */
favoritesMode = 'has-note';
await renderShare('ok');
await flushDeep();
favoritesMode = 'empty';
safe('shareFavPreOn', () => {
  const btn = favBtn();
  shareFavorite.preOnText = btn ? btn.textContent.trim() : null;
  shareFavorite.preOnClass = btn ? btn.className : null;
});

/* K-4 已收藏 → 二次确认 → 取消不发请求 → 确认发 DELETE 并回到「收藏」 */
favoritesMode = 'has-note';
await renderShare('ok');
await flushDeep();
safe('shareFavUnfavOpen', () => { const b = favBtn(); if (b) b.click(); });
await flushDeep();
safe('shareFavUnfavDialog', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  shareFavorite.dialogTitle = dialog ? dialog.querySelector('.dialog-title').textContent : null;
  shareFavorite.dialogMessage = dialog ? dialog.querySelector('.dialog-message').textContent : null;
  shareFavorite.confirmText = dialog
    ? (all(dialog, 'button').find((b) => b.textContent.trim() === '取消收藏') || {}).textContent
    : null;
  const cancel = dialog ? all(dialog, 'button').find((b) => b.textContent.trim() === '取消') : null;
  if (cancel) cancel.click();
});
await flushDeep();
shareFavorite.deleteAfterCancel = fetchCalls
  .filter((c) => c.method === 'DELETE' && c.path.startsWith('/api/favorites')).length;

safe('shareFavUnfavReopen', () => { const b = favBtn(); if (b) b.click(); });
await flushDeep();
safe('shareFavUnfavConfirm', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  const confirm = dialog
    ? all(dialog, 'button').find((b) => b.textContent.trim() === '取消收藏') : null;
  if (confirm) confirm.click();
});
await flushDeep();
safe('shareFavUnfavRead', () => {
  const del = fetchCalls
    .find((c) => c.method === 'DELETE' && c.path.startsWith('/api/favorites/'));
  shareFavorite.deletePath = del ? del.path : null;
  const btn = favBtn();
  shareFavorite.textAfterDelete = btn ? btn.textContent.trim() : null;
  shareFavorite.classAfterDelete = btn ? btn.className : null;
  shareFavorite.actionCount = favActions().length;
});

process.stdout.write(JSON.stringify({
  errors, sharePage, shareDownload, untitled, lock, lockWrong, lockRate, lockOk, expired, generic,
  routing, panelOff, panelOn, panelOnPw, panelEnable, panelCopy, panelCopyFail, panelUpdate,
  panelClose, detailMount, shareFavorite,
}) + '\n');
