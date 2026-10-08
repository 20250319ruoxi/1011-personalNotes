/* render_auth.mjs — Phase 3 认证视图 / 登录守卫 渲染契约 harness。
 *
 * 本环境（Windows 无浏览器）无法执行真实浏览器，因此复用 tests/js/dom-shim.mjs
 * 在 Node 中真实调用 static/js/auth.js 的 renderLogin / renderRegister、ui.js 的
 * renderHeader（已登录态）以及 router.js 的登录守卫，再把结果序列化为 JSON 供
 * pytest 断言。fetch 用可控桩件替换，以覆盖提交 loading / 成功跳转 / 服务端错误映射。
 *
 * 用法：node tests/js/render_auth.mjs   →  stdout 打印一行 JSON
 */
import { installDom, serialize } from './dom-shim.mjs';

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

const tick = (ms = 20) => new Promise((resolve) => setTimeout(resolve, ms));

/* 可控 fetch 桩件 */
let fetchCalls = [];
let fetchImpl = async () => ({
  json: async () => ({ code: 'OK', message: '操作成功', data: {} }),
});
globalThis.fetch = (path, opts) => {
  fetchCalls.push({ path, opts });
  return fetchImpl(path, opts);
};

const errors = {};
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = err.message.split('\n')[0]; return fallback; }
};

const { store } = await import('../../static/js/store.js');
const { renderHeader } = await import('../../static/js/ui.js');
const { registerRoute, navigate } = await import('../../static/js/router.js');

const authModule = await import('../../static/js/auth.js')
  .catch((err) => ({ __importError: err.message.split('\n')[0] }));
if (authModule.__importError) errors.importAuth = authModule.__importError;
const {
  renderLogin, renderRegister, resolveRedirect, FIELD_MESSAGES,
} = authModule;

const resetViews = () => { appEl.innerHTML = ''; dialogRoot.innerHTML = ''; };

/* ---- 字段定位辅助（dom-shim 不支持后代组合选择器，逐层查找） ---- */
const fieldWrap = (root, name) =>
  root.querySelectorAll('[data-field]').find((el) => el.getAttribute('data-field') === name) || null;
const fieldInput = (root, name) => {
  const w = fieldWrap(root, name); return w ? w.querySelector('input') : null;
};
const fieldError = (root, name) => {
  const w = fieldWrap(root, name); return w ? w.querySelector('.field-error') : null;
};
const fieldList = (root) => root.querySelectorAll('[data-field]').map((w) => {
  const input = w.querySelector('input');
  const label = w.querySelector('label');
  return {
    name: w.getAttribute('data-field'),
    label: label ? label.textContent : '',
    type: input ? input.getAttribute('type') : '',
    autocomplete: input ? input.getAttribute('autocomplete') : '',
    errorRole: w.querySelector('.field-error') ? w.querySelector('.field-error').getAttribute('role') : '',
  };
});
const submitForm = (root) => {
  const form = root.querySelector('form');
  form.dispatchEvent({ type: 'submit', preventDefault() {} });
};
const btnText = (root) => {
  const t = root.querySelector('.btn-text');
  return t ? t.textContent : '';
};
const primaryBtn = (root) => root.querySelectorAll('button')
  .find((b) => b.className.includes('btn-primary')) || null;
const flush = async () => { await tick(); await tick(); await tick(); };

/* ==========================================================================
   登录守卫：注册一个受保护路由，未登录 navigate 应跳登录并带 redirect
   ========================================================================== */
const guard = {};
registerRoute('/guard-test', async () => {}, { requiresAuth: true });
fetchImpl = async () => ({ json: async () => ({ code: 'OK', message: '操作成功', data: { user: null, csrf_token: null } }) });
safe('guard', () => { historyCalls.length = 0; });
await safe('guard', () => { store.setUser(null, null); return navigate('/guard-test'); }, null);
await flush();
const guardCall = historyCalls[historyCalls.length - 1];
guard.guardRedirectUrl = guardCall ? guardCall.url : null;
guard.method = guardCall ? guardCall.method : null;
location.pathname = '/'; location.search = ''; location.hash = '';

/* 未注册路由（含 /me）：登录守卫不得崩溃，落到「页面不存在」视图 */
const missing = {};
store.setUser(null, null);
historyCalls.length = 0;
try {
  await navigate('/me');
} catch (err) {
  errors.missing = err.message.split('\n')[0];
}
await flush();
missing.url = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
missing.html = serialize(appEl);
location.pathname = '/'; location.search = '';

/* ==========================================================================
   登录页渲染
   ========================================================================== */
resetViews();
location.pathname = '/login'; location.search = '';
const loginHtml = safe('login', () => { renderLogin(appEl, {}); return serialize(appEl); }, null);
const loginFields = safe('loginFields', () => fieldList(appEl), []);
const loginTitle = safe('loginTitle', () => {
  const h1 = appEl.querySelector('h1'); return h1 ? h1.textContent : '';
}, '');
const loginFooter = safe('loginFooter', () => {
  const a = appEl.querySelectorAll('a').find((el) => el.className.includes('auth-switch'));
  return a ? { text: a.textContent, href: a.getAttribute('href') } : null;
}, null);
const loginSubmitText = safe('loginSubmitText', () => btnText(appEl), '');

