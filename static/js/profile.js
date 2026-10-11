// profile.js — 个人主页四个 Tab（Phase 7 Task 3）：个人信息 / 我的笔记 / 我的收藏 / 浏览足迹。
// 约束：所有用户内容用 textContent 写入，不新增 HTML 出口；
//       不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。
// 改密本地校验复用 auth.js 的 FIELD_MESSAGES / isStrongPassword，不复制文案与规则。
import { api } from './api.js';
import { navigate } from './router.js';
import { store } from './store.js';
import { FIELD_MESSAGES, isStrongPassword } from './auth.js';
import { renderNoteGrid } from './notes.js';
import {
  confirmDialog, emptyState, formatDate, noteCard, pagination, skeleton, staleCard, toast,
} from './ui.js';

const TABS = [
  ['info', '个人信息'],
  ['notes', '我的笔记'],
  ['favorites', '我的收藏'],
  ['history', '浏览足迹'],
];
const TAB_NAMES = TABS.map(([name]) => name);
const DEFAULT_TAB = 'info';

const STATUS_FILTERS = [
  ['all', '全部'], ['draft', '草稿'], ['private', '私密'], ['public', '已分享'],
];
const SEARCH_PLACEHOLDER = '搜索标题或正文…';
const PAGE_SIZE = 10;

const STALE_TITLE = '内容已失效';
const REMOVE_TEXT = '移除';
const UNFAVORITE_TEXT = '取消收藏';
const EMPTY_NOTES = '还没有笔记，去写下第一篇吧';
const EMPTY_FAVORITES = '还没有收藏';
const EMPTY_HISTORY = '还没有浏览记录';
const NO_BIO = '还没有填写简介';

const SAVE_BUTTON = '保存资料';
const SAVED_TOAST = '已保存';
const PASSWORD_BUTTON = '修改密码';
const PASSWORD_TOAST = '密码已修改';

const CLEAR_HISTORY = '清空浏览记录';
const CLEAR_MESSAGE = '确定要清空全部浏览记录吗？此操作不可恢复。';
const CLEAR_CONFIRM = '清空';
const CLEARED_TOAST = '已清空浏览记录';

/* 打开收藏 / 足迹条目：本人的笔记走作者详情页；他人分享的笔记走分享页 /s/<token>。
   后端只在「他人 + 可用」时下发 share_url —— /api/notes/<id> 是作者侧路由，对非作者一律
   NOT_FOUND，照直跳过去只会看到「请求的内容不存在」。 */
const openItem = (item) => navigate(item.share_url || `/notes/${item.note.id}`);

/* ==========================================================================
   视图入口
   ========================================================================== */

export function renderProfile(root, params = {}) {
  const tab = resolveTab(params);

  const page = document.createElement('section');
  page.className = 'profile-page';
  root.appendChild(page);

  const tabBar = document.createElement('nav');
  tabBar.className = 'profile-tabs';
  tabBar.setAttribute('aria-label', '个人主页导航');
  TABS.forEach(([name, label]) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.setAttribute('role', 'tab');
    btn.textContent = label;
    const active = name === tab;
    if (active) {
      btn.classList.add('is-active');
      btn.setAttribute('aria-current', 'true');
    }
    btn.addEventListener('click', () => {
      if (name === tab) return;
      navigate(`/me?tab=${name}`, { replace: false });
    });
    tabBar.appendChild(btn);
  });
  page.appendChild(tabBar);

  const panel = document.createElement('div');
  panel.className = 'profile-panel';
  page.appendChild(panel);

  if (tab === 'notes') paintMyNotes(panel);
  else if (tab === 'favorites') paintFavorites(panel);
  else if (tab === 'history') paintHistory(panel);
  else paintInfo(panel);

  return page;
}

