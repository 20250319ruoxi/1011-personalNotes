/* ui.js — 通用组件唯一来源：顶栏、toast、二次确认弹窗、骨架片、空态、日期与转义。
   约束：不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。 */

import { api } from './api.js';
import { store } from './store.js';

const TOAST_DURATION = 2500;      // 自动消失时长（悬停暂停）
const TOAST_LEAVE_MS = 200;       // 离场动画时长

/* ==========================================================================
   toast
   ========================================================================== */

export function toast(message, type = 'info') {
  const root = document.getElementById('toast-root');
  if (!root) return null;

  const el = document.createElement('div');
  el.className = `toast toast-${type}`;
  el.setAttribute('role', type === 'error' ? 'alert' : 'status');
  el.textContent = message == null ? '' : String(message);

  let timer = null;
  const startTimer = () => {
    if (timer !== null) return;
    timer = window.setTimeout(dismiss, TOAST_DURATION);
  };
  const pauseTimer = () => {
    if (timer !== null) { window.clearTimeout(timer); timer = null; }
  };
  const dismiss = () => {
    pauseTimer();
    el.classList.add('is-leaving');
    window.setTimeout(() => el.remove(), TOAST_LEAVE_MS);
  };

  el.addEventListener('mouseenter', pauseTimer);
  el.addEventListener('mouseleave', startTimer);
  el.addEventListener('focusin', pauseTimer);
  el.addEventListener('focusout', startTimer);

  root.appendChild(el);
  // 多条堆叠最多保留 5 条，避免刷屏
  while (root.children.length > 5) root.firstElementChild.remove();
  startTimer();
  return el;
}

/* ==========================================================================
   二次确认弹窗：role="dialog" + aria-modal + 焦点锁 + Esc 关闭并回焦
   ========================================================================== */

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), '
  + 'textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])';

export function confirmDialog({
  title = '确认操作',
  message = '',
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
} = {}) {
  return new Promise((resolve) => {
    const root = document.getElementById('dialog-root');
    const trigger = document.activeElement;
    if (!root) { resolve(false); return; }

    const mask = document.createElement('div');
    mask.className = 'dialog-mask';

    const dialog = document.createElement('div');
    dialog.className = 'dialog';
    dialog.setAttribute('role', 'dialog');
    dialog.setAttribute('aria-modal', 'true');

    const titleId = 'dialog-title';
    dialog.setAttribute('aria-labelledby', titleId);

    const heading = document.createElement('h2');
    heading.className = 'dialog-title';
    heading.id = titleId;
    heading.textContent = title;

    const body = document.createElement('p');
    body.className = 'dialog-message';
    body.textContent = message;

    const actions = document.createElement('div');
    actions.className = 'dialog-actions';

    const cancelBtn = document.createElement('button');
    cancelBtn.type = 'button';
    cancelBtn.className = 'btn btn-secondary';
    cancelBtn.textContent = cancelText;

    const confirmBtn = document.createElement('button');
    confirmBtn.type = 'button';
    confirmBtn.className = danger ? 'btn btn-danger' : 'btn btn-primary';
    confirmBtn.textContent = confirmText;

    actions.append(cancelBtn, confirmBtn);
    dialog.append(heading, body, actions);
    mask.appendChild(dialog);
    root.appendChild(mask);

    const onKeydown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close(false);
        return;
      }
      if (event.key !== 'Tab') return;
      const items = Array.from(dialog.querySelectorAll(FOCUSABLE));
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      } else if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        first.focus();
      }
    };

    function close(result) {
      document.removeEventListener('keydown', onKeydown, true);
      mask.remove();
      if (trigger && typeof trigger.focus === 'function') trigger.focus();
      resolve(result);
    }

    cancelBtn.addEventListener('click', () => close(false));
    confirmBtn.addEventListener('click', () => close(true));
    document.addEventListener('keydown', onKeydown, true);

    confirmBtn.focus();   // 打开时把焦点移入首个按钮
  });
}

/* ==========================================================================
   顶栏：未登录态「登录 / 注册 / 关于」+ 已登录态「写笔记 / 我的主页 / 头像菜单」
   + 移动抽屉 + 滚动阴影
   ========================================================================== */

