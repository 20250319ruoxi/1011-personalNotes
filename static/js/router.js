import { store } from './store.js';
import { api, bindErrorToast } from './api.js';
import { toast, renderHeader } from './ui.js';

const routes = [];   // { pattern, requiresAuth, load }
let bootstrapped = false;   // 会话恢复（/auth/me）只执行一次

export function registerRoute(pattern, load, { requiresAuth = false } = {}) {
  routes.push({ pattern, requiresAuth, load });
}

function match(pathname) {
  const segs = pathname.replace(/\/+$/, '').split('/');
  for (const route of routes) {
    const p = route.pattern.split('/');
    if (p.length !== segs.length) continue;
    const params = {};
    let ok = true;
    for (let i = 0; i < p.length; i++) {
      if (p[i].startsWith(':')) params[p[i].slice(1)] = decodeURIComponent(segs[i]);
      else if (p[i] !== segs[i]) { ok = false; break; }
    }
    if (ok) return { route, params };
  }
  return null;
}

export async function navigate(path, { replace = false } = {}) {
  if (replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  await render();
}

async function bootstrap() {
  try {
    const data = await api.get('/api/auth/me', { silent: true });
    store.setUser(data.user, data.csrf_token);
  } catch (_) {
    store.setUser(null, null);
  }
}

async function render() {
  if (!bootstrapped) {          // 首次渲染前先做一次会话恢复（/auth/me 引导）
    bootstrapped = true;
    await bootstrap();
  }
  const root = document.getElementById('app');
  const found = match(location.pathname) || { route: notFoundRoute, params: {} };
  const { route, params } = found;
  if (route.requiresAuth && !store.isLoggedIn()) {
    const back = encodeURIComponent(location.pathname + location.search);
    return navigate(`/login?redirect=${back}`, { replace: true });
  }
  root.innerHTML = '';
  renderHeader(store.user, location.pathname);
  await route.load(root, params);
}

const notFoundRoute = {
  requiresAuth: false,
  load(root) {
    root.innerHTML = '';
    const box = document.createElement('div');
    box.className = 'empty-state';
    box.innerHTML = '<h2>页面不存在</h2>';
    const a = document.createElement('a');
    a.href = '/'; a.className = 'btn btn-primary'; a.textContent = '返回首页';
    box.appendChild(a);
    root.appendChild(box);
  },
};

// 主页与关于页：Phase 2 交付静态视图
// 注意：不得使用内联 style 与内联事件，Phase 8 会启用不含 'unsafe-inline' 的严格 CSP
registerRoute('/', async (root) => {
  const { renderHome } = await import('./home.js');
  renderHome(root);
});

registerRoute('/about', async (root) => {
  const { renderAbout } = await import('./about.js');
  renderAbout(root);
});

// 登录 / 注册页（Phase 3）
registerRoute('/login', async (root) => (await import('./auth.js')).renderLogin(root));
registerRoute('/register', async (root) => (await import('./auth.js')).renderRegister(root));

// 登录态变化时只重绘顶栏，避免整页重渲染
store.onChange(() => renderHeader(store.user, location.pathname));

bindErrorToast(toast);
window.addEventListener('popstate', render);
window.addEventListener('csrf-invalid', async () => {
  try { const me = await api.get('/api/auth/me', { silent: true });
        store.setUser(me.user, me.csrf_token); toast('已刷新请求校验，请重试', 'info'); }
  catch (_) { store.setUser(null, null); }
});
document.addEventListener('DOMContentLoaded', render);