/* 失焦校验：邮箱 */
const emailBlur = safe('emailBlur', () => {
  const input = fieldInput(appEl, 'email');
  input.value = 'abc';
  input.dispatchEvent({ type: 'blur' });
  return {
    error: fieldError(appEl, 'email').textContent,
    invalid: input.classList.contains('is-invalid'),
    ariaInvalid: input.getAttribute('aria-invalid'),
  };
}, null);
const emailClears = safe('emailClears', () => {
  const input = fieldInput(appEl, 'email');
  input.value = 'alice@example.com';
  input.dispatchEvent({ type: 'blur' });
  return {
    error: fieldError(appEl, 'email').textContent,
    invalid: input.classList.contains('is-invalid'),
  };
}, null);

/* 失焦校验：密码（登录页） */
const passwordBlur = safe('passwordBlur', () => {
  const input = fieldInput(appEl, 'password');
  input.value = 'abcdefgh';
  input.dispatchEvent({ type: 'blur' });
  return { error: fieldError(appEl, 'password').textContent,
           invalid: input.classList.contains('is-invalid') };
}, null);

/* 本地校验未过时不得发起请求 */
const blocked = safe('blocked', () => {
  fetchCalls = [];
  fieldInput(appEl, 'email').value = 'abc';
  fieldInput(appEl, 'password').value = 'abcdefgh';
  submitForm(appEl);
  return fetchCalls.length;
}, -1);

/* ==========================================================================
   登录提交：loading → 成功跳转
   ========================================================================== */
resetViews();
location.pathname = '/login';
location.search = '?redirect=' + encodeURIComponent('/notes/new');
store.setUser(null, null);

let pending = null;
const loginUser = { id: 1, username: 'alice', email: 'alice@example.com',
                    avatar: null, bio: null, created_at: '2026-01-01T00:00:00Z' };
fetchImpl = (path) => new Promise((resolve) => {
  pending = { path, resolve: () => resolve({
    json: async () => ({ code: 'OK', message: '登录成功',
                         data: { user: loginUser, csrf_token: 'csrf-1' } }) }) };
});
safe('loginRender', () => { renderLogin(appEl, {}); });
fieldInput(appEl, 'email').value = 'alice@example.com';
fieldInput(appEl, 'password').value = 'passw0rd';
historyCalls.length = 0;
submitForm(appEl);
await flush();

const loading = safe('loading', () => {
  const btn = primaryBtn(appEl);
  return {
    text: btnText(appEl),
    disabledAttr: btn ? btn.hasAttribute('disabled') : false,
    loadingClass: btn ? btn.classList.contains('is-loading') : false,
    spinner: btn ? !!btn.querySelector('.spinner') : false,
  };
}, null);

if (pending) pending.resolve();
await flush();
const loginNavUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
const loggedInUser = store.user ? store.user.username : null;
const loggedInCsrf = store.csrfToken;

/* 请求失败：服务端错误码映射到字段 */
resetViews();
location.pathname = '/login'; location.search = '';
store.setUser(null, null);
fetchImpl = async () => ({ json: async () => ({
  code: 'PASSWORD_WEAK', message: FIELD_MESSAGES.PASSWORD_WEAK, data: null }) });
safe('mappedRender', () => { renderLogin(appEl, {}); });
fieldInput(appEl, 'email').value = 'alice@example.com';
fieldInput(appEl, 'password').value = 'passw0rd';
submitForm(appEl);
await flush();
const mapped = safe('mapped', () => ({
  passwordError: fieldError(appEl, 'password').textContent,
  passwordInvalid: fieldInput(appEl, 'password').classList.contains('is-invalid'),
  emailError: fieldError(appEl, 'email').textContent,
}), null);

/* ==========================================================================
   注册页渲染 + 注册专属校验
   ========================================================================== */
resetViews();
location.pathname = '/register'; location.search = '';
store.setUser(null, null);
fetchImpl = async () => ({ json: async () => ({ code: 'OK', message: '注册成功',
  data: { user: loginUser, csrf_token: 'csrf-2' } }) });
const registerHtml = safe('register', () => { renderRegister(appEl); return serialize(appEl); }, null);
const registerFields = safe('registerFields', () => fieldList(appEl), []);
const registerFooter = safe('registerFooter', () => {
  const a = appEl.querySelectorAll('a').find((el) => el.className.includes('auth-switch'));
  return a ? { text: a.textContent, href: a.getAttribute('href') } : null;
}, null);

