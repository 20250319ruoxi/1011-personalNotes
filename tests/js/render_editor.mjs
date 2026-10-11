/* render_editor.mjs — Phase 5 Task 3：分栏实时预览编辑器渲染契约 harness。
 *
 * 复用 tests/js/dom-shim.mjs 最小 DOM 双端，在 Node 中真实调用 static/js/editor.js 的
 * renderEditor、store 的脏标记接口、router 的离开拦截与 beforeunload，并把结果序列化为
 * JSON 供 pytest 断言。fetch 用可控桩件替换，覆盖载入、预览、标签、保存草稿、保存并发布、失败分支。
 *
 * 注意：dom-shim 的 querySelector 不支持后代组合选择器，因此一律用逐层查询辅助函数。
 *
 * 用法：node tests/js/render_editor.mjs  →  stdout 打印一行 JSON
 */
import { installDom, serialize } from './dom-shim.mjs';

const dom = installDom();
const { document, window, location, historyCalls, fireWindow } = dom;

const headerEl = document.createElement('header');
headerEl.id = 'app-header';
const appEl = document.createElement('main');
appEl.id = 'app';
const toastRoot = document.createElement('div');
toastRoot.id = 'toast-root';
const dialogRoot = document.createElement('div');
dialogRoot.id = 'dialog-root';
document.body.append(headerEl, appEl, toastRoot, dialogRoot);

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = async () => { await tick(); await tick(); await tick(); };

const errors = {};
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};

/* ---- 渲染桩件：marked / DOMPurify（本环境无法真实运行 vendor 构建） ---- */
window.marked = { parse: (source) => `MD[${source}]` };
window.DOMPurify = { addHook() {}, sanitize: (html) => `SAN${html}` };

const NOTE = {
  id: 7, title: '已有标题', status: 'draft', tags: ['生活'],
  content_md: '## 小标题', created_at: '2020-01-01T00:00:00Z',
  updated_at: '2020-01-02T03:04:05Z', share_token: null, has_share_password: false,
};
const TAGS = ['写作', '写字', '写生', '写实', '写意', '写景', '写春', '写诗'];

let detailMode = 'ok';       // ok | notfound
let saveFails = false;
let savedNote = { ...NOTE };
let loadedNote = { ...NOTE };
const fetchCalls = [];

globalThis.fetch = async (path, opts = {}) => {
  const url = String(path);
  fetchCalls.push({ path: url, method: (opts.method || 'GET'), opts });
  const okBody = (data) => ({ json: async () => ({ code: 'OK', message: '操作成功', data }) });
  const errBody = (code, message) => ({ json: async () => ({ code, message, data: null }) });

  if (url.startsWith('/api/auth/me')) {
    return okBody({ user: { id: 1, username: 'alice' }, csrf_token: 'csrf-1' });
  }
  if (url.startsWith('/api/tags')) return okBody({ items: TAGS.map((name) => ({ name, count: 1 })) });
  if (url.startsWith('/api/uploads/image')) return okBody({ url: '/static/uploads/u1-abc.png' });

  if (opts.method === 'POST' && url === '/api/notes') {
    if (saveFails) return errBody('CONTENT_TOO_LONG', '输入内容超出长度限制');
    savedNote = { ...savedNote, ...(opts.body ? JSON.parse(opts.body) : {}), id: savedNote.id };
    return okBody({ note: savedNote });
  }
  if (opts.method === 'PUT' && url.startsWith('/api/notes/')) {
    if (saveFails) return errBody('CONTENT_TOO_LONG', '输入内容超出长度限制');
    savedNote = { ...savedNote, ...(opts.body ? JSON.parse(opts.body) : {}), id: savedNote.id };
    return okBody({ note: savedNote });
  }
  if (opts.method === 'POST' && url.endsWith('/share')) {
    savedNote = { ...savedNote, status: 'public', share_token: 'tok-edit' };
    return okBody({ share_url: '/s/tok-edit', has_password: false });
  }
  if (url.startsWith('/api/notes/')) {
    if (detailMode === 'notfound') return errBody('NOT_FOUND', '请求的内容不存在');
    return okBody({ note: { ...loadedNote } });
  }
  return okBody(null);
};

