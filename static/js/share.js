// share.js — 公开分享页与作者分享面板（Phase 6）。
// 约束：用户内容只能经 markdown.js 的 renderMarkdown() 进入 DOM；
//       作者名、标题、评论等内容一律 textContent 写入；
//       不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。
import { api } from './api.js';
import { navigate } from './router.js';
import { renderMarkdown } from './markdown.js';
import { confirmDialog, formatDate, skeleton, toast } from './ui.js';

const SITE_TITLE = '个人笔记';
const UNTITLED = '无标题';

const LOCK_TITLE = '该笔记需要密码访问';
const LOCK_BUTTON = '确认访问';
const LOCK_SUBMIT_TEXT = '校验中…';
const EXPIRED_TITLE = '该分享链接已失效';
const EXPIRED_DESC = '作者可能已关闭分享，或链接不正确。';
const HOME_BUTTON = '返回首页';

function setDocumentTitle(noteTitle) {
  document.title = noteTitle ? `「${noteTitle}」- ${SITE_TITLE}` : SITE_TITLE;
}

/** 空态：h2 标题 + 可选说明 + 可选行动按钮（复用 base.css 的 .empty-state 样式）。 */
function stateBlock({ titleText, description = '', actionText = '', onAction = null }) {
  const box = document.createElement('div');
  box.className = 'empty-state';

  const heading = document.createElement('h2');
  heading.textContent = titleText;
  box.appendChild(heading);

  if (description) {
    const para = document.createElement('p');
    para.className = 'empty-desc';
    para.textContent = description;
    box.appendChild(para);
  }

  if (actionText) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-primary';
    btn.textContent = actionText;
    if (typeof onAction === 'function') btn.addEventListener('click', onAction);
    box.appendChild(btn);
  }
  return box;
}

/* ==========================================================================
   公开分享页：文章 / 锁屏 / 失效 / 通用错误 四态
   ========================================================================== */

export async function renderSharePage(root, params = {}) {
  const token = params.token;
  setDocumentTitle('');

  const page = document.createElement('section');
  page.className = 'share-page';
  root.appendChild(page);
  page.appendChild(skeleton(3));

  let data;
  try {
    data = await api.get(`/api/share/${encodeURIComponent(token)}`, { silent: true });
  } catch (err) {
    page.textContent = '';
    if (err && err.code === 'SHARE_PASSWORD_REQUIRED') {
      renderShareLock(page, token);
      return;
    }
    renderFailure(page, err && err.code, err && err.message);
    return;
  }

  page.textContent = '';
  renderShareArticle(page, data, token);
}

function renderFailure(page, code, message) {
  if (code === 'SHARE_DISABLED') {
    page.appendChild(stateBlock({
      titleText: EXPIRED_TITLE,
      description: EXPIRED_DESC,
      actionText: HOME_BUTTON,
      onAction: () => navigate('/'),
    }));
    return;
  }
  page.appendChild(stateBlock({
    titleText: message || '服务器开小差了，请稍后重试',
    actionText: HOME_BUTTON,
    onAction: () => navigate('/'),
  }));
}

function renderShareArticle(page, data, token) {
  const note = (data && data.note) || {};
  const author = (data && data.author) || {};
  const displayTitle = note.title || UNTITLED;
  setDocumentTitle(displayTitle);

  const article = document.createElement('article');
  article.className = 'share-article paper';

  const title = document.createElement('h1');
  title.className = 'share-title';
  title.textContent = displayTitle;
  article.appendChild(title);

  const meta = document.createElement('div');
  meta.className = 'share-meta';

  const avatar = document.createElement('span');
  avatar.className = 'share-avatar';
  avatar.setAttribute('aria-hidden', 'true');
  avatar.textContent = String(author.username || '').trim().charAt(0) || '?';
  meta.appendChild(avatar);

  const name = document.createElement('span');
  name.className = 'share-author';
  name.textContent = author.username || '已注销用户';
  meta.appendChild(name);

  const time = document.createElement('time');
  time.className = 'share-time';
  time.textContent = `更新于 ${formatDate(note.updated_at)}`;
  meta.appendChild(time);

  const tags = Array.isArray(note.tags) ? note.tags : [];
  if (tags.length) {
    const list = document.createElement('ul');
    list.className = 'note-tags';
    tags.forEach((tagName) => {
      const item = document.createElement('li');
      item.className = 'tag-chip';
      item.textContent = tagName;
      list.appendChild(item);
    });
    meta.appendChild(list);
  }
  article.appendChild(meta);

  const body = document.createElement('div');
  body.className = 'share-body markdown-body';
  if (note.content_md) body.innerHTML = renderMarkdown(note.content_md);
  else body.textContent = '（空白笔记）';
  article.appendChild(body);

  // 收藏按钮由 Phase 7 插入此容器
  const actions = document.createElement('div');
  actions.className = 'share-actions';
  actions.id = 'share-actions';
  article.appendChild(actions);

  // 评论区容器：由 comments.js 渲染（两页共用同一组件）
  const comments = document.createElement('section');
  comments.className = 'share-comments';
  comments.id = 'share-comments';
  article.appendChild(comments);

  page.appendChild(article);
  mountComments(token);
}