/** Tab 来源优先级：路由参数 → URL 查询串 → 默认「个人信息」（非法值一律回退）。 */
function resolveTab(params) {
  const fromParams = params && params.tab;
  if (TAB_NAMES.includes(fromParams)) return fromParams;
  let fromUrl = null;
  try { fromUrl = new URLSearchParams(location.search).get('tab'); } catch (_) { fromUrl = null; }
  return TAB_NAMES.includes(fromUrl) ? fromUrl : DEFAULT_TAB;
}

/* ==========================================================================
   个人信息 Tab
   ========================================================================== */

function paintInfo(panel) {
  panel.textContent = '';

  const cardSlot = document.createElement('div');
  cardSlot.className = 'profile-card-slot';
  const paintCard = (user) => {
    cardSlot.textContent = '';
    cardSlot.appendChild(buildProfileCard(user));
  };
  paintCard(store.user || {});
  panel.appendChild(cardSlot);

  panel.appendChild(buildProfileForm(store.user || {}, paintCard));
  panel.appendChild(buildPasswordForm());
}

function buildAvatar(user) {
  const avatar = document.createElement('div');
  avatar.className = 'profile-avatar';
  if (user.avatar) {
    const img = document.createElement('img');
    img.src = user.avatar;
    img.alt = `${user.username || ''} 的头像`;
    avatar.appendChild(img);
  } else {
    avatar.setAttribute('aria-hidden', 'true');
    avatar.textContent = String(user.username || '').trim().charAt(0);
  }
  return avatar;
}

function buildProfileCard(user) {
  const card = document.createElement('div');
  card.className = 'profile-card paper';
  card.appendChild(buildAvatar(user));

  const name = document.createElement('h2');
  name.className = 'profile-username';
  name.textContent = user.username || '';
  card.appendChild(name);

  const fields = document.createElement('dl');
  fields.className = 'profile-fields';
  const rows = [
    ['邮箱', 'profile-email', user.email || ''],
    ['简介', 'profile-bio', user.bio || NO_BIO],
    ['注册时间', 'profile-joined', formatDate(user.created_at)],
  ];
  rows.forEach(([label, cls, value]) => {
    const dt = document.createElement('dt');
    dt.className = 'profile-field-label';
    dt.textContent = label;
    const dd = document.createElement('dd');
    dd.className = cls;
    dd.textContent = value;
    fields.append(dt, dd);
  });
  card.appendChild(fields);
  return card;
}

function buildProfileForm(user, onSaved) {
  const form = document.createElement('form');
  form.className = 'profile-form paper';
  form.setAttribute('novalidate', '');

  const usernameField = textField('username', '用户名', 'username', user.username || '');
  const bioField = textareaField('bio', '简介', user.bio || '', 200);

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary profile-save';
  submit.textContent = SAVE_BUTTON;

  form.append(usernameField.wrap, bioField.wrap, submit);

  form.addEventListener('submit', async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    submit.disabled = true;
    submit.setAttribute('disabled', '');
    try {
      const data = await api.put('/api/users/me/profile', {
        username: usernameField.input.value.trim(),
        bio: bioField.input.value,
      });
      const updated = data && data.user;
      if (updated) {
        store.setUser(updated, store.csrfToken);   // 顶栏经 store.onChange 即时重绘
        onSaved(updated);                          // 页面卡片同步
      }
      toast(SAVED_TOAST, 'success');
    } catch (_) { /* 错误文案由 api.js 统一 toast 后端 message */ }
    finally {
      submit.disabled = false;
      submit.removeAttribute('disabled');
    }
  });
  return form;
}

