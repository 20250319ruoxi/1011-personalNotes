// comments.js — 评论区组件（Phase 6），分享页与作者详情页共用。
// 约束：评论内容、作者名一律 textContent 写入，绝不 innerHTML；
//       不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。
// 权限：删除按钮是否显示取决于服务端返回的 can_delete；删除接口自身会重新判定权限。
import { api } from './api.js';
import { navigate } from './router.js';
import { store } from './store.js';
import { confirmDialog, formatDate, skeleton, toast } from './ui.js';

const EMPTY_TEXT = '还没有评论，来说点什么吧';
const PLACEHOLDER = '写下你的想法…';
const SUBMIT_TEXT = '发表评论';
const LOGGED_OUT_HINT = '登录后可发表评论';
const LOGIN_BUTTON = '去登录';
const POSTED_TOAST = '已发表评论';
const LOAD_MORE = '加载更多';

const MAX_COMMENT_LENGTH = 1000;

function firstChar(name) {
  const text = String(name || '').trim();
  return text.charAt(0) || '?';
}

function withPage(path, page, pageSize) {
  const sep = path.includes('?') ? '&' : '?';
  return `${path}${sep}page=${page}&page_size=${pageSize}`;
}

export function renderComments(container, { listPath = '', createPath = '', noteOwnerId = null } = {}) {
  if (!container) return;
  void noteOwnerId;   // 仅用于调用方自述；删除权限由服务端按 can_delete 判定，前端不参与

  const host = document.createElement('section');
  host.className = 'comments';
  container.textContent = '';
  container.appendChild(host);

  const state = { items: [], total: 0, page: 1, pageSize: 10 };

  // 加载中：3 行骨架
  const loading = document.createElement('div');
  loading.className = 'comments-loading';
  loading.appendChild(skeleton(3));
  host.appendChild(loading);

  // 数据到达后一次性挂载，之后只做局部刷新
  const heading = document.createElement('h2');
  heading.className = 'comments-title';
  const formSlot = document.createElement('div');
  formSlot.className = 'comment-form';
  const list = document.createElement('ul');
  list.className = 'comment-list';
  const emptyEl = document.createElement('p');
  emptyEl.className = 'comment-empty';
  const moreSlot = document.createElement('div');
  moreSlot.className = 'comment-more';

  let mounted = false;
  const mount = () => {
    if (mounted) return;
    mounted = true;
    host.textContent = '';
    host.append(heading, formSlot, list, emptyEl, moreSlot);
    renderForm();
  };

  function refresh() {
    mount();
    heading.textContent = `评论（${state.total}）`;
    list.textContent = '';
    state.items.forEach((item) => list.appendChild(commentItem(item)));
    emptyEl.textContent = state.items.length ? '' : EMPTY_TEXT;
    moreSlot.textContent = '';
    if (state.items.length < state.total) {
      const more = document.createElement('button');
      more.type = 'button';
      more.className = 'btn btn-ghost comment-more-btn';
      more.textContent = LOAD_MORE;
      more.addEventListener('click', () => loadPage(state.page + 1));
      moreSlot.appendChild(more);
    }
  }

  function commentItem(item) {
    const li = document.createElement('li');
    li.className = 'comment';

    const avatar = document.createElement('span');
    avatar.className = 'comment-avatar';
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = firstChar(item.author && item.author.username);

    const main = document.createElement('div');
    main.className = 'comment-main';

    const head = document.createElement('div');
    head.className = 'comment-head';

    const name = document.createElement('span');
    name.className = 'comment-author';
    name.textContent = (item.author && item.author.username) || '已注销用户';

    const time = document.createElement('time');
    time.className = 'comment-time';
    time.textContent = formatDate(item.created_at);

    head.append(name, time);

    const body = document.createElement('p');
    body.className = 'comment-body';
    body.textContent = item.content || '';

    main.append(head, body);
    li.append(avatar, main);

    if (item.can_delete) {
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'comment-delete';
      remove.textContent = '删除';
      remove.addEventListener('click', async () => {
        const confirmed = await confirmDialog({
          title: '删除评论',
          message: '确定要删除这条评论吗？删除后无法恢复。',
          confirmText: '确定删除',
          danger: true,
        });
        if (!confirmed) return;
        try {
          await api.del(`/api/comments/${item.id}`);
          state.items = state.items.filter((c) => c.id !== item.id);
          state.total = Math.max(0, state.total - 1);
          refresh();
        } catch (_) { /* 错误文案由 api.js 统一 toast */ }
      });
      li.appendChild(remove);
    }
    return li;
  }

  function renderForm() {
    formSlot.textContent = '';

    if (!store.isLoggedIn()) {
      const hint = document.createElement('p');
      hint.className = 'comment-login-hint';
      hint.textContent = LOGGED_OUT_HINT;

      const login = document.createElement('button');
      login.type = 'button';
      login.className = 'btn btn-primary';
      login.textContent = LOGIN_BUTTON;
      login.addEventListener('click', () => {
        const back = encodeURIComponent(location.pathname + location.search);
        navigate(`/login?redirect=${back}`);
      });

      formSlot.append(hint, login);
      return;
    }

    const form = document.createElement('form');
    form.className = 'comment-form-inner';
    form.setAttribute('novalidate', '');

    const fieldWrap = document.createElement('div');
    fieldWrap.className = 'field';

    const label = document.createElement('label');
    label.setAttribute('for', 'comment-input');
    label.className = 'sr-only';
    label.textContent = '评论内容';

    const textarea = document.createElement('textarea');
    textarea.id = 'comment-input';
    textarea.setAttribute('placeholder', PLACEHOLDER);
    textarea.setAttribute('maxlength', String(MAX_COMMENT_LENGTH));
    textarea.setAttribute('rows', '3');

    fieldWrap.append(label, textarea);

    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'btn btn-primary comment-submit';
    const submitText = document.createElement('span');
    submitText.className = 'btn-text';
    submitText.textContent = SUBMIT_TEXT;
    submit.appendChild(submitText);

    form.append(fieldWrap, submit);
    formSlot.appendChild(form);

    form.addEventListener('submit', async (event) => {
      if (event && typeof event.preventDefault === 'function') event.preventDefault();
      const content = textarea.value.trim();
      if (!content) return;

      submit.disabled = true;
      submit.setAttribute('disabled', '');
      submit.classList.add('is-loading');
      try {
        const data = await api.post(createPath, { content });
        const comment = data && data.comment;
        textarea.value = '';
        if (comment) {
          state.items.push(comment);
          state.total += 1;
          refresh();
        }
        toast(POSTED_TOAST, 'success');
      } catch (_) { /* 错误文案由 api.js 统一 toast */ }
      finally {
        submit.disabled = false;
        submit.removeAttribute('disabled');
        submit.classList.remove('is-loading');
      }
    });
  }

  function loadPage(page) {
    api.get(withPage(listPath, page, state.pageSize))
      .then((data) => {
        const items = (data && data.items) || [];
        state.items = state.items.concat(items);
        if (data && typeof data.total === 'number') state.total = data.total;
        state.page = (data && data.page) || page;
        refresh();
      })
      .catch(() => { /* 错误文案由 api.js 统一 toast */ });
  }

  api.get(listPath)
    .then((data) => {
      // 复制一份：绝不原地修改接口返回的数组（避免同一响应被多实例共享时互相污染）
      state.items = ((data && data.items) || []).slice();
      state.total = (data && data.total) || 0;
      state.page = (data && data.page) || 1;
      state.pageSize = (data && data.page_size) || 10;
      refresh();
    })
    .catch((err) => {
      host.textContent = '';
      const failure = document.createElement('p');
      failure.className = 'comment-error';
      failure.textContent = (err && err.message) || '评论加载失败';
      host.appendChild(failure);
    });
}