async function mountComments(token) {
  const host = document.getElementById('share-comments');
  if (!host) return;
  try {
    const { renderComments } = await import('./comments.js');
    renderComments(host, {
      listPath: `/api/share/${token}/comments`,
      createPath: `/api/share/${token}/comments`,
    });
  } catch (_) { /* 评论区加载失败不影响正文阅读 */ }
}

/* ==========================================================================
   密码锁屏：默认 / 校验中 / 密码错误（抖动）/ 限流
   ========================================================================== */

function renderShareLock(page, token) {
  const lock = document.createElement('div');
  lock.className = 'share-lock paper';

  const icon = document.createElement('span');
  icon.className = 'share-lock-icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2"></rect><path d="M8 10.5V8a4 4 0 0 1 8 0v2.5"></path></svg>';

  const heading = document.createElement('h2');
  heading.className = 'share-lock-title';
  heading.textContent = LOCK_TITLE;

  const form = document.createElement('form');
  form.className = 'share-lock-form';
  form.setAttribute('novalidate', '');

  const fieldWrap = document.createElement('div');
  fieldWrap.className = 'field';

  const label = document.createElement('label');
  label.setAttribute('for', 'share-lock-password');
  label.textContent = '访问密码';

  const input = document.createElement('input');
  input.id = 'share-lock-password';
  input.type = 'password';
  input.setAttribute('autocomplete', 'current-password');
  input.setAttribute('maxlength', '64');

  const error = document.createElement('p');
  error.className = 'field-error';
  error.setAttribute('role', 'alert');

  fieldWrap.append(label, input, error);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary btn-block';
  const submitText = document.createElement('span');
  submitText.className = 'btn-text';
  submitText.textContent = LOCK_BUTTON;
  submit.appendChild(submitText);

  form.append(fieldWrap, submit);
  lock.append(icon, heading, form);
  page.appendChild(lock);

  let rateLimited = false;

  const setLoading = (on) => {
    submit.disabled = on;
    if (on) submit.setAttribute('disabled', '');
    else submit.removeAttribute('disabled');
    submit.classList.toggle('is-loading', on);
    submitText.textContent = on ? LOCK_SUBMIT_TEXT : LOCK_BUTTON;
  };

  const shake = () => {
    lock.classList.add('is-shaking');
    window.setTimeout(() => lock.classList.remove('is-shaking'), 300);
  };

  form.addEventListener('submit', async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    if (rateLimited) return;
    error.textContent = '';
    setLoading(true);
    try {
      const data = await api.post(
        `/api/share/${encodeURIComponent(token)}/verify`,
        { password: input.value },
        { silent: true },
      );
      // 校验成功：直接用返回的数据渲染文章，不重新请求
      page.textContent = '';
      renderShareArticle(page, data, token);
    } catch (err) {
      error.textContent = (err && err.message) || '';
      setLoading(false);
      if (err && err.code === 'RATE_LIMITED') {
        rateLimited = true;
        submit.disabled = true;
        submit.setAttribute('disabled', '');
      } else {
        shake();
      }
    }
  });
}

/* ==========================================================================
   作者分享面板 SharePanel（详情页）
   - 开关「开启分享」：打开即 POST /api/notes/<id>/share（可带密码）
   - 密码输入始终可见（未开启时用于首次设置密码，已开启时配合「更新密码」修改）
   - 已开启：只读链接框 + 「复制链接」+ 「更新密码」+ 危险操作「关闭分享」
   - 链接由服务端返回的 share_token 拼出绝对地址，前端不生成、不猜测 token
   ========================================================================== */

const SWITCH_LABEL = '开启分享';
const PASSWORD_PLACEHOLDER = '留空表示不需要密码';
const COPY_BUTTON = '复制链接';
const UPDATE_BUTTON = '更新密码';
const CLOSE_BUTTON = '关闭分享';
const COPIED_TOAST = '链接已复制';
const MANUAL_COPY_TOAST = '请手动复制';
const CLOSE_MESSAGE = '关闭后该链接将立即失效，已收藏或浏览过的人将无法再打开。';