const { store } = await import('../../static/js/store.js');
const { renderMarkdown } = await import('../../static/js/markdown.js');
const editorModule = await import('../../static/js/editor.js')
  .catch((err) => ({ __importError: String(err.message).split('\n')[0] }));
if (editorModule.__importError) errors.importEditor = editorModule.__importError;
const { renderEditor } = editorModule;
const { navigate } = await import('../../static/js/router.js');

store.setUser({ id: 1, username: 'alice' }, 'csrf-1');

/* ---- DOM 查询辅助（逐层，避免后代组合选择器） ---- */
const all = (root, sel) => root.querySelectorAll(sel);
const field = (root, sel) => root.querySelector(sel);
const btnByText = (root, text) =>
  all(root, 'button').find((b) => b.textContent.trim() === text) || null;
const sourceTextarea = () => field(field(appEl, '.pane-source'), 'textarea');
const previewPane = () => field(appEl, '.pane-preview');
const tabButtons = () => all(field(appEl, '.editor-tabs'), 'button');
const suggestionButtons = () => all(field(appEl, '.tag-suggestions'), 'button');
const lastToast = () => (toastRoot.children.length
  ? toastRoot.children[toastRoot.children.length - 1].textContent : null);

/* ==========================================================================
   A. store 脏标记接口
   ========================================================================== */
const dirtyApi = {};
safe('dirtyApi', () => {
  dirtyApi.hasSetDirty = typeof store.setDirty === 'function';
  dirtyApi.hasCanLeave = typeof store.canLeave === 'function';
  dirtyApi.rawPageRemoved = !('rawPage' in store);
  dirtyApi.dirtyGuardField = 'dirtyGuard' in store;
  store.dirtyGuard = null;
  store.dirty = false;
  dirtyApi.leavesWithoutGuard = store.canLeave();
  store.dirtyGuard = () => false;
  dirtyApi.blockedByGuard = store.canLeave();
  store.dirtyGuard = null;
});

/* ==========================================================================
   B. navigate 离开拦截
   ========================================================================== */
const navGuard = {};
location.pathname = '/notes/new';
location.search = '';
store.dirty = true;
store.dirtyGuard = () => false;                 // 用户选择「取消」
historyCalls.length = 0;
await safe('navBlocked', () => navigate('/notes'), null);
await flush();
navGuard.blockedCalls = historyCalls.length;
navGuard.dirtyStillTrue = store.dirty;

store.dirty = true;
store.dirtyGuard = () => true;                  // 用户选择「放弃更改」
historyCalls.length = 0;
await safe('navAllowed', () => navigate('/notes'), null);
await flush();
navGuard.allowedLastUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
navGuard.dirtyClearedAfterLeave = store.dirty === false;
store.dirtyGuard = null;
store.setUser({ id: 1, username: 'alice' }, 'csrf-1');

/* ==========================================================================
   C. beforeunload 拦截
   ========================================================================== */
const unload = {};
safe('unload', () => {
  let preventedDirty = 0;
  store.dirty = true;
  fireWindow('beforeunload', { preventDefault() { preventedDirty += 1; } });
  unload.preventedWhenDirty = preventedDirty;

  let preventedClean = 0;
  store.dirty = false;
  fireWindow('beforeunload', { preventDefault() { preventedClean += 1; } });
  unload.preventedWhenClean = preventedClean;
});

/* ==========================================================================
   统一的重置 + 渲染
   ========================================================================== */
const fresh = async (params, getNote) => {
  location.pathname = params && params.id ? `/notes/${params.id}/edit` : '/notes/new';
  location.search = '';
  appEl.innerHTML = '';
  dialogRoot.innerHTML = '';
  toastRoot.innerHTML = '';
  historyCalls.length = 0;
  fetchCalls.length = 0;
  store.dirty = false;
  store.dirtyGuard = null;
  loadedNote = { ...(getNote || NOTE) };
  savedNote = { ...loadedNote };
  detailMode = 'ok';
  saveFails = false;
  const loadingSkeletons = (() => {
    safe('renderEditor', () => renderEditor(appEl, params || {}));
    return all(appEl, '.skeleton').length;
  })();
  await flush();
  return loadingSkeletons;
};

/* ==========================================================================
   D. 新建模式结构
   ========================================================================== */