function buildPasswordForm() {
  const form = document.createElement('form');
  form.className = 'profile-password-form paper';
  form.setAttribute('novalidate', '');

  const oldField = passwordField('old_password', '原密码', 'current-password');
  const newField = passwordField('new_password', '新密码', 'new-password');
  const confirmField = passwordField('confirm_password', '确认新密码', 'new-password');

  const error = document.createElement('p');
  error.className = 'field-error profile-password-error';
  error.setAttribute('role', 'alert');

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary profile-password-submit';
  submit.textContent = PASSWORD_BUTTON;

  form.append(oldField.wrap, newField.wrap, confirmField.wrap, error, submit);

  form.addEventListener('submit', async (event) => {
    if (event && typeof event.preventDefault === 'function') event.preventDefault();
    error.textContent = '';

    const newPassword = newField.input.value;
    // 本地先校验：复用 auth.js 的强度规则与文案，不重复实现
    if (!isStrongPassword(newPassword)) {
      error.textContent = FIELD_MESSAGES.PASSWORD_WEAK;
      newField.input.focus();
      return;
    }
    if (newPassword !== confirmField.input.value) {
      error.textContent = FIELD_MESSAGES.PASSWORD_MISMATCH;
      confirmField.input.focus();
      return;
    }

    submit.disabled = true;
    submit.setAttribute('disabled', '');
    try {
      await api.put('/api/users/me/password', {
        old_password: oldField.input.value,
        new_password: newPassword,
        confirm_password: confirmField.input.value,
      });
      // 改密成功后不清除会话（当前登录保留），但下次登录必须使用新密码
      [oldField, newField, confirmField].forEach((f) => { f.input.value = ''; });
      toast(PASSWORD_TOAST, 'success');
    } catch (_) { /* 错误文案由 api.js 统一 toast 后端 message */ }
    finally {
      submit.disabled = false;
      submit.removeAttribute('disabled');
    }
  });
  return form;
}

/* ---------------------------------------------------------------- 字段构件 */

function labelFor(name, text) {
  const label = document.createElement('label');
  label.setAttribute('for', `profile-${name}`);
  label.textContent = text;
  return label;
}

function fieldWrap(name) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.setAttribute('data-field', name);
  return wrap;
}

function textField(name, text, autocomplete, value) {
  const wrap = fieldWrap(name);
  const input = document.createElement('input');
  input.id = `profile-${name}`;
  input.setAttribute('name', name);
  input.type = 'text';
  input.setAttribute('autocomplete', autocomplete);
  input.value = value;
  wrap.append(labelFor(name, text), input);
  return { wrap, input };
}

function textareaField(name, text, value, maxlength) {
  const wrap = fieldWrap(name);
  const input = document.createElement('textarea');
  input.id = `profile-${name}`;
  input.setAttribute('name', name);
  input.setAttribute('maxlength', String(maxlength));
  input.setAttribute('rows', '4');
  input.value = value;
  wrap.append(labelFor(name, text), input);
  return { wrap, input };
}

function passwordField(name, text, autocomplete) {
  const wrap = fieldWrap(name);
  const input = document.createElement('input');
  input.id = `profile-${name}`;
  input.setAttribute('name', name);
  input.type = 'password';
  input.setAttribute('autocomplete', autocomplete);
  wrap.append(labelFor(name, text), input);
  return { wrap, input };
}

/* ==========================================================================
   我的笔记 Tab：复用 /notes 的网格与视觉，排序固定为更新时间
   ========================================================================== */