export function renderSharePanel(container, note, { onChange } = {}) {
  if (!container) return;
  const data = note || {};
  const state = {
    enabled: data.status === 'public',
    token: data.share_token || null,
    hasPassword: !!data.has_share_password,
  };

  container.textContent = '';
  const panel = document.createElement('div');
  panel.className = 'share-panel';

  const toggleRow = document.createElement('div');
  toggleRow.className = 'share-toggle-row';

  const switchLabel = document.createElement('label');
  switchLabel.className = 'switch';
  const switchInput = document.createElement('input');
  switchInput.type = 'checkbox';
  switchInput.setAttribute('role', 'switch');
  switchInput.checked = state.enabled;
  switchLabel.append(switchInput, document.createTextNode(SWITCH_LABEL));
  toggleRow.appendChild(switchLabel);

  const passwordField = document.createElement('div');
  passwordField.className = 'field';
  const passwordLabel = document.createElement('label');
  passwordLabel.setAttribute('for', `share-password-${data.id}`);
  passwordLabel.textContent = '分享密码';
  const passwordInput = document.createElement('input');
  passwordInput.id = `share-password-${data.id}`;
  passwordInput.type = 'password';
  passwordInput.setAttribute('placeholder', PASSWORD_PLACEHOLDER);
  passwordInput.setAttribute('maxlength', '64');
  const passwordHint = document.createElement('p');
  passwordHint.className = 'field-hint';
  passwordField.append(passwordLabel, passwordInput, passwordHint);

  const conditional = document.createElement('div');
  conditional.className = 'share-panel-conditional';

  panel.append(toggleRow, passwordField, conditional);
  container.appendChild(panel);

  const absoluteShareUrl = () => {
    if (!state.token) return '';
    const origin = (typeof location !== 'undefined' && location.origin) ? location.origin : '';
    return `${origin}/s/${state.token}`;
  };

  const refreshHint = () => {
    if (!state.enabled) {
      passwordHint.textContent = '';
      return;
    }
    passwordHint.textContent = state.hasPassword ? '该链接已设置密码' : '该链接无需密码';
  };

  const notify = () => {
    if (typeof onChange === 'function') onChange();
  };

  function copyLink() {
    const url = absoluteShareUrl();
    const clipboard = (typeof navigator !== 'undefined') ? navigator.clipboard : null;
    const write = clipboard && clipboard.writeText ? clipboard.writeText(url) : Promise.reject(
      new Error('clipboard unavailable'));
    write.then(() => toast(COPIED_TOAST, 'success')).catch(() => {
      const input = conditional.querySelector('input[readonly]');
      if (input && typeof input.select === 'function') input.select();
      toast(MANUAL_COPY_TOAST, 'info');
    });
  }

  async function enable() {
    switchInput.disabled = true;
    try {
      const result = await api.post(`/api/notes/${data.id}/share`,
                                    { password: passwordInput.value });
      state.enabled = true;
      state.token = (result && result.share_url)
        ? String(result.share_url).split('/').pop() : state.token;
      state.hasPassword = !!(result && result.has_password);
      passwordInput.value = '';
      switchInput.checked = true;
      renderConditional();
      refreshHint();
      notify();
    } catch (_) {
      switchInput.checked = false;
    } finally {
      switchInput.disabled = false;
    }
  }

  async function updatePassword() {
    try {
      const result = await api.post(`/api/notes/${data.id}/share`,
                                    { password: passwordInput.value });
      state.hasPassword = !!(result && result.has_password);
      state.token = (result && result.share_url)
        ? String(result.share_url).split('/').pop() : state.token;
      passwordInput.value = '';
      renderConditional();
      refreshHint();
      notify();
    } catch (_) { /* 错误文案由 api.js 统一 toast */ }
  }

  async function closeShare() {
    const confirmed = await confirmDialog({
      title: CLOSE_BUTTON,
      message: CLOSE_MESSAGE,
      confirmText: CLOSE_BUTTON,
      danger: true,
    });
    if (!confirmed) {
      switchInput.checked = state.enabled;
      return;
    }
    try {
      await api.del(`/api/notes/${data.id}/share`);
      state.enabled = false;
      state.token = null;
      state.hasPassword = false;
      passwordInput.value = '';
      switchInput.checked = false;
      renderConditional();
      refreshHint();
      notify();
    } catch (_) {
      switchInput.checked = state.enabled;
    }
  }

  function renderConditional() {
    conditional.textContent = '';
    const existing = toggleRow.querySelector('button');
    if (existing) existing.remove();
    if (!state.enabled) return;

    const update = document.createElement('button');
    update.type = 'button';
    update.className = 'btn btn-secondary';
    update.textContent = UPDATE_BUTTON;
    update.addEventListener('click', updatePassword);
    toggleRow.appendChild(update);

    const linkRow = document.createElement('div');
    linkRow.className = 'link-row';
    const linkInput = document.createElement('input');
    linkInput.type = 'text';
    linkInput.setAttribute('readonly', '');
    linkInput.setAttribute('aria-label', '分享链接');
    linkInput.value = absoluteShareUrl();
    const copy = document.createElement('button');
    copy.type = 'button';
    copy.className = 'btn btn-secondary';
    copy.textContent = COPY_BUTTON;
    copy.addEventListener('click', copyLink);
    linkRow.append(linkInput, copy);
    conditional.appendChild(linkRow);

    const dangerRow = document.createElement('div');
    dangerRow.className = 'share-danger-row';
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'btn btn-danger';
    close.textContent = CLOSE_BUTTON;
    close.addEventListener('click', closeShare);
    dangerRow.appendChild(close);
    conditional.appendChild(dangerRow);
  }

  switchInput.addEventListener('change', () => {
    if (switchInput.checked && !state.enabled) enable();
    else if (!switchInput.checked && state.enabled) closeShare();
  });

  renderConditional();
  refreshHint();
}
