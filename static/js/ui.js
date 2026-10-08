/* ui.js — 通用组件唯一来源：顶栏、toast、二次确认弹窗、骨架片、空态、日期与转义。
   约束：不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。 */

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
   顶栏骨架：Phase 1 只渲染未登录态占位链接；Phase 2 补视觉、Phase 3 补已登录态
   ========================================================================== */

function buildNavLink(href, text, activePath) {
  const link = document.createElement('a');
  link.href = href;
  link.textContent = text;
  if (href === activePath) link.setAttribute('aria-current', 'page');
  return link;
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
  toggle.setAttribute('aria-label', '打开导航菜单');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.setAttribute('aria-controls', 'nav-drawer');
  toggle.textContent = '☰';
  toggle.addEventListener('click', () => {
    const drawer = document.getElementById('nav-drawer');
    if (!drawer) return;
    const open = drawer.classList.toggle('is-open');
    toggle.setAttribute('aria-expanded', open ? 'true' : 'false');
    toggle.setAttribute('aria-label', open ? '关闭导航菜单' : '打开导航菜单');
  });

  const drawer = document.createElement('div');
  drawer.className = 'nav-drawer';
  drawer.id = 'nav-drawer';

  const links = document.createElement('ul');
  links.className = 'nav-links';
  [['/', '首页'], ['/about', '关于']].forEach(([href, text]) => {
    const li = document.createElement('li');
    li.appendChild(buildNavLink(href, text, activePath));
    links.appendChild(li);
  });

  drawer.appendChild(links);

  if (user) {
    // 已登录态（写笔记 / 我的主页 / 头像菜单）由 Phase 3 填充
  } else {
    const guest = document.createElement('ul');
    guest.className = 'nav-user';
    [['/login', '登录'], ['/register', '注册']].forEach(([href, text], index) => {
      const li = document.createElement('li');
      const link = buildNavLink(href, text, activePath);
      if (index === 0) link.className = 'btn btn-secondary';
      else link.className = 'btn btn-primary';
      li.appendChild(link);
      guest.appendChild(li);
    });
    drawer.appendChild(guest);
  }

  nav.append(brand, toggle, drawer);
  header.appendChild(nav);
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