function paintMyNotes(panel) {
  let state = { status: 'all', q: '', tag: '', sort: 'updated', page: 1 };

  const paint = () => {
    panel.textContent = '';

    const toolbar = document.createElement('div');
    toolbar.className = 'note-toolbar';

    const group = document.createElement('div');
    group.className = 'segmented';
    group.setAttribute('role', 'group');
    STATUS_FILTERS.forEach(([value, label]) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'segmented-btn';
      btn.setAttribute('data-value', value);
      btn.textContent = label;
      const active = value === state.status;
      if (active) btn.classList.add('is-active');
      btn.setAttribute('aria-pressed', active ? 'true' : 'false');
      btn.addEventListener('click', () => {
        state = { ...state, status: value, page: 1 };
        paint();
      });
      group.appendChild(btn);
    });
    toolbar.appendChild(group);

    const select = document.createElement('select');
    select.className = 'tag-filter';
    select.setAttribute('aria-label', '按标签筛选');
    const allOption = document.createElement('option');
    allOption.value = '';
    allOption.textContent = '全部标签';
    select.appendChild(allOption);
    api.get('/api/tags', { silent: true }).then((data) => {
      ((data && data.items) || []).forEach((tag) => {
        const option = document.createElement('option');
        option.value = tag.name;
        option.textContent = tag.name;
        select.appendChild(option);
      });
      select.value = state.tag;
    }).catch(() => { /* 标签下拉加载失败不阻塞列表 */ });
    select.addEventListener('change', () => {
      state = { ...state, tag: select.value, page: 1 };
      paint();
    });
    toolbar.appendChild(select);

    const search = document.createElement('input');
    search.type = 'search';
    search.className = 'note-search';
    search.setAttribute('placeholder', SEARCH_PLACEHOLDER);
    search.setAttribute('aria-label', '搜索笔记');
    search.value = state.q;
    let timer = null;
    search.addEventListener('input', () => {
      if (timer !== null) window.clearTimeout(timer);
      timer = window.setTimeout(() => {
        timer = null;
        state = { ...state, q: search.value.trim(), page: 1 };
        paint();
      }, 300);
    });
    toolbar.appendChild(search);

    panel.appendChild(toolbar);

    const gridHost = document.createElement('div');
    gridHost.className = 'profile-grid';
    panel.appendChild(gridHost);

    renderNoteGrid(gridHost, { ...state }, {
      onPageChange: (next) => { state = { ...state, page: next }; paint(); },
      onClearFilters: () => {
        state = { ...state, status: 'all', q: '', tag: '', page: 1 };
        paint();
      },
    });
  };

  paint();
}

/* ==========================================================================
   我的收藏 Tab
   ========================================================================== */

function paintFavorites(panel) {
  const state = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE };

  const paintList = () => {
    panel.textContent = '';

    if (state.items.length === 0) {
      panel.appendChild(emptyState({ title: EMPTY_FAVORITES }));
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'profile-grid';
    state.items.forEach((item) => grid.appendChild(favoriteItem(item)));
    panel.appendChild(grid);

    panel.appendChild(pagination({
      page: state.page,
      pageSize: state.pageSize,
      total: state.total,
      onChange: (next) => { state.page = next; load(); },
    }));
  };

  const dropItem = (noteId) => {
    state.items = state.items.filter((it) => !it.note || it.note.id !== noteId);
    state.total = Math.max(0, state.total - 1);
    paintList();
  };

  async function removeFavorite(item) {
    try {
      await api.del(`/api/favorites/${item.note.id}`);
      dropItem(item.note.id);
    } catch (_) { /* 错误文案由 api.js 统一 toast 后端 message */ }
  }

  const favoriteItem = (item) => {
    const note = item.note || {};
    const authorName = (item.author && item.author.username) || '';

    if (item.available === false) {
      return staleCard({
        title: STALE_TITLE,
        authorName,
        onRemove: () => removeFavorite(item),
      });
    }

    const card = noteCard(note, { onOpen: () => openItem(item) });

    const foot = card.querySelector('.note-card-foot');
    const author = document.createElement('span');
    author.className = 'note-card-author';
    author.textContent = authorName;
    if (foot) foot.appendChild(author);
    else card.appendChild(author);

    // 卡片右下角的「取消收藏」文字按钮：阻止冒泡，避免同时触发打开笔记
    const unfavorite = document.createElement('button');
    unfavorite.type = 'button';
    unfavorite.className = 'btn btn-ghost favorite-remove';
    unfavorite.textContent = UNFAVORITE_TEXT;
    unfavorite.addEventListener('click', (event) => {
      if (event && typeof event.stopPropagation === 'function') event.stopPropagation();
      removeFavorite(item);
    });
    card.appendChild(unfavorite);

    return card;
  };

  function load() {
    panel.textContent = '';
    const host = document.createElement('div');
    host.className = 'note-content';
    host.appendChild(skeleton(3));
    panel.appendChild(host);

    api.get(`/api/favorites?page=${state.page}&page_size=${state.pageSize}`)
      .then((data) => {
        state.items = ((data && data.items) || []).slice();
        state.total = (data && data.total) || 0;
        state.page = (data && data.page) || state.page;
        state.pageSize = (data && data.page_size) || PAGE_SIZE;
        paintList();
      })
      .catch(() => { panel.textContent = ''; });
  }

  load();
}