const newMode = {};
newMode.exportIsFunction = typeof renderEditor === 'function';
newMode.loadingSkeletons = await fresh({});
safe('newMode', () => {
  const wrap = field(appEl, '.editor-wrap');
  newMode.html = wrap ? serialize(wrap) : null;
  const title = field(appEl, '.editor-title');
  newMode.titlePlaceholder = title ? title.getAttribute('placeholder') : null;
  newMode.titleMaxlength = title ? title.getAttribute('maxlength') : null;
  const tagInput = field(appEl, '.tag-input');
  newMode.tagPlaceholder = tagInput ? tagInput.getAttribute('placeholder') : null;
  newMode.buttons = all(appEl, 'button').map((b) => b.textContent.trim()).filter(Boolean);
  newMode.paperClass = !!field(appEl, '.editor-paper');
  newMode.paperHasPaper = field(appEl, '.editor-paper')
    ? field(appEl, '.editor-paper').classList.contains('paper') : false;
  newMode.textarea = !!sourceTextarea();
  newMode.previewClass = previewPane() ? previewPane().className : null;
  newMode.statusSave = field(appEl, '.status-save') ? field(appEl, '.status-save').textContent : null;
  newMode.statusTime = field(appEl, '.status-time') ? field(appEl, '.status-time').textContent : null;
  newMode.statusCount = field(appEl, '.status-count') ? field(appEl, '.status-count').textContent : null;
  newMode.tabs = tabButtons().map((b) => ({
    text: b.textContent.trim(), pressed: b.getAttribute('aria-pressed') }));
  const panes = field(appEl, '.editor-panes');
  newMode.panesClass = panes ? panes.className : null;
  const file = field(appEl, '.editor-file');
  newMode.fileAccept = file ? file.getAttribute('accept') : null;
  newMode.fileType = file ? file.getAttribute('type') : null;
  newMode.interactiveOrder = all(field(appEl, '.editor-wrap'), 'input, button, textarea')
    .map((el) => ({
      tag: el.tagName,
      text: el.textContent.trim(),
      cls: el.className,
      placeholder: el.getAttribute('placeholder') || '',
    }));
}, null);

/* ==========================================================================
   E. 预览：120ms 防抖 + 只经 renderMarkdown
   ========================================================================== */
const preview = {};
await fresh({});
safe('preview', () => {
  const textarea = sourceTextarea();
  const pane = previewPane();
  const before = pane.innerHTML;
  textarea.value = '## 小标题';
  textarea.dispatchEvent({ type: 'input' });
  preview.immediate = pane.innerHTML === before;
});
await tick(70);
safe('previewMid', () => { preview.midway = previewPane().innerHTML; });
await tick(120);
safe('previewAfter', () => {
  preview.after = previewPane().innerHTML;
  preview.expected = renderMarkdown('## 小标题');
  preview.rawNotInjected = preview.after !== '## 小标题';
});

/* ==========================================================================
   F. 底部状态：字数 + 脏标记
   ========================================================================== */
const status = {};
await fresh({});
safe('status', () => {
  const textarea = sourceTextarea();
  status.saveBeforeDirty = field(appEl, '.status-save').textContent;
  textarea.value = '你好 世界';
  textarea.dispatchEvent({ type: 'input' });
  status.count = field(appEl, '.status-count').textContent;
  status.saveAfterDirty = field(appEl, '.status-save').textContent;
  status.storeDirty = store.dirty;
  status.titleHasDirtyDot = field(appEl, '.editor-title').classList.contains('is-dirty');
});

/* ==========================================================================
   G. 标签输入：回车添加 / 去重 / Backspace 删除 / 上限 5
   ========================================================================== */
const tags = {};
await fresh({});
safe('tags', () => {
  const input = field(appEl, '.tag-input');
  const chips = () => all(appEl, '.tag-chip').map((el) => el.textContent);

  input.value = '生活';
  input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
  tags.afterFirst = chips();

  input.value = '生活';
  input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
  tags.afterDuplicate = chips();

  input.value = '';
  input.dispatchEvent({ type: 'keydown', key: 'Backspace', preventDefault() {} });
  tags.afterBackspace = chips();

  ['一', '二', '三', '四', '五', '六'].forEach((name) => {
    input.value = name;
    input.dispatchEvent({ type: 'keydown', key: 'Enter', preventDefault() {} });
  });
  tags.afterSixAttempts = chips();
  tags.maxFive = chips().length;
});

