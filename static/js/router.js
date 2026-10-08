import { store } from './store.js';
import { api, bindErrorToast } from './api.js';
import { toast, renderHeader } from './ui.js';

const routes = [];   // { pattern, requiresAuth, load }

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

async function render() {
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

// Phase 1 占位视图，Phase 2 由 static/js/home.js 替换
// 注意：不得使用内联 style 与内联事件，Phase 8 会启用不含 'unsafe-inline' 的严格 CSP
registerRoute('/', (root) => {
  root.innerHTML = '<section class="paper paper-padded">'
    + '<h1>个人笔记</h1><p>骨架就绪，主页视图将在 Phase 2 实现。</p></section>';
});

bindErrorToast(toast);
window.addEventListener('popstate', render);
window.addEventListener('csrf-invalid', async () => {
  try { const me = await api.get('/api/auth/me', { silent: true });
        store.setUser(me.user, me.csrf_token); toast('已刷新请求校验，请重试', 'info'); }
  catch (_) { store.setUser(null, null); }
});
document.addEventListener('DOMContentLoaded', render);
