/* render_comments.mjs — Phase 6 Task 4：评论区组件 CommentList 渲染契约 harness。
 *
 * 复用 tests/js/dom-shim.mjs 最小 DOM 双端，在 Node 中真实调用 static/js/comments.js 的
 * renderComments，断言头部计数、表单（登录 / 未登录两态）、列表项、删除二次确认、
 * 空态、发表评论与「加载更多」分页。fetch 用可控桩件替换。
 *
 * 用法：node tests/js/render_comments.mjs  →  stdout 打印一行 JSON
 */
import { installDom } from './dom-shim.mjs';

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

const tick = (ms = 25) => new Promise((resolve) => setTimeout(resolve, ms));
const flush = async () => { await tick(); await tick(); await tick(); await tick(); };

const errors = {};
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};
const safeAsync = async (key, fn, fallback = null) => {
  try { return await fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};

/* ---- 可控 fetch 桩件 ---- */
const COMMENT = (id, content, username, canDelete, createdAt) => ({
  id, content, created_at: createdAt || '2020-01-02T03:04:05Z',
  author: { id: id, username, avatar: null }, can_delete: canDelete,
});

const TWO = [
  COMMENT(1, '第一条评论', 'alice', true),
  COMMENT(2, '第二条\n带换行', 'bob', false),
];
const PAGED = Array.from({ length: 12 }, (_, i) =>
  COMMENT(i + 1, `评论${i}`, i % 2 ? 'bob' : 'alice', i % 2 === 0));

let listMode = 'list';       // list | empty | paged | fail
let postFails = false;
let deleteFails = false;
const fetchCalls = [];

globalThis.fetch = async (path, opts = {}) => {
  const url = String(path);
  const method = opts.method || 'GET';
  fetchCalls.push({ path: url, method, body: opts.body || null });
  const okBody = (data, message = '操作成功') => ({ json: async () => ({ code: 'OK', message, data }) });
  const errBody = (code, message) => ({ json: async () => ({ code, message, data: null }) });

  // router 首次 render 的会话恢复：这里返回未登录，避免覆盖用例显式设置的 store 状态
  if (url.startsWith('/api/auth/me')) {
    return okBody({ user: null, csrf_token: null });
  }
  if (url.startsWith('/api/comments/')) {
    if (deleteFails) return errBody('NOT_FOUND', '请求的内容不存在');
    return okBody(null, '评论已删除');
  }
  if (url.includes('/comments')) {
    if (method === 'POST') {
      if (postFails) return errBody('INVALID_PARAM', '参数不合法，请检查后重试');
      const sent = opts.body ? JSON.parse(opts.body) : {};
      return okBody({ comment: COMMENT(99, sent.content, 'alice', true) }, '已发表评论');
    }
    if (listMode === 'fail') return errBody('NOT_FOUND', '请求的内容不存在');
    if (listMode === 'empty') return okBody({ items: [], total: 0, page: 1, page_size: 10 });
    if (listMode === 'paged') {
      const query = new URLSearchParams(url.split('?')[1] || '');
      const page = Number(query.get('page') || 1);
      return okBody({
        items: PAGED.slice((page - 1) * 5, (page - 1) * 5 + 5),
        total: 12, page, page_size: 5,
      });
    }
    return okBody({ items: TWO.map((c) => ({ ...c })), total: 2, page: 1, page_size: 10 });
  }
  return okBody(null);
};

const { store } = await import('../../static/js/store.js');
const commentsModule = await import('../../static/js/comments.js')
  .catch((err) => ({ __importError: String(err.message).split('\n')[0] }));
if (commentsModule.__importError) errors.importComments = commentsModule.__importError;
const { renderComments } = commentsModule;
await import('../../static/js/router.js');   // 供「去登录」跳转使用

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

const OPTIONS = { listPath: '/api/notes/11/comments', createPath: '/api/notes/11/comments', noteOwnerId: 11 };

const renderCommentsHost = async (mode, { loggedIn = true } = {}) => {
  appEl.innerHTML = '';
  toastRoot.innerHTML = '';
  dialogRoot.innerHTML = '';
  historyCalls.length = 0;
  fetchCalls.length = 0;
  listMode = mode;
  postFails = false;
  deleteFails = false;
  store.setUser(loggedIn ? { id: 1, username: 'alice' } : null, loggedIn ? 'csrf-1' : null);
  const host = document.createElement('section');
  host.id = 'comments-host';
  appEl.appendChild(host);
  const call = () => renderComments(host, { ...OPTIONS });
  return { host, call };
};

/* ==========================================================================
   A. 加载中骨架（3 行）
   ========================================================================== */
const loadingState = {};
{
  const { call } = await renderCommentsHost('list');
  safe('commentsRender', () => { call(); });
  loadingState.skeletons = all(appEl, '.skeleton').length;
  loadingState.hasHeading = !!field(appEl, '.comments-title');
  await flush();
  loadingState.skeletonsAfterLoad = all(appEl, '.skeleton').length;
}

/* ==========================================================================
   B. 列表：计数 / 头像 / 作者 / 时间 / 正文 / 删除按钮
   ========================================================================== */
const commentsList = {};
{
  const { host, call } = await renderCommentsHost('list');
  safe('commentsListCall', () => { call(); });
  await flush();
  safe('commentsList', () => {
    commentsList.heading = field(host, '.comments-title')
      ? field(host, '.comments-title').textContent : null;
    commentsList.items = all(host, '.comment').length;
    commentsList.avatars = all(host, '.comment-avatar').map((el) => el.textContent);
    commentsList.authors = all(host, '.comment-author').map((el) => el.textContent);
    commentsList.times = all(host, '.comment-time').map((el) => el.textContent);
    commentsList.bodies = all(host, '.comment-body').map((el) => el.textContent);
    commentsList.deleteButtons = all(host, '.comment-delete').length;
    commentsList.deleteText = all(host, '.comment-delete').map((b) => b.textContent.trim());
    commentsList.emptyText = field(host, '.comment-empty')
      ? field(host, '.comment-empty').textContent : null;
    commentsList.hasMore = !!btnByText(host, '加载更多');
    commentsList.textareaPlaceholder = field(host, 'textarea')
      ? field(host, 'textarea').getAttribute('placeholder') : null;
    commentsList.textareaMaxlength = field(host, 'textarea')
      ? field(host, 'textarea').getAttribute('maxlength') : null;
    commentsList.submitTexts = all(host, 'button')
      .map((b) => b.textContent.trim()).filter((t) => t.includes('评论'));
    commentsList.listPath = fetchCalls.filter((c) => c.method === 'GET').map((c) => c.path);
    commentsList.interactiveOrder = interactive(host);
  });
}

/* ==========================================================================
   C. 空态
   ========================================================================== */
const commentsEmpty = {};
{
  const { host, call } = await renderCommentsHost('empty');
  safe('commentsEmptyCall', () => { call(); });
  await flush();
  safe('commentsEmpty', () => {
    commentsEmpty.heading = field(host, '.comments-title')
      ? field(host, '.comments-title').textContent : null;
    commentsEmpty.emptyText = field(host, '.comment-empty')
      ? field(host, '.comment-empty').textContent : null;
    commentsEmpty.items = all(host, '.comment').length;
    commentsEmpty.hasMore = !!btnByText(host, '加载更多');
    commentsEmpty.hasTextarea = !!field(host, 'textarea');
  });
}

/* ==========================================================================
   D. 未登录：输入区替换为提示 + 去登录
   ========================================================================== */
const commentsLoggedOut = {};
{
  const { host, call } = await renderCommentsHost('list', { loggedIn: false });
  safe('commentsLoggedOutCall', () => { call(); });
  await flush();
  safe('commentsLoggedOut', () => {
    commentsLoggedOut.hint = field(host, '.comment-login-hint')
      ? field(host, '.comment-login-hint').textContent : null;
    commentsLoggedOut.hasTextarea = !!field(host, 'textarea');
    const btn = btnByText(host, '去登录');
    commentsLoggedOut.buttonText = btn ? btn.textContent.trim() : null;
    location.pathname = '/s/tok-123';
    location.search = '';
    historyCalls.length = 0;
    if (btn) btn.click();
  });
  await flush();
  commentsLoggedOut.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
}

/* ==========================================================================
   E. 发表评论：清空输入框 + 追加到列表末尾 + total +1 + toast
   ========================================================================== */
const commentsPost = {};
{
  const { host, call } = await renderCommentsHost('list');
  safe('commentsPostCall', () => { call(); });
  await flush();
  await safeAsync('commentsPostSubmit', async () => {
    const textarea = field(host, 'textarea');
    textarea.value = '我的新评论';
    const form = field(host, 'form');
    await form.dispatchEvent({ type: 'submit', preventDefault() {} });
  });
  await flush();
  safe('commentsPost', () => {
    commentsPost.heading = field(host, '.comments-title')
      ? field(host, '.comments-title').textContent : null;
    commentsPost.items = all(host, '.comment').length;
    commentsPost.lastBody = all(host, '.comment-body').length
      ? all(host, '.comment-body')[all(host, '.comment-body').length - 1].textContent : null;
    commentsPost.textareaValue = field(host, 'textarea') ? field(host, 'textarea').value : null;
    commentsPost.toast = lastToast();
    const post = fetchCalls.find((c) => c.method === 'POST');
    commentsPost.postPath = post ? post.path : null;
    commentsPost.postBody = post ? post.body : null;
    commentsPost.emptyText = field(host, '.comment-empty')
      ? field(host, '.comment-empty').textContent : null;
  });
}

/* ==========================================================================
   F. 删除评论：二次确认文案 → 取消不发请求 → 确认后移除
   ========================================================================== */
const commentsDelete = {};
{
  const { host, call } = await renderCommentsHost('list');
  safe('commentsDeleteCall', () => { call(); });
  await flush();
  safe('commentsDeleteClick', () => { field(host, '.comment-delete').click(); });
  await flush();
  safe('commentsDeleteDialog', () => {
    const dialog = dialogRoot.querySelector('.dialog');
    commentsDelete.title = dialog ? dialog.querySelector('.dialog-title').textContent : null;
    commentsDelete.message = dialog ? dialog.querySelector('.dialog-message').textContent : null;
    const confirm = dialog
      ? all(dialog, 'button').find((b) => b.textContent.trim() === '确定删除') : null;
    commentsDelete.confirmText = confirm ? confirm.textContent.trim() : null;
    commentsDelete.confirmClass = confirm ? confirm.className : null;
    const cancel = dialog ? all(dialog, 'button').find((b) => b.textContent.trim() === '取消') : null;
    if (cancel) cancel.click();
  });
  await flush();
  commentsDelete.deleteAfterCancel = fetchCalls.filter((c) => c.method === 'DELETE').length;

  safe('commentsDeleteReopen', () => { field(host, '.comment-delete').click(); });
  await flush();
  safe('commentsDeleteConfirm', () => {
    const dialog = dialogRoot.querySelector('.dialog');
    const confirm = dialog
      ? all(dialog, 'button').find((b) => b.textContent.trim() === '确定删除') : null;
    if (confirm) confirm.click();
  });
  await flush();
  safe('commentsDeleteRead', () => {
    const del = fetchCalls.find((c) => c.method === 'DELETE');
    commentsDelete.deletePath = del ? del.path : null;
    commentsDelete.items = all(host, '.comment').length;
    commentsDelete.heading = field(host, '.comments-title')
      ? field(host, '.comments-title').textContent : null;
    commentsDelete.authors = all(host, '.comment-author').map((el) => el.textContent);
  });
}

/* ==========================================================================
   G. 分页：total > page_size 时「加载更多」
   ========================================================================== */
const commentsMore = {};
{
  const { host, call } = await renderCommentsHost('paged');
  safe('commentsMoreCall', () => { call(); });
  await flush();
  safe('commentsMoreFirst', () => {
    commentsMore.firstHeading = field(host, '.comments-title')
      ? field(host, '.comments-title').textContent : null;
    commentsMore.firstItems = all(host, '.comment').length;
    commentsMore.firstHasMore = !!btnByText(host, '加载更多');
  });
  safe('commentsMoreClick', () => { btnByText(host, '加载更多').click(); });
  await flush();
  safe('commentsMoreSecond', () => {
    commentsMore.secondItems = all(host, '.comment').length;
    commentsMore.secondHasMore = !!btnByText(host, '加载更多');
    commentsMore.paths = fetchCalls.filter((c) => c.method === 'GET').map((c) => c.path);
  });
  safe('commentsMoreClickTwice', () => {
    const btn = btnByText(host, '加载更多');
    if (btn) btn.click();
  });
  await flush();
  safe('commentsMoreThird', () => {
    commentsMore.thirdItems = all(host, '.comment').length;
    commentsMore.thirdHasMore = !!btnByText(host, '加载更多');
    commentsMore.lastBody = all(host, '.comment-body').length
      ? all(host, '.comment-body')[all(host, '.comment-body').length - 1].textContent : null;
  });
}

/* ==========================================================================
   H. 列表加载失败
   ========================================================================== */
const commentsFail = {};
{
  const { host, call } = await renderCommentsHost('fail');
  safe('commentsFailCall', () => { call(); });
  await flush();
  safe('commentsFail', () => {
    commentsFail.hasComments = !!field(host, '.comments');
    commentsFail.items = all(host, '.comment').length;
    commentsFail.skeletons = all(host, '.skeleton').length;
    commentsFail.errorText = field(host, '.comment-error')
      ? field(host, '.comment-error').textContent : null;
  });
}

process.stdout.write(JSON.stringify({
  errors, loadingState, commentsList, commentsEmpty, commentsLoggedOut,
  commentsPost, commentsDelete, commentsMore, commentsFail,
}) + '\n');