/* ==========================================================================
   H. 标签联想：最多 6 项 + 点击即添加
   ========================================================================== */
const suggest = {};
await fresh({});
safe('suggestInput', () => {
  const input = field(appEl, '.tag-input');
  input.value = '写';
  input.dispatchEvent({ type: 'input' });
});
await flush();
safe('suggestRead', () => {
  const items = suggestionButtons().map((b) => b.textContent.trim());
  suggest.items = items;
  suggest.capped = items.length <= 6;
  const first = suggestionButtons()[0];
  if (first) first.click();
  suggest.chipsAfterClick = all(appEl, '.tag-chip').map((el) => el.textContent);
  suggest.suggestionsCleared = suggestionButtons().length === 0;
});

/* ==========================================================================
   I. 存草稿：POST + toast + 状态 + replaceState
   ========================================================================== */
const saveDraft = {};
await fresh({});
safe('saveDraft', () => {
  field(appEl, '.editor-title').value = '我的标题';
  sourceTextarea().value = '正文内容';
  historyCalls.length = 0;
  btnByText(appEl, '存草稿').click();
});
await flush();
safe('saveDraftRead', () => {
  const post = fetchCalls.find((c) => c.method === 'POST' && c.path === '/api/notes');
  saveDraft.postPath = post ? post.path : null;
  saveDraft.body = post && post.opts.body ? JSON.parse(post.opts.body) : null;
  saveDraft.csrfHeader = post ? post.opts.headers['X-CSRF-Token'] : null;
  saveDraft.toast = lastToast();
  saveDraft.statusSave = field(appEl, '.status-save').textContent;
  saveDraft.locationPath = location.pathname;
  saveDraft.replaceCall = historyCalls.length ? historyCalls[historyCalls.length - 1] : null;
  saveDraft.storeDirty = store.dirty;
});

/* ==========================================================================
   J. 存草稿：已发布笔记免疫降级（「发布」按钮已按需求移除）
   ========================================================================== */
const saveDraftKeeps = {};
await fresh({ id: '7' }, { ...NOTE, status: 'private' });
safe('saveDraftKeepsClick', () => { btnByText(appEl, '存草稿').click(); });
await flush();
safe('saveDraftKeepsRead', () => {
  const put = fetchCalls.find((c) => c.method === 'PUT');
  saveDraftKeeps.path = put ? put.path : null;
  saveDraftKeeps.body = put && put.opts.body ? JSON.parse(put.opts.body) : null;
  saveDraftKeeps.dialog = dialogRoot.querySelector('.dialog') !== null;
  saveDraftKeeps.toast = lastToast();
  saveDraftKeeps.statusSave = field(appEl, '.status-save')
    ? field(appEl, '.status-save').textContent : null;
  saveDraftKeeps.buttons = all(appEl, 'button').map((b) => b.textContent.trim());
});

/* ==========================================================================
   K. 编辑模式载入
   ========================================================================== */
const editMode = {};
editMode.loadingSkeletons = await fresh({ id: '7' });
safe('editMode', () => {
  const title = field(appEl, '.editor-title');
  editMode.title = title ? title.value : null;
  editMode.content = sourceTextarea() ? sourceTextarea().value : null;
  editMode.tags = all(appEl, '.tag-chip').map((el) => el.textContent);
  editMode.statusSave = field(appEl, '.status-save') ? field(appEl, '.status-save').textContent : null;
  editMode.statusTime = field(appEl, '.status-time') ? field(appEl, '.status-time').textContent : null;
});

/* ==========================================================================
   L. 载入失败：NOT_FOUND → 空态
   ========================================================================== */
const notFound = {};
location.pathname = '/notes/999/edit';
location.search = '';
appEl.innerHTML = '';
dialogRoot.innerHTML = '';
store.dirty = false;
detailMode = 'notfound';
safe('notFoundRender', () => renderEditor(appEl, { id: '999' }));
await flush();
safe('notFound', () => {
  const box = field(appEl, '.empty-state');
  notFound.title = box ? box.querySelector('h2').textContent : null;
  const btn = box ? box.querySelector('button') : null;
  notFound.actionText = btn ? btn.textContent : null;
  historyCalls.length = 0;
  if (btn) btn.click();
});
await flush();
notFound.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   M. 保存失败：保留输入 + 状态文案
   ========================================================================== */
