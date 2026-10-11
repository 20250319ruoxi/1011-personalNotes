/* render_note_detail.mjs — Phase 5 Task 4：笔记详情页渲染契约 harness。
 *
 * 复用 tests/js/dom-shim.mjs 最小 DOM 双端，在 Node 中真实调用 static/js/notes.js 的
 * renderNoteDetail，断言标题/元信息/正文/操作条、删除二次确认与不存在空态。
 *
 * 用法：node tests/js/render_note_detail.mjs  →  stdout 打印一行 JSON
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

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = async () => { await tick(); await tick(); await tick(); };
/* 收藏按钮的状态查询是「详情 → 收藏列表」两级异步，需要更多轮 tick */
const flushDeep = async () => {
  for (let i = 0; i < 6; i += 1) await tick();
};

const errors = {};
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};

/* ---- 渲染桩件 ---- */
window.marked = { parse: (source) => `MD[${source}]` };
window.DOMPurify = { addHook() {}, sanitize: (html) => `SAN${html}` };

const CONTENT = '# 标题\n\n一些内容';
const NOTE = {
  id: 11, title: '我的第一篇', status: 'private', tags: ['生活', '随笔'],
  content_md: CONTENT, created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-02T03:04:05Z', share_token: 'tok', has_share_password: false,
};

let mode = 'ok';            // ok | notfound
let note = { ...NOTE };
let deleteFails = false;
let favoritesMode = 'empty';      // empty | has-note（收藏列表是否已含当前笔记）
let favoritePost = 'ok';          // ok | already（POST /api/favorites 的返回）
const fetchCalls = [];

globalThis.fetch = async (path, opts = {}) => {
  const url = String(path);
  fetchCalls.push({ path: url, method: opts.method || 'GET', body: opts.body || null });
  const okBody = (data) => ({ json: async () => ({ code: 'OK', message: '操作成功', data }) });
  const errBody = (code, message) => ({ json: async () => ({ code, message, data: null }) });

  if (url.startsWith('/api/auth/me')) {
    return okBody({ user: { id: 1, username: 'alice' }, csrf_token: 'csrf-1' });
  }
  if (url.startsWith('/api/favorites')) {
    if (opts.method === 'POST') {
      if (favoritePost === 'already') return errBody('ALREADY_FAVORITED', '已收藏过该笔记');
      return okBody(null, '已收藏');
    }
    if (opts.method === 'DELETE') return okBody(null, '已取消收藏');
    const hit = favoritesMode === 'has-note';
    return okBody({
      items: hit ? [{ note: { id: 11 }, available: true }] : [],
      total: hit ? 1 : 0, page: 1, page_size: 50,
    });
  }
  if (opts.method === 'DELETE') {
    if (deleteFails) return errBody('NOT_FOUND', '请求的内容不存在');
    return okBody(null);
  }
  if (url.startsWith('/api/notes/')) {
    if (mode === 'notfound') return errBody('NOT_FOUND', '请求的内容不存在');
    return okBody({ note: { ...note } });
  }
  if (url.startsWith('/api/tags')) return okBody({ items: [] });
  return okBody(null);
};

const { store } = await import('../../static/js/store.js');
const { renderMarkdown } = await import('../../static/js/markdown.js');
const notesModule = await import('../../static/js/notes.js')
  .catch((err) => ({ __importError: String(err.message).split('\n')[0] }));
if (notesModule.__importError) errors.importNotes = notesModule.__importError;
const { renderNoteDetail } = notesModule;
await import('../../static/js/router.js');

store.setUser({ id: 1, username: 'alice' }, 'csrf-1');

const all = (root, sel) => root.querySelectorAll(sel);
const field = (root, sel) => root.querySelector(sel);
const btnByText = (root, text) =>
  all(root, 'button').find((b) => b.textContent.trim() === text) || null;
const lastToast = () => (toastRoot.children.length
  ? toastRoot.children[toastRoot.children.length - 1].textContent : null);