const GUEST_LINKS = [['/login', '登录'], ['/register', '注册'], ['/about', '关于']];
const AUTH_LINKS = [['/notes/new', '写笔记'], ['/me', '我的主页'], ['/about', '关于']];

function buildNavLink(href, text, activePath) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = text;
  if (href === activePath) {
    link.setAttribute('aria-current', 'page');
    link.className = 'is-active';
  }
  return link;
}

/* 已登录态头像 + 下拉菜单（个人主页 / 退出登录） */
function buildUserMenu(user, header) {
  const wrap = document.createElement('div');
  wrap.className = 'nav-user';

  const avatarBtn = document.createElement('button');
  avatarBtn.type = 'button';
  avatarBtn.className = 'avatar-btn';
  avatarBtn.setAttribute('aria-haspopup', 'menu');
  avatarBtn.setAttribute('aria-expanded', 'false');
  avatarBtn.setAttribute('aria-label', `账号菜单：${String(user.username || '').trim()}`);
  avatarBtn.textContent = String(user.username || '').trim().charAt(0);

  const menu = document.createElement('div');
  menu.className = 'avatar-menu';
  menu.setAttribute('role', 'menu');

  const profileLink = document.createElement('a');
  profileLink.setAttribute('role', 'menuitem');
  profileLink.href = '/me';
  profileLink.textContent = '个人主页';

  const logoutBtn = document.createElement('button');
  logoutBtn.type = 'button';
  logoutBtn.className = 'avatar-menu-item';
  logoutBtn.setAttribute('role', 'menuitem');
  logoutBtn.textContent = '退出登录';

  menu.append(profileLink, logoutBtn);

  const isOpen = () => menu.classList.contains('is-open');
  const setOpen = (open) => {
    menu.classList.toggle('is-open', open);
    avatarBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) {
      const first = menu.querySelector('a, button');
      if (first && typeof first.focus === 'function') first.focus();
    }
  };

  avatarBtn.addEventListener('click', () => setOpen(!isOpen()));

  menu.addEventListener('click', (event) => {
    if (event.target && event.target.tagName === 'A') setOpen(false);
  });

  logoutBtn.addEventListener('click', async () => {
    setOpen(false);
    const confirmed = await confirmDialog({
      title: '退出登录',
      message: '确定要退出当前账号吗？',
      confirmText: '退出登录',
    });
    if (!confirmed) return;
    try {
      await api.post('/api/auth/logout');
    } catch (_) { /* 已登出或网络异常，仍按登出处理 */ }
    store.setUser(null, null);
    toast('已退出登录', 'success');
    const { navigate } = await import('./router.js');   // 动态导入避免循环依赖
    navigate('/');
  });

  // Esc 关闭并把焦点交回头像按钮
  wrap.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      setOpen(false);
      avatarBtn.focus();
    }
  });

  // 点击菜单外部关闭；wrap 已被移除时自动解绑，避免监听器累积
  const onDocumentClick = (event) => {
    if (header && !header.contains(wrap)) {
      document.removeEventListener('click', onDocumentClick);
      return;
    }
    if (!isOpen()) return;
    if (wrap.contains(event.target)) return;
    setOpen(false);
  };
  document.addEventListener('click', onDocumentClick);

  wrap.append(avatarBtn, menu);
  return wrap;
}