/* ==========================================================================
   浏览足迹 Tab
   ========================================================================== */

function paintHistory(panel) {
  const state = { items: [], total: 0, page: 1, pageSize: PAGE_SIZE };

  const paintList = () => {
    panel.textContent = '';

    const bar = document.createElement('div');
    bar.className = 'profile-history-bar';
    const clear = document.createElement('button');
    clear.type = 'button';
    clear.className = 'btn btn-danger profile-clear-history';
    clear.textContent = CLEAR_HISTORY;
    clear.addEventListener('click', clearAll);
    bar.appendChild(clear);
    panel.appendChild(bar);

    if (state.items.length === 0) {
      panel.appendChild(emptyState({ title: EMPTY_HISTORY }));
      return;
    }

    const grid = document.createElement('div');
    grid.className = 'profile-grid';
    state.items.forEach((item) => grid.appendChild(historyItem(item)));
    panel.appendChild(grid);

    panel.appendChild(pagination({
      page: state.page,
      pageSize: state.pageSize,
      total: state.total,
      onChange: (next) => { state.page = next; load(); },
    }));
  };

  async function removeHistory(item) {
    try {
      await api.del(`/api/history/${item.note.id}`);
      state.items = state.items.filter((it) => !it.note || it.note.id !== item.note.id);
      state.total = Math.max(0, state.total - 1);
      paintList();
    } catch (_) { /* 错误文案由 api.js 统一 toast 后端 message */ }
  }

  async function clearAll() {
    const confirmed = await confirmDialog({
      title: CLEAR_HISTORY,
      message: CLEAR_MESSAGE,
      confirmText: CLEAR_CONFIRM,
      danger: true,
    });
    if (!confirmed) return;
    try {
      await api.del('/api/history');
      state.items = [];
      state.total = 0;
      state.page = 1;
      paintList();
      toast(CLEARED_TOAST, 'success');
    } catch (_) { /* 错误文案由 api.js 统一 toast 后端 message */ }
  }

  const historyItem = (item) => {
    const note = item.note || {};
    const authorName = (item.author && item.author.username) || '';

    if (item.available === false) {
      return staleCard({
        title: STALE_TITLE,
        authorName,
        onRemove: () => removeHistory(item),
      });
    }

    // 足迹卡片展示浏览时间与作者：复用 noteCard，把更新时间替换为 viewed_at
    const card = noteCard({ ...note, updated_at: item.viewed_at },
                          { onOpen: () => openItem(item) });
    const foot = card.querySelector('.note-card-foot');
    const author = document.createElement('span');
    author.className = 'note-card-author';
    author.textContent = authorName;
    if (foot) foot.appendChild(author);
    else card.appendChild(author);
    return card;
  };

  function load() {
    panel.textContent = '';
    const host = document.createElement('div');
    host.className = 'note-content';
    host.appendChild(skeleton(3));
    panel.appendChild(host);

    api.get(`/api/history?page=${state.page}&page_size=${state.pageSize}`)
      .then((data) => {
        state.items = ((data && data.items) || []).slice();
        state.total = (data && data.total) || 0;
        state.page = (data && data.page) || state.page;
        state.pageSize = (data && data.page_size) || PAGE_SIZE;
        paintList();
      })
      .catch(() => { panel.textContent = ''; });
  }

  load();
}