const failSave = {};
await fresh({});
saveFails = true;
safe('failSave', () => {
  field(appEl, '.editor-title').value = '不该丢的标题';
  sourceTextarea().value = '不该丢的正文';
  btnByText(appEl, '存草稿').click();
});
await flush();
safe('failSaveRead', () => {
  failSave.titleKept = field(appEl, '.editor-title').value;
  failSave.contentKept = sourceTextarea().value;
  failSave.statusSave = field(appEl, '.status-save').textContent;
  failSave.toast = lastToast();
});
saveFails = false;

/* ==========================================================================
   O. 保存并发布：保存内容 + 开启分享 → 笔记转为只读
   ========================================================================== */
const savePublish = {};
await fresh({ id: '7' }, { ...NOTE, status: 'draft' });
safe('savePublishClick', () => { btnByText(appEl, '保存并发布').click(); });
await flush();
safe('savePublishDialog', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  savePublish.dialogTitle = dialog ? dialog.querySelector('.dialog-title').textContent : null;
  const confirm = dialog
    ? all(dialog, 'button').find((b) => b.textContent.trim() === '保存并发布') : null;
  savePublish.confirmText = confirm ? confirm.textContent.trim() : null;
  const cancel = dialog ? all(dialog, 'button').find((b) => b.textContent.trim() === '取消') : null;
  if (cancel) cancel.click();
});
await flush();
savePublish.mutationsAfterCancel = fetchCalls.filter((c) => c.method !== 'GET').length;

safe('savePublishReopen', () => { btnByText(appEl, '保存并发布').click(); });
await flush();
safe('savePublishConfirm', () => {
  const dialog = dialogRoot.querySelector('.dialog');
  const confirm = dialog
    ? all(dialog, 'button').find((b) => b.textContent.trim() === '保存并发布') : null;
  if (confirm) confirm.click();
});
await flush();
safe('savePublishRead', () => {
  savePublish.methods = fetchCalls
    .filter((c) => c.method !== 'GET')
    .map((c) => `${c.method} ${c.path}`);
  const put = fetchCalls.find((c) => c.method === 'PUT');
  savePublish.putBody = put && put.opts.body ? JSON.parse(put.opts.body) : null;
  const post = fetchCalls.find((c) => c.method === 'POST' && c.path.endsWith('/share'));
  savePublish.sharePath = post ? post.path : null;
  savePublish.hasLockedNotice =
    serialize(field(appEl, '.editor-wrap')).includes('已发布，不可编辑');
  savePublish.buttons = all(appEl, 'button').map((b) => b.textContent.trim());
  const title = field(appEl, '.editor-title');
  savePublish.titleReadOnly = title ? title.readOnly : null;
  savePublish.toast = lastToast();
});

/* ==========================================================================
   P. 已分享（public）笔记 → 编辑器只读，且不再暴露任何写入口
   ========================================================================== */
const lockedNote = {};
await fresh({ id: '7' }, { ...NOTE, status: 'public', share_token: 'tok-edit' });
safe('lockedNote', () => {
  const wrap = field(appEl, '.editor-wrap');
  lockedNote.hasNotice = serialize(wrap).includes('已发布，不可编辑');
  lockedNote.buttons = all(appEl, 'button').map((b) => b.textContent.trim());
  const title = field(appEl, '.editor-title');
  const area = sourceTextarea();
  lockedNote.titleReadOnly = title ? title.readOnly : null;
  lockedNote.contentReadOnly = area ? area.readOnly : null;
  const tagInput = field(appEl, '.tag-input');
  lockedNote.tagDisabled = tagInput ? tagInput.disabled : null;
  lockedNote.hasFileInput = !!field(appEl, '.editor-file');
  lockedNote.statusSave = field(appEl, '.status-save')
    ? field(appEl, '.status-save').textContent : null;
});

/* ==========================================================================
   N. Ctrl/Cmd + S 存草稿并阻止默认行为
   ========================================================================== */
