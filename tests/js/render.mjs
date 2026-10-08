/* render.mjs — 在 Node 中用 dom-shim 真实调用 static/js 的渲染函数，
 * 输出序列化后的 HTML 与按钮跳转目标，供 pytest 断言。
 *
 * 各区块独立 try/catch：home.js / about.js 尚未实现时，顶栏断言仍可单独验证。
 * 用法：node tests/js/render.mjs   →  stdout 打印一行 JSON
 */
import { installDom, serialize } from './dom-shim.mjs';

const dom = installDom();
const { document, window, historyCalls, fireWindow } = dom;

const headerEl = document.createElement('header');
headerEl.id = 'app-header';
const appEl = document.createElement('main');
appEl.id = 'app';
document.body.append(headerEl, appEl);

const tick = () => new Promise((resolve) => setTimeout(resolve, 30));
const errors = {};
// 路由切换触发的异步渲染失败（例如目标视图尚未实现）不应让整个 harness 崩溃
process.on('unhandledRejection', (err) => {
  errors.unhandled = String((err && err.message) || err).split('\n')[0];
});
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = err.message.split('\n')[0]; return fallback; }
};

const { store } = await import('../../static/js/store.js');
const { renderHeader } = await import('../../static/js/ui.js');
await import('../../static/js/router.js');                    // 注册路由

/* ---- 顶栏：对 / 与 /about 与 /login 各渲染一次 ---- */
const headerHome = safe('headerHome', () => { renderHeader(null, '/'); return serialize(headerEl); }, null);
const headerAbout = safe('headerAbout', () => { renderHeader(null, '/about'); return serialize(headerEl); }, null);
const headerLogin = safe('headerLogin', () => { renderHeader(null, '/login'); return serialize(headerEl); }, null);

/* ---- 顶栏交互：滚动阴影 / 抽屉开关 / Esc 关闭并回焦 / 遮罩点击关闭 ---- */
const interactions = {};
safe('headerInteractions', () => {
  renderHeader(null, '/');
  const header = document.getElementById('app-header');
  const nav = header.querySelector('.app-nav');
  const toggleBtn = header.querySelector('.nav-toggle');
  const drawer = document.getElementById('nav-drawer');
  const scrim = header.querySelector('.nav-scrim');

  window.scrollY = 20;
  fireWindow('scroll');
  interactions.scrolledClass = header.classList.contains('is-scrolled');
  window.scrollY = 0;
  fireWindow('scroll');
  interactions.unscrolledClass = header.classList.contains('is-scrolled');

  toggleBtn.click();
  interactions.openExpanded = toggleBtn.getAttribute('aria-expanded');
  interactions.openLabel = toggleBtn.getAttribute('aria-label');
  interactions.openDrawer = drawer.classList.contains('is-open');
  interactions.openScrim = scrim.classList.contains('is-visible');
  interactions.focusMovedIntoDrawer = document.activeElement === drawer.querySelector('a');

  nav.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  interactions.closedExpanded = toggleBtn.getAttribute('aria-expanded');
  interactions.closedDrawer = drawer.classList.contains('is-open');
  interactions.closedScrim = scrim.classList.contains('is-visible');
  interactions.closedFocusOnToggle = document.activeElement === toggleBtn;

  toggleBtn.click();
  scrim.click();
  interactions.scrimClickClosed = !drawer.classList.contains('is-open');
}, null);

/* ---- 主页 ---- */
const homeModule = await import('../../static/js/home.js')
  .catch((err) => { errors.importHome = err.message.split('\n')[0]; return {}; });
const renderHome = homeModule.renderHome;

let home = null;
let homeButtons = [];
if (typeof renderHome === 'function') {
  home = safe('home', () => { appEl.innerHTML = ''; renderHome(appEl); return serialize(appEl); }, null);
  homeButtons = appEl.querySelectorAll('button')
    .map((b) => ({ text: b.textContent.trim(), cls: b.className }));
}

/* ---- 按钮跳转：未登录 / 已登录 ---- */
const clickByText = (text) => {
  const btn = appEl.querySelectorAll('button').find((b) => b.textContent.includes(text));
  return btn || null;
};
let navLoggedOutPrimary = '';
let navLoggedOutSecondary = '';
let navLoggedInPrimary = '';

if (typeof renderHome === 'function' && home !== null) {
  safe('navLoggedOut', () => {
    store.setUser(null, null);
    historyCalls.length = 0;
    const primary = clickByText('开始记录');
    if (primary) primary.click();
    navLoggedOutPrimary = historyCalls.map((c) => c.url).join('|');
  }, null);

  safe('navSecondary', () => {
    // 上一次点击会经由路由替换 #app 内容，这里重新渲染主页再点第二个按钮
    appEl.innerHTML = '';
    renderHome(appEl);
    historyCalls.length = 0;
    const secondary = clickByText('了解更多');
    if (secondary) secondary.click();
    navLoggedOutSecondary = historyCalls.map((c) => c.url).join('|');
  }, null);

  await tick();

  safe('navLoggedIn', () => {
    appEl.innerHTML = '';
    renderHome(appEl);
    store.setUser({ id: 1, username: 'alice' }, 'csrf-x');
    historyCalls.length = 0;
    const primary = clickByText('开始记录');
    if (primary) primary.click();
    navLoggedInPrimary = historyCalls.map((c) => c.url).join('|');
  }, null);
  store.setUser(null, null);
  await tick();
}

/* ---- 关于页 ---- */
const aboutModule = await import('../../static/js/about.js')
  .catch((err) => { errors.importAbout = err.message.split('\n')[0]; return {}; });
let about = null;
if (typeof aboutModule.renderAbout === 'function') {
  about = safe('about', () => {
    appEl.innerHTML = '';
    aboutModule.renderAbout(appEl);
    return serialize(appEl);
  }, null);
}

process.stdout.write(JSON.stringify({
  errors,
  headerHome,
  headerAbout,
  headerLogin,
  interactions,
  home,
  homeButtons,
  about,
  navLoggedOutPrimary,
  navLoggedOutSecondary,
  navLoggedInPrimary,
}) + '\n');
