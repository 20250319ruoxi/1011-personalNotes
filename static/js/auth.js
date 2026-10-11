// auth.js — 登录 / 注册视图、字段级校验、会话恢复后的回跳与登录守卫落点。
// 约束：不使用内联 style 与内联事件（Phase 8 启用不含 'unsafe-inline' 的严格 CSP）。
import { api } from './api.js';
import { store } from './store.js';
import { navigate } from './router.js';

/* 字段级文案：键为后端错误码，值必须与 core/errors.py 逐字一致（由 tests/test_error_copy_sync.py 强制）。
   必须保持为合法 JSON 对象字面量（双引号键与值）。 */
export const FIELD_MESSAGES = {
  "EMAIL_INVALID": "请输入正确的邮箱地址",
  "PASSWORD_WEAK": "密码长度需为 8-64 位，且包含字母与数字",
  "PASSWORD_MISMATCH": "两次输入的密码不一致",
  "INVALID_PARAM": "参数不合法，请检查后重试"
};

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]{2,}$/;
const USERNAME_RE = /^\w{3,20}$/;

export function isEmail(value) {
  return EMAIL_RE.test(String(value == null ? '' : value).trim());
}

export function isUsername(value) {
  return USERNAME_RE.test(String(value == null ? '' : value).trim());
}

export function isStrongPassword(value) {
  const text = String(value == null ? '' : value);
  return text.length >= 8 && text.length <= 64 && /[A-Za-z]/.test(text) && /\d/.test(text);
}

/* 防开放重定向：只接受「以单个 / 开头且不以 // 开头」的站内相对路径，否则回退 fallback。
   工作台上线后（项目截图/02），登录/注册的默认落地页由 /me 改为 /dashboard。 */
export function resolveRedirect(value, fallback = '/dashboard') {
  if (typeof value !== 'string' || value === '') return fallback;
  if (value[0] !== '/') return fallback;
  if (value.startsWith('//')) return fallback;
  return value;
}

function currentRedirect() {
  try {
    return new URLSearchParams(location.search).get('redirect');
  } catch (_) {
    return null;
  }
}

/* 服务端错误码 → 应高亮的字段（邮箱类挂邮箱，密码类挂密码，参数类挂用户名）。 */
function fieldTarget(code, refs) {
  if (code === 'EMAIL_INVALID') return refs.email ? 'email' : null;
  if (code === 'PASSWORD_WEAK') return refs.password ? 'password' : null;
  if (code === 'PASSWORD_MISMATCH') {
    return refs.confirm ? 'confirm' : (refs.password ? 'password' : null);
  }
  if (code === 'INVALID_PARAM') {
    return refs.username ? 'username' : (refs.email ? 'email' : null);
  }
  return null;
}

/* ==========================================================================
   字段与表单构建
   ========================================================================== */

function createField(name, label, type, autocomplete) {
  const wrap = document.createElement('div');
  wrap.className = 'field';
  wrap.setAttribute('data-field', name);

  const labelEl = document.createElement('label');
  labelEl.setAttribute('for', 'field-' + name);
  labelEl.textContent = label;

  const input = document.createElement('input');
  input.id = 'field-' + name;
  input.setAttribute('name', name);
  input.type = type;
  input.setAttribute('autocomplete', autocomplete);
  input.setAttribute('aria-describedby', 'field-' + name + '-error');

  const error = document.createElement('p');
  error.className = 'field-error';
  error.setAttribute('role', 'alert');
  error.id = 'field-' + name + '-error';
  error.textContent = '';

  wrap.append(labelEl, input, error);
  return { name, wrap, input, error };
}

function setFieldError(ref, message) {
  if (message) {
    ref.input.classList.add('is-invalid');
    ref.input.setAttribute('aria-invalid', 'true');
    ref.error.textContent = message;
  } else {
    ref.input.classList.remove('is-invalid');
    ref.input.removeAttribute('aria-invalid');
    ref.error.textContent = '';
  }
}

function validateOne(ref, refs) {
  const value = ref.input.value;
  if (ref.name === 'email') return isEmail(value) ? null : 'EMAIL_INVALID';
  if (ref.name === 'username') return isUsername(value) ? null : 'INVALID_PARAM';
  if (ref.name === 'password') return isStrongPassword(value) ? null : 'PASSWORD_WEAK';
  if (ref.name === 'confirm') {
    const pwd = refs.password ? refs.password.input.value : '';
    return value === pwd ? null : 'PASSWORD_MISMATCH';
  }
  return null;
}