const registerValidation = safe('registerValidation', () => {
  const uname = fieldInput(appEl, 'username');
  uname.value = 'a'; uname.dispatchEvent({ type: 'blur' });
  const usernameError = fieldError(appEl, 'username').textContent;

  const pwd = fieldInput(appEl, 'password');
  pwd.value = 'abcdefgh'; pwd.dispatchEvent({ type: 'blur' });
  const passwordError = fieldError(appEl, 'password').textContent;
  const passwordInvalid = pwd.classList.contains('is-invalid');

  pwd.value = 'passw0rd'; pwd.dispatchEvent({ type: 'blur' });
  const passwordCleared = fieldError(appEl, 'password').textContent;

  const confirm = fieldInput(appEl, 'confirm');
  confirm.value = 'passw0rd2'; confirm.dispatchEvent({ type: 'blur' });
  const confirmError = fieldError(appEl, 'confirm').textContent;
  const confirmInvalid = confirm.classList.contains('is-invalid');

  return { usernameError, passwordError, passwordInvalid, passwordCleared,
           confirmError, confirmInvalid };
}, null);

/* ==========================================================================
   redirect 白名单判定（防开放重定向）
   ========================================================================== */
const redirect = safe('redirect', () => ({
  slash: resolveRedirect('/notes'),
  slashWithQuery: resolveRedirect('/notes?page=2'),
  doubleSlash: resolveRedirect('//evil.example'),
  absolute: resolveRedirect('https://evil.example'),
  empty: resolveRedirect(''),
  none: resolveRedirect(undefined),
  backslash: resolveRedirect('\\evil'),
}), null);

/* ==========================================================================
   顶栏已登录态 + 头像菜单 + 退出确认
   ========================================================================== */
location.pathname = '/notes/new'; location.search = '';
store.setUser(loginUser, 'csrf-1');
renderHeader(store.user, location.pathname);
const headerLoggedIn = safe('headerLoggedIn', () => serialize(headerEl), null);

const menu = safe('menu', () => {
  const avatarBtn = headerEl.querySelector('.avatar-btn');
  const menuEl = headerEl.querySelector('.avatar-menu');
  const before = { expanded: avatarBtn.getAttribute('aria-expanded'),
                   open: menuEl.classList.contains('is-open') };
  avatarBtn.click();
  const after = { expanded: avatarBtn.getAttribute('aria-expanded'),
                  open: menuEl.classList.contains('is-open'),
                  focusOnFirstItem: document.activeElement === menuEl.querySelector('a') };
  return { before, after,
           items: menuEl.querySelectorAll('a, button').map((el) => ({
             tag: el.tagName, text: el.textContent, href: el.getAttribute('href') || '',
           })) };
}, null);

let logoutResult = null;
safe('logoutDialog', () => {
  const menuEl = headerEl.querySelector('.avatar-menu');
  const logoutBtn = menuEl.querySelectorAll('button').find((b) => b.textContent.includes('退出登录'));
  logoutBtn.focus();     // 真实浏览器点击按钮会先聚焦，此处显式模拟
  logoutBtn.click();     // 打开二次确认
  const dialog = dialogRoot.querySelector('.dialog');
  logoutResult = {
    dialogTitle: dialog ? dialog.querySelector('.dialog-title').textContent : null,
    confirmText: dialog
      ? (dialog.querySelectorAll('button').find((b) => b.textContent.includes('退出登录')) || {})
          .textContent : null,
    role: dialog ? dialog.getAttribute('role') : '',
    ariaModal: dialog ? dialog.getAttribute('aria-modal') : '',
  };
  // Esc 关闭，焦点应回弹到触发按钮
  document.dispatchEvent({ type: 'keydown', key: 'Escape', preventDefault() {} });
  logoutResult.dialogClosedOnEsc = dialogRoot.querySelector('.dialog') === null;
  logoutResult.focusRestored = document.activeElement === logoutBtn;
});
await flush();

/* 确认退出：走通 logout 请求 + 清空 store + toast + 回首页 */
let confirmedLogout = null;
fetchCalls = [];
fetchImpl = async () => ({ json: async () => ({ code: 'OK', message: '已退出登录', data: null }) });
safe('confirmLogout', () => {
  store.setUser(loginUser, 'csrf-1');
  renderHeader(store.user, '/notes/new');
  headerEl.querySelector('.avatar-btn').click();
  const menuEl = headerEl.querySelector('.avatar-menu');
  menuEl.querySelectorAll('button').find((b) => b.textContent.includes('退出登录')).click();
  const dialog = dialogRoot.querySelector('.dialog');
  const confirmBtn = dialog.querySelectorAll('button').find((b) => b.textContent.includes('退出登录'));
  confirmBtn.click();
});
await flush();
confirmedLogout = safe('confirmedLogout', () => ({
  fetchPath: fetchCalls.length ? fetchCalls[0].path : null,
  user: store.user,
  navUrl: historyCalls.length ? historyCalls[historyCalls.length - 1].url : null,
  toastCount: toastRoot.children.length,
}), null);

process.stdout.write(JSON.stringify({
  errors,
  guard,
  missing,
  loginHtml,
  loginTitle,
  loginFields,
  loginFooter,
  loginSubmitText,
  emailBlur,
  emailClears,
  passwordBlur,
  blockedSubmitFetchCount: blocked,
  loading,
  loginNavUrl,
  loggedInUser,
  loggedInCsrf,
  mapped,
  registerHtml,
  registerFields,
  registerFooter,
  registerValidation,
  redirect,
  headerLoggedIn,
  menu,
  logoutDialog: logoutResult,
  confirmedLogout,
}) + '\n');