export function renderHeader(user, activePath = '/') {
  const header = document.getElementById('app-header');
  if (!header) return null;

  header.textContent = '';
  header.className = 'app-header';

  const nav = document.createElement('nav');
  nav.className = 'app-nav';
  nav.setAttribute('aria-label', '主导航');

  const brand = document.createElement('a');
  brand.className = 'nav-brand';
  brand.href = '/';
  const logo = document.createElement('img');
  logo.src = '/static/img/logo.svg';
  logo.alt = '';
  const brandText = document.createElement('span');
  brandText.textContent = '个人笔记';
  brand.append(logo, brandText);

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'nav-toggle';
  toggle.textContent = '☰';
  toggle.setAttribute('aria-label', '打开导航菜单');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'nav-drawer');

  const scrim = document.createElement('div');
  scrim.className = 'nav-scrim';

  const drawer = document.createElement('div');
  drawer.className = 'nav-drawer';
  drawer.id = 'nav-drawer';

  const links = document.createElement('ul');
  links.className = 'nav-links';
  (user ? AUTH_LINKS : GUEST_LINKS).forEach(([href, text]) => {
    const li = document.createElement('li');
    li.appendChild(buildNavLink(href, text, activePath));
    links.appendChild(li);
  });
  drawer.appendChild(links);

  if (user) {
    drawer.appendChild(buildUserMenu(user, header));
  }

  const isOpen = () => drawer.classList.contains('is-open');
  const setOpen = (open) => {
    drawer.classList.toggle('is-open', open);
    scrim.classList.toggle('is-visible', open);
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
    if (open) {
      const first = drawer.querySelector('a');
      if (first) first.focus();
    } else {
      toggle.focus();        // 关闭时焦点回到汉堡按钮
    }
  };

  toggle.addEventListener('click', () => setOpen(!isOpen()));
  scrim.addEventListener('click', () => setOpen(false));
  links.addEventListener('click', (event) => {
    if (event.target && event.target.tagName === 'A') setOpen(false);
  });
  // Esc 关闭：绑定在每次重建的 nav 上，避免在复用的 header 上堆叠监听
  nav.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && isOpen()) {
      event.preventDefault();
      setOpen(false);
    }
  });

  nav.append(brand, toggle, scrim, drawer);
  header.appendChild(nav);

  // 滚动阴影：header 元素跨路由复用，仅在首次渲染绑定一次监听
  const applyScrolled = () => header.classList.toggle('is-scrolled', window.scrollY > 8);
  if (!header.__scrollBound) {
    header.__scrollBound = true;
    window.addEventListener('scroll', applyScrolled, { passive: true });
  }
  applyScrolled();

  return header;
}

/* ==========================================================================
   骨架片 / 空态 / 日期 / 转义
   ========================================================================== */

export function skeleton(count = 3) {
  const wrap = document.createElement('div');
  wrap.className = 'skeleton-list';
  wrap.setAttribute('aria-busy', 'true');
  wrap.setAttribute('aria-label', '加载中');
  for (let i = 0; i < count; i += 1) {
    const item = document.createElement('div');
    item.className = 'skeleton';
    wrap.appendChild(item);
  }
  return wrap;
}