function buildAuthForm({ title, fieldSpecs, submitText, switchText, switchHref }) {
  const page = document.createElement('section');
  page.className = 'auth-page';

  const card = document.createElement('div');
  card.className = 'auth-card';

  const heading = document.createElement('h1');
  heading.textContent = title;

  const form = document.createElement('form');
  form.setAttribute('novalidate', '');

  const refs = {};
  fieldSpecs.forEach(([name, label, type, autocomplete]) => {
    const ref = createField(name, label, type, autocomplete);
    refs[name] = ref;
    form.appendChild(ref.wrap);
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'btn btn-primary';
  const btnTextEl = document.createElement('span');
  btnTextEl.className = 'btn-text';
  btnTextEl.textContent = submitText;
  submit.appendChild(btnTextEl);

  form.appendChild(submit);

  const footer = document.createElement('p');
  footer.className = 'auth-switch';
  const link = document.createElement('a');
  link.className = 'auth-switch-link';
  link.href = switchHref;
  link.textContent = switchText;
  footer.appendChild(link);

  card.append(heading, form, footer);
  page.appendChild(card);
  return { page, form, refs, submit, btnTextEl };
}

function setLoading(ctx, on) {
  const { submit, btnTextEl, submitText } = ctx;
  const spinner = submit.querySelector('.spinner');
  if (on) {
    submit.setAttribute('disabled', '');
    submit.disabled = true;
    submit.classList.add('is-loading');
    if (!spinner) {
      const spin = document.createElement('span');
      spin.className = 'spinner';
      spin.setAttribute('aria-hidden', 'true');
      submit.insertBefore(spin, btnTextEl);
    }
    btnTextEl.textContent = '提交中…';
  } else {
    submit.removeAttribute('disabled');
    submit.disabled = false;
    submit.classList.remove('is-loading');
    if (spinner) spinner.remove();
    btnTextEl.textContent = submitText;
  }
}

function attachValidation(ctx) {
  const { form, refs, submit, buildPayload, endpoint, validateAll } = ctx;

  Object.keys(refs).forEach((name) => {
    refs[name].input.addEventListener('blur', () => {
      const code = validateOne(refs[name], refs);
      setFieldError(refs[name], code ? FIELD_MESSAGES[code] : '');
    });
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const firstBad = validateAll(ctx);
    if (firstBad) { firstBad.input.focus(); return; }

    setLoading(ctx, true);
    try {
      const data = await api.post(endpoint, buildPayload(refs));
      store.setUser(data.user, data.csrf_token);
      navigate(resolveRedirect(ctx.target));
    } catch (err) {
      const code = err && err.code;
      const message = FIELD_MESSAGES[code];
      const target = fieldTarget(code, refs);
      if (message && target) setFieldError(refs[target], message);
    } finally {
      setLoading(ctx, false);
    }
  });
}

function validateAll(ctx) {
  let firstBad = null;
  Object.keys(ctx.refs).forEach((name) => {
    const ref = ctx.refs[name];
    const code = validateOne(ref, ctx.refs);
    setFieldError(ref, code ? FIELD_MESSAGES[code] : '');
    if (code && !firstBad) firstBad = ref;
  });
  return firstBad;
}

/* ==========================================================================
   视图导出
   ========================================================================== */

export function renderLogin(root, params = {}) {
  const target = (params && params.redirect) || currentRedirect();
  if (store.isLoggedIn()) {                       // 已登录访问登录页 → 直接回跳
    navigate(resolveRedirect(target), { replace: true });
    return;
  }

  const ctx = buildAuthForm({
    title: '登录',
    fieldSpecs: [
      ['email', '邮箱', 'email', 'email'],
      ['password', '密码', 'password', 'current-password'],
    ],
    submitText: '登录',
    switchText: '还没有账号？去注册',
    switchHref: '/register',
  });
  ctx.endpoint = '/api/auth/login';
  ctx.submitText = '登录';
  ctx.target = target;
  ctx.buildPayload = (refs) => ({
    email: refs.email.input.value.trim(),
    password: refs.password.input.value,
  });
  ctx.validateAll = validateAll;

  root.appendChild(ctx.page);
  attachValidation(ctx);
}

export function renderRegister(root) {
  const ctx = buildAuthForm({
    title: '注册',
    fieldSpecs: [
      ['email', '邮箱', 'email', 'email'],
      ['username', '用户名', 'text', 'username'],
      ['password', '密码', 'password', 'new-password'],
      ['confirm', '确认密码', 'password', 'new-password'],
    ],
    submitText: '注册',
    switchText: '已有账号？去登录',
    switchHref: '/login',
  });
  ctx.endpoint = '/api/auth/register';
  ctx.submitText = '注册';
  ctx.target = '/dashboard';
  ctx.buildPayload = (refs) => ({
    email: refs.email.input.value.trim(),
    username: refs.username.input.value.trim(),
    password: refs.password.input.value,
    confirm_password: refs.confirm.input.value,
  });
  ctx.validateAll = validateAll;

  root.appendChild(ctx.page);
  attachValidation(ctx);
}