const render = async (params, overrides, fav = {}) => {
  location.pathname = `/notes/${params.id}`;
  location.search = '';
  appEl.innerHTML = '';
  dialogRoot.innerHTML = '';
  toastRoot.innerHTML = '';
  historyCalls.length = 0;
  fetchCalls.length = 0;
  mode = 'ok';
  deleteFails = false;
  favoritesMode = fav.mode || 'empty';        // empty | has-note
  favoritePost = fav.post || 'ok';            // ok | already
  note = { ...NOTE, ...(overrides || {}) };
  const loadingSkeletons = (() => {
    safe('renderNoteDetail', () => renderNoteDetail(appEl, params));
    return all(appEl, '.skeleton').length;
  })();
  await flushDeep();
  return loadingSkeletons;
};

/* ==========================================================================
   A. 结构：标题 / 元信息 / 正文 / 操作条
   ========================================================================== */
const detail = {};
detail.exportIsFunction = typeof renderNoteDetail === 'function';
detail.loadingSkeletons = await render({ id: '11' });
safe('detail', () => {
  const article = field(appEl, '.detail-paper');
  detail.html = article ? serialize(article) : null;
  detail.paperClass = article ? article.classList.contains('paper') : false;

  const title = field(appEl, '.detail-title');
  detail.title = title ? title.textContent : null;

  const meta = field(appEl, '.detail-meta');
  detail.metaText = meta ? meta.textContent : null;
  const badge = field(appEl, '.badge');
  detail.badgeText = badge ? badge.textContent : null;
  detail.badgeClass = badge ? badge.className : null;
  detail.tags = all(appEl, '.tag-chip').map((el) => el.textContent);
  detail.lengthText = field(appEl, '.detail-length') ? field(appEl, '.detail-length').textContent : null;
  detail.timeText = field(appEl, '.detail-time') ? field(appEl, '.detail-time').textContent : null;

  const body = field(appEl, '.detail-body');
  detail.bodyHtml = body ? body.innerHTML : null;
  detail.bodyExpected = renderMarkdown(CONTENT);
  detail.bodyHasMarkdownClass = field(appEl, '.detail-body')
    ? field(appEl, '.detail-body').classList.contains('markdown-body') : false;

  const actions = field(appEl, '.detail-actions');
  detail.actionTexts = all(actions, 'button').map((b) => b.textContent.trim());
  detail.actionClasses = all(actions, 'button').map((b) => b.className);
  detail.hasShareButton = all(appEl, 'button').some((b) => b.textContent.includes('分享'));
  detail.hasFavoriteButton = all(appEl, 'button').some((b) => b.textContent.includes('收藏'));
  const fav = all(actions, 'button')
    .find((b) => ['收藏', '已收藏'].includes(b.textContent.trim())) || null;
  detail.favoriteText = fav ? fav.textContent.trim() : null;
  detail.favoriteClass = fav ? fav.className : null;
  detail.favoritePressed = fav ? fav.getAttribute('aria-pressed') : null;
});

/* 空标题 / 空正文 */
await render({ id: '11' }, { title: '', content_md: '' });
const empties = {};
safe('empties', () => {
  empties.title = field(appEl, '.detail-title').textContent;
  const body = field(appEl, '.detail-body');
  empties.bodyText = body ? body.textContent : null;
  empties.bodyHtml = body ? body.innerHTML : null;
});

/* ==========================================================================
   B. 操作：编辑 → /notes/<id>/edit
   ========================================================================== */
const editAction = {};
await render({ id: '11' });
safe('editAction', () => {
  historyCalls.length = 0;
  btnByText(appEl, '编辑').click();
});
await flush();
editAction.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   C. 删除：二次确认文案 → 取消不发请求 → 确认后删除并回列表
   ========================================================================== */
const remove = {};
await render({ id: '11' });
safe('removeOpen', () => { btnByText(appEl, '删除').click(); });
await flush();
safe('removeDialog', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  remove.dialogTitle = dialog ? dialog.querySelector('.dialog-title').textContent : null;
  remove.dialogMessage = dialog ? dialog.querySelector('.dialog-message').textContent : null;
  remove.role = dialog ? dialog.getAttribute('role') : null;
  remove.ariaModal = dialog ? dialog.getAttribute('aria-modal') : null;
  remove.confirmText = dialog
    ? (all(dialog, 'button').find((b) => b.textContent.trim() === '确定删除') || {}).textContent : null;
  remove.confirmClass = dialog
    ? (all(dialog, 'button').find((b) => b.textContent.trim() === '确定删除') || {}).className : null;
  remove.cancelText = dialog
    ? (all(dialog, 'button').find((b) => b.textContent.trim() === '取消') || {}).textContent : null;
  const cancel = dialog ? all(dialog, 'button').find((b) => b.textContent.trim() === '取消') : null;
  if (cancel) cancel.click();
});
await flush();
remove.deleteCallsAfterCancel = fetchCalls.filter((c) => c.method === 'DELETE').length;