export function emptyState({ title = '', actionText = '', onAction = null } = {}) {
  const box = document.createElement('div');
  box.className = 'empty-state';

  const heading = document.createElement('h2');
  heading.textContent = title;
  box.appendChild(heading);

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

export function formatDate(iso) {
  if (!iso) return '';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '';

  const MINUTE = 60 * 1000;
  const HOUR = 60 * MINUTE;
  const DAY = 24 * HOUR;
  const diff = Date.now() - date.getTime();

  if (diff >= 0 && diff < 7 * DAY) {
    if (diff < MINUTE) return '刚刚';
    if (diff < HOUR) return `${Math.floor(diff / MINUTE)} 分钟前`;
    if (diff < DAY) return `${Math.floor(diff / HOUR)} 小时前`;
    return `${Math.floor(diff / DAY)} 天前`;
  }

  const pad = (n) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
    + `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function escapeHtml(text) {
  return String(text == null ? '' : text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ==========================================================================
   笔记卡片：笔记列表、我的笔记、收藏、足迹共用（Phase 5 Task 2）
   状态徽标：draft → 草稿、private → 私密、public → 已分享
   ========================================================================== */

const STATUS_BADGE = { draft: '草稿', private: '私密', public: '已分享' };

export function noteCard(note, { onOpen, onRemove } = {}) {
  const data = note || {};
  const card = document.createElement('article');
  card.className = 'note-card paper';

  // 失效占位（收藏 / 足迹里已不可访问的笔记）：只显示占位与「移除」
  if (data.available === false) {
    card.classList.add('is-stale');
    const staleTitle = document.createElement('h3');
    staleTitle.className = 'note-card-title';
    staleTitle.textContent = '内容已失效';
    card.appendChild(staleTitle);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'btn btn-ghost note-remove';
    removeBtn.textContent = '移除';
    removeBtn.addEventListener('click', () => {
      if (typeof onRemove === 'function') onRemove(data);
    });
    card.appendChild(removeBtn);
    return card;
  }

  card.setAttribute('tabindex', '0');
  card.setAttribute('role', 'link');

  const head = document.createElement('div');
  head.className = 'note-card-head';

  const title = document.createElement('h3');
  title.className = 'note-card-title';
  title.textContent = data.title || '无标题';
  head.appendChild(title);

  const status = STATUS_BADGE[data.status] ? data.status : 'draft';
  const badge = document.createElement('span');
  badge.className = `badge badge-${status}`;
  badge.textContent = STATUS_BADGE[status];
  head.appendChild(badge);

  card.appendChild(head);

  const summary = document.createElement('p');
  summary.className = 'note-summary';
  summary.textContent = data.summary || '（空白笔记）';
  card.appendChild(summary);

  const tags = Array.isArray(data.tags) ? data.tags : [];
  if (tags.length) {
    const list = document.createElement('ul');
    list.className = 'note-tags';
    tags.forEach((name) => {
      const item = document.createElement('li');
      item.className = 'tag-chip';
      item.textContent = name;
      list.appendChild(item);
    });
    card.appendChild(list);
  }

  const foot = document.createElement('div');
  foot.className = 'note-card-foot';
  const time = document.createElement('time');
  time.className = 'note-time';
  time.textContent = formatDate(data.updated_at);
  foot.appendChild(time);
  card.appendChild(foot);

  card.addEventListener('click', () => {
    if (typeof onOpen === 'function') onOpen(data);
  });
  card.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    event.preventDefault();
    if (typeof onOpen === 'function') onOpen(data);
  });

  return card;
}

/* ==========================================================================
   失效占位卡片（Phase 7 Task 3）：收藏 / 足迹中已不可访问的笔记
   - 标题位置固定显示「内容已失效」，副文案显示作者名
   - 只提供「移除」操作；标题不可点击（无 tabindex / role=link）
   - 不展示状态徽标、摘要与时间，避免泄露已关闭分享的内容
   ========================================================================== */

export function staleCard({ title = '内容已失效', authorName = '', onOpen, onRemove } = {}) {
  // 计划签名保留 onOpen；失效条目标题不可点击，因此不接受任何打开行为
  void onOpen;

  const card = document.createElement('article');
  card.className = 'note-card paper is-stale';

  const heading = document.createElement('h3');
  heading.className = 'note-card-title';
  heading.textContent = title;
  card.appendChild(heading);

  const author = document.createElement('p');
  author.className = 'note-card-author';
  author.textContent = authorName == null ? '' : String(authorName);
  card.appendChild(author);

  const actions = document.createElement('div');
  actions.className = 'stale-actions';

  const remove = document.createElement('button');
  remove.type = 'button';
  remove.className = 'btn btn-ghost note-remove';
  remove.textContent = '移除';
  remove.addEventListener('click', () => {
    if (typeof onRemove === 'function') onRemove();
  });
  actions.appendChild(remove);
  card.appendChild(actions);

  return card;
}

/* ==========================================================================
   分页控件（Phase 5 Task 2）：第 X / Y 页 + 共 N 篇，边界禁用
   ========================================================================== */

export function pagination({ page = 1, pageSize = 10, total = 0, onChange } = {}) {
  const size = pageSize > 0 ? pageSize : 10;
  const count = total > 0 ? total : 0;
  const pages = Math.max(1, Math.ceil(count / size));
  const current = Math.min(Math.max(1, page), pages);

  const wrap = document.createElement('nav');
  wrap.className = 'pagination';
  wrap.setAttribute('aria-label', '分页');

  const prev = document.createElement('button');
  prev.type = 'button';
  prev.className = 'btn btn-ghost pagination-prev';
  prev.textContent = '上一页';
  const prevDisabled = current <= 1;
  if (prevDisabled) {
    prev.disabled = true;
    prev.setAttribute('disabled', '');
  }
  prev.addEventListener('click', () => {
    if (!prevDisabled && typeof onChange === 'function') onChange(current - 1);
  });

  const info = document.createElement('span');
  info.className = 'pagination-info';
  info.textContent = `第 ${current} / ${pages} 页`;

  const totalEl = document.createElement('span');
  totalEl.className = 'pagination-total';
  totalEl.textContent = `共 ${count} 篇`;

  const next = document.createElement('button');
  next.type = 'button';
  next.className = 'btn btn-ghost pagination-next';
  next.textContent = '下一页';
  const nextDisabled = current >= pages;
  if (nextDisabled) {
    next.disabled = true;
    next.setAttribute('disabled', '');
  }
  next.addEventListener('click', () => {
    if (!nextDisabled && typeof onChange === 'function') onChange(current + 1);
  });

  wrap.append(prev, info, totalEl, next);
  return wrap;
}

/* ==========================================================================
   收藏按钮（详情页与分享页共用，Phase 7 Task 2）
   - 状态来源：登录态下渲染时并行查询 `GET /api/favorites?page_size=50` 定位当前笔记
     （详情接口不返回收藏状态）；未登录不查询，避免 401 触发 UNAUTHORIZED 跳转。
   - 未登录点击 → 跳 `/login?redirect=<回跳目标>`，不做静默失败。
   - 已登录未收藏 → `POST /api/favorites`；返回 ALREADY_FAVORITED 时直接置为已收藏
     并按后端 message 提示（不当作失败流程处理）。
   - 已收藏 → 二次确认后 `DELETE /api/favorites/<id>`。
   - 文案只取后端 message，不在前端编造中文提示。
   ========================================================================== */

const FAVORITE_TEXT = '收藏';
const FAVORITED_TEXT = '已收藏';
const UNFAVORITE_TITLE = '取消收藏';
const UNFAVORITE_MESSAGE = '确定要取消收藏这篇笔记吗？';

export function favoriteButton(note, { isFavorited = false, redirect = null } = {}) {
  const data = note || {};
  const noteId = data.id;

  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-secondary favorite-btn';

  let favorited = !!isFavorited;

  const sync = () => {
    btn.textContent = favorited ? FAVORITED_TEXT : FAVORITE_TEXT;
    btn.classList.toggle('is-favorited', favorited);
    btn.setAttribute('aria-pressed', favorited ? 'true' : 'false');
  };
  sync();

  async function goLogin() {
    const back = redirect
      || (typeof location !== 'undefined' ? location.pathname + location.search : '/');
    const { navigate } = await import('./router.js');   // 动态导入避免循环依赖
    navigate(`/login?redirect=${encodeURIComponent(back)}`);
  }

  async function add() {
    try {
      await api.post('/api/favorites', { note_id: noteId }, { silent: true });
      favorited = true;
      sync();
    } catch (err) {
      if (err && err.code === 'ALREADY_FAVORITED') {
        favorited = true;      // 已收藏不是失败：直接把按钮置为已收藏
        sync();
      }
      if (err && err.message) toast(err.message);
    }
  }

  async function remove() {
    const confirmed = await confirmDialog({
      title: UNFAVORITE_TITLE,
      message: UNFAVORITE_MESSAGE,
      confirmText: UNFAVORITE_TITLE,
    });
    if (!confirmed) return;
    try {
      await api.del(`/api/favorites/${noteId}`, { silent: true });
      favorited = false;
      sync();
    } catch (err) {
      if (err && err.message) toast(err.message);
    }
  }

  btn.addEventListener('click', () => {
    if (!store.isLoggedIn()) { goLogin(); return; }
    if (favorited) remove();
    else add();
  });

  if (store.isLoggedIn()) {
    api.get('/api/favorites?page_size=50', { silent: true })
      .then((list) => {
        const items = (list && list.items) || [];
        const hit = items.some((item) => item && item.note && item.note.id === noteId);
        if (hit) { favorited = true; sync(); }
      })
      .catch(() => { /* 收藏状态查询失败不阻塞内容渲染 */ });
  }

  return btn;
}
