import { store } from './store.js';

export class ApiError extends Error {
  constructor(code, message) { super(message); this.code = code; }
}

async function request(method, path, { body, formData, silent } = {}) {
  const headers = {};
  if (store.csrfToken) headers['X-CSRF-Token'] = store.csrfToken;
  let payload;
  if (formData) {
    payload = formData;
  } else if (body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(body);
  }

  const resp = await fetch(path, {
    method, headers, body: payload, credentials: 'same-origin',
  });

  let data = null;
  try { data = await resp.json(); } catch (_) { /* 非 JSON，交给下面兜底 */ }

  if (!data || typeof data.code !== 'string') {
    const err = new ApiError('INTERNAL_ERROR', '服务器开小差了，请稍后重试');
    if (!silent) showError(err.message);
    throw err;
  }
  if (data.code !== 'OK') {
    const err = new ApiError(data.code, data.message);
    if (!silent) showError(data.message);
    onApiError(err);
    throw err;
  }
  return data.data;
}

function onApiError(err) {
  if (err.code === 'UNAUTHORIZED') {
    store.setUser(null, null);
    const back = encodeURIComponent(location.pathname + location.search);
    location.assign(`/login?redirect=${back}`);
  }
  if (err.code === 'CSRF_INVALID') {
    window.dispatchEvent(new Event('csrf-invalid'));
  }
}

let showError = () => {};        // 由 router.js 注入 ui.toast，避免循环依赖
export function bindErrorToast(fn) { showError = fn; }

export const api = {
  get:    (p, o)       => request('GET', p, o),
  post:   (p, b, o)    => request('POST', p, { body: b, ...o }),
  put:    (p, b, o)    => request('PUT', p, { body: b, ...o }),
  del:    (p, o)       => request('DELETE', p, o),
  upload: (p, fd, o)   => request('POST', p, { formData: fd, ...o }),
};