safe('removeReopen', () => { btnByText(appEl, '删除').click(); });
await flush();
safe('removeConfirm', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  const confirm = dialog
    ? all(dialog, 'button').find((b) => b.textContent.trim() === '确定删除') : null;
  if (confirm) confirm.click();
});
await flush();
safe('removeConfirmed', () => {
  const del = fetchCalls.find((c) => c.method === 'DELETE');
  remove.deletePath = del ? del.path : null;
  remove.toast = lastToast();
  remove.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
}, null);

/* ==========================================================================
   D. 不存在 → 空态
   ========================================================================== */
const missing = {};
location.pathname = '/notes/404';
location.search = '';
appEl.innerHTML = '';
dialogRoot.innerHTML = '';
mode = 'notfound';
safe('missingRender', () => renderNoteDetail(appEl, { id: '404' }));
await flush();
safe('missing', () => {
  const box = field(appEl, '.empty-state');
  missing.title = box ? box.querySelector('h2').textContent : null;
  const btn = box ? box.querySelector('button') : null;
  missing.actionText = btn ? btn.textContent : null;
  historyCalls.length = 0;
  if (btn) btn.click();
});
await flush();
missing.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   E. 收藏按钮（Phase 7 Task 2）：收藏 / 已收藏 / 取消收藏二次确认
   ========================================================================== */
const favorite = {};
/* 注意：最小 DOM 双端不支持后代选择器（`.detail-actions button`），
   必须先取到容器再在其内部查询标签选择器。 */
const actionsBox = () => field(appEl, '.detail-actions');
const favBtn = () => {
  const box = actionsBox();
  if (!box) return null;
  return all(box, 'button')
    .find((b) => ['收藏', '已收藏'].includes(b.textContent.trim())) || null;
};

/* E-1 初始未收藏 → 文案「收藏」，无 .is-favorited */
await render({ id: '11' });
safe('favoriteInitial', () => {
  const btn = favBtn();
  favorite.initialText = btn ? btn.textContent.trim() : null;
  favorite.initialClass = btn ? btn.className : null;
  favorite.initialPressed = btn ? btn.getAttribute('aria-pressed') : null;
  favorite.actionOrder = all(actionsBox(), 'button').map((b) => b.textContent.trim());
  const get = fetchCalls.find((c) => c.method === 'GET' && c.path.startsWith('/api/favorites'));
  favorite.listGetPath = get ? get.path : null;
});

/* E-2 点击「收藏」→ POST /api/favorites → 文案变「已收藏」+ 主色描边类 */
safe('favoritePost', () => { const b = favBtn(); if (b) b.click(); });
await flushDeep();
safe('favoritePosted', () => {
  const btn = favBtn();
  favorite.afterText = btn ? btn.textContent.trim() : null;
  favorite.afterClass = btn ? btn.className : null;
  favorite.afterPressed = btn ? btn.getAttribute('aria-pressed') : null;
  const post = fetchCalls.find((c) => c.method === 'POST' && c.path === '/api/favorites');
  favorite.postPath = post ? post.path : null;
  favorite.postBody = post ? post.body : null;
});

/* E-3 ALREADY_FAVORITED → 直接置为「已收藏」并 toast 后端 message */
await render({ id: '11' }, null, { post: 'already' });
safe('favoriteAlreadyClick', () => { const b = favBtn(); if (b) b.click(); });
await flushDeep();
safe('favoriteAlreadyRead', () => {
  const btn = favBtn();
  favorite.alreadyText = btn ? btn.textContent.trim() : null;
  favorite.alreadyClass = btn ? btn.className : null;
  favorite.alreadyPressed = btn ? btn.getAttribute('aria-pressed') : null;
  favorite.alreadyToast = lastToast();
});