const shortcut = {};
await fresh({});
safe('shortcut', () => {
  field(appEl, '.editor-title').value = '快捷键标题';
  let prevented = 0;
  fetchCalls.length = 0;
  document.dispatchEvent({
    type: 'keydown', key: 's', ctrlKey: true, metaKey: false,
    preventDefault() { prevented += 1; },
  });
  shortcut.prevented = prevented;
});
await flush();
safe('shortcutRead', () => {
  shortcut.postCalled = fetchCalls.some((c) => c.method === 'POST' && c.path === '/api/notes');
  shortcut.toast = lastToast();
});

/* ==========================================================================
   O. 插入图片：上传后于光标处插入 Markdown
   ========================================================================== */
const image = {};
await fresh({});
safe('image', () => {
  const textarea = sourceTextarea();
  textarea.value = '前文后文';
  textarea.selectionStart = 2;
  textarea.selectionEnd = 2;

  const fileInput = field(appEl, '.editor-file');
  fileInput.files = [new Blob(['x'], { type: 'image/png' })];
  fileInput.dispatchEvent({ type: 'change' });
});
await flush();
safe('imageRead', () => {
  const uploadCall = fetchCalls.find((c) => c.path === '/api/uploads/image');
  image.uploadCalled = !!uploadCall;
  image.usedFormData = uploadCall ? uploadCall.opts.body instanceof FormData : null;
  image.value = sourceTextarea().value;
}, null);

/* ==========================================================================
   P. 分栏移动端切换
   ========================================================================== */
const tabsToggle = {};
await fresh({});
safe('tabsToggle', () => {
  const panes = field(appEl, '.editor-panes');
  tabsToggle.defaultClass = panes.className;
  const previewTab = tabButtons().find((b) => b.textContent.trim() === '预览');
  previewTab.click();
  tabsToggle.afterPreview = panes.className;
  tabsToggle.previewPressed = previewTab.getAttribute('aria-pressed');
  const sourceTab = tabButtons().find((b) => b.textContent.trim() === '编辑');
  sourceTab.click();
  tabsToggle.afterSource = panes.className;
  tabsToggle.sourcePressed = sourceTab.getAttribute('aria-pressed');
});

/* ==========================================================================
   Q. 滚动同步（按百分比）
   ========================================================================== */
const scrollSync = {};
safe('scrollSync', () => {
  const panesEl = field(appEl, '.editor-panes');
  const sourcePane = field(panesEl, '.pane-source');
  const pane = field(panesEl, '.pane-preview');
  sourcePane.scrollHeight = 1000; sourcePane.clientHeight = 500;
  pane.scrollHeight = 2000; pane.clientHeight = 1000;
  sourcePane.scrollTop = 250;                    // 50%
  sourcePane.dispatchEvent({ type: 'scroll' });
  scrollSync.previewScrollTop = pane.scrollTop;
  scrollSync.expected = Math.round(0.5 * (2000 - 1000));
});

/* ==========================================================================
   R. 路由优先级：/notes/new 必须命中编辑器，而不是被 /notes/:id 吃掉
   ========================================================================== */
const routing = {};
appEl.innerHTML = '';
dialogRoot.innerHTML = '';
location.pathname = '/';
location.search = '';
store.dirty = false;
store.dirtyGuard = null;
store.setUser({ id: 1, username: 'alice' }, 'csrf-1');
detailMode = 'ok';
loadedNote = { ...NOTE };
await safe('routeNewNav', () => navigate('/notes/new'), null);
await flush();
safe('routeNewRead', () => {
  routing.pathname = location.pathname;
  routing.hasEditor = !!field(appEl, '.editor-wrap');
  routing.hasDetail = !!field(appEl, '.detail-paper');
  routing.hasList = !!field(appEl, '.note-toolbar');
});

process.stdout.write(JSON.stringify({
  errors,
  dirtyApi,
  navGuard,
  unload,
  newMode,
  preview,
  status,
  tags,
  suggest,
  saveDraft,
  saveDraftKeeps,
  editMode,
  notFound,
  failSave,
  shortcut,
  savePublish,
  lockedNote,
  image,
  tabsToggle,
  scrollSync,
  routing,
}) + '\n');