/* E-4 已收藏态初始化：收藏列表含该笔记 → 直接显示「已收藏」 */
await render({ id: '11' }, null, { mode: 'has-note' });
safe('favoritePreOn', () => {
  const btn = favBtn();
  favorite.preOnText = btn ? btn.textContent.trim() : null;
  favorite.preOnClass = btn ? btn.className : null;
  favorite.preOnPressed = btn ? btn.getAttribute('aria-pressed') : null;
});

/* E-5 点击「已收藏」→ 二次确认文案 → 取消不发请求 */
await render({ id: '11' }, null, { mode: 'has-note' });
safe('favoriteUnfavOpen', () => { const b = favBtn(); if (b) b.click(); });
await flushDeep();
safe('favoriteUnfavDialog', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  favorite.dialogTitle = dialog ? dialog.querySelector('.dialog-title').textContent : null;
  favorite.dialogMessage = dialog ? dialog.querySelector('.dialog-message').textContent : null;
  favorite.dialogRole = dialog ? dialog.getAttribute('role') : null;
  favorite.dialogAriaModal = dialog ? dialog.getAttribute('aria-modal') : null;
  favorite.confirmText = dialog
    ? (all(dialog, 'button').find((b) => b.textContent.trim() === '取消收藏') || {}).textContent
    : null;
  const cancel = dialog ? all(dialog, 'button').find((b) => b.textContent.trim() === '取消') : null;
  if (cancel) cancel.click();
});
await flushDeep();
favorite.deleteAfterCancel = fetchCalls
  .filter((c) => c.method === 'DELETE' && c.path.startsWith('/api/favorites')).length;
favorite.textAfterCancel = safe('favoriteAfterCancel', () => {
  const b = favBtn(); return b ? b.textContent.trim() : null;
});

/* E-6 确认取消收藏 → DELETE /api/favorites/11 → 回到「收藏」 */
safe('favoriteUnfavReopen', () => { const b = favBtn(); if (b) b.click(); });
await flushDeep();
safe('favoriteUnfavConfirm', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  const confirm = dialog
    ? all(dialog, 'button').find((b) => b.textContent.trim() === '取消收藏') : null;
  if (confirm) confirm.click();
});
await flushDeep();
safe('favoriteUnfavRead', () => {
  const del = fetchCalls
    .find((c) => c.method === 'DELETE' && c.path.startsWith('/api/favorites/'));
  favorite.deletePath = del ? del.path : null;
  const b = favBtn();
  favorite.textAfterDelete = b ? b.textContent.trim() : null;
  favorite.classAfterDelete = b ? b.className : null;
  favorite.pressedAfterDelete = b ? b.getAttribute('aria-pressed') : null;
});

/* ==========================================================================
   H. 下载 .md：文件名以 .md 结尾，内容为 Markdown 原文
   ========================================================================== */
const detailDownload = {};
await render({ id: '11' });
safe('detailDownloadClick', () => {
  const btn = all(appEl, 'button').find((b) => b.textContent.trim() === '下载 .md');
  if (!btn) throw new Error('操作条缺少「下载 .md」按钮');
  downloads.length = 0;
  lastDownloadName = null;
  btn.click();
});
safe('detailDownloadRead', () => {
  detailDownload.fileName = lastDownloadName;
  detailDownload.blobCount = downloads.length;
  detailDownload.text = downloads.length ? downloads[0].parts[0] : null;
  detailDownload.type = downloads.length ? downloads[0].type : null;
});

/* 文件名规则（纯函数，直接调用 ui.js 的 markdownFilename） */
const { markdownFilename } = await import('../../static/js/ui.js');
const filenames = {
  plain: safe('fnPlain', () => markdownFilename('我的第一篇', 'x')),
  illegal: safe('fnIllegal', () => markdownFilename('a/b:c*d?e"f<g>h|i', 'x')),
  blank: safe('fnBlank', () => markdownFilename('', '笔记-11')),
  spacesOnly: safe('fnSpaces', () => markdownFilename('   ', '笔记-11')),
  trailingDot: safe('fnDot', () => markdownFilename('标题...', 'x')),
  longLength: safe('fnLong', () => markdownFilename('长'.repeat(80), 'x').length),
};

process.stdout.write(JSON.stringify({
  errors,
  detail,
  detailDownload,
  filenames,
  empties,
  editAction,
  remove,
  missing,
  favorite,
}) + '\n');
