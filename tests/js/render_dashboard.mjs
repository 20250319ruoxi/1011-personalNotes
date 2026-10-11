/* render_dashboard.mjs — 工作台（/dashboard）契约 harness。
 *
 * 背景：工作台的三张统计卡曾把「已发布」算成 `status=private` 的条数，
 * 而「已分享」（status=public）既不属于草稿也不属于 private，于是明明有已分享的
 * 文章，工作台却显示「已发布 0」。现改为「全部 − 草稿」，本 harness 用可控的
 * fetch 桩件锁住这个口径，并覆盖最近文章列表、按钮跳转与空态。
 *
 * 用法：node tests/js/render_dashboard.mjs   →  stdout 打印一行 JSON
 */
import { installDom } from './dom-shim.mjs';

const dom = installDom();
const { document, historyCalls } = dom;

const headerEl = document.createElement('header');
headerEl.id = 'app-header';
const appEl = document.createElement('main');
appEl.id = 'app';
const toastRoot = document.createElement('div');
toastRoot.id = 'toast-root';
const dialogRoot = document.createElement('div');
dialogRoot.id = 'dialog-root';
document.body.append(headerEl, appEl, toastRoot, dialogRoot);

const errors = {};
const safe = async (key, fn, fallback = null) => {
  try {
    return await fn();
  } catch (err) {
    errors[key] = String(err.message).split('\n')[0];
    return fallback;
  }
};
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const flush = async () => { await tick(); await tick(); await tick(); };
const field = (root, sel) => root.querySelector(sel);
const all = (root, sel) => root.querySelectorAll(sel);

const { store } = await import('../../static/js/store.js');
store.setUser({ id: 1, username: 'alice' }, 'csrf-1');

/* 桩件口径：1 篇草稿 + 1 篇私密 + 1 篇已分享 = 全部 3 篇 → 已发布应为 2 */
const TOTAL = 3;
const DRAFT = 1;
const FAVORITES = 2;
const RECENT = [
  { id: 9, title: '已分享的那篇', status: 'public', updated_at: '2026-10-11T00:00:00Z' },
  { id: 8, title: '私密的一篇', status: 'private', updated_at: '2026-10-10T00:00:00Z' },
  { id: 7, title: '', status: 'draft', updated_at: '2026-10-09T00:00:00Z' },
];
const fetchCalls = [];
let emptyMode = false;

globalThis.fetch = async (path) => {
  const url = String(path);
  fetchCalls.push(url);
  const body = (data) => ({ json: async () => ({ code: 'OK', message: '操作成功', data }) });
  if (url.startsWith('/api/auth/me')) return body({ user: { id: 1, username: 'alice' }, csrf_token: 'csrf-1' });
  if (url.startsWith('/api/favorites')) {
    return body({ items: [], total: emptyMode ? 0 : FAVORITES, page: 1, page_size: 1 });
  }
  if (url.startsWith('/api/notes?sort=updated')) {
    return body({ items: emptyMode ? [] : RECENT, total: emptyMode ? 0 : RECENT.length, page: 1, page_size: 5 });
  }
  if (url === '/api/notes?page_size=1') {
    return body({ items: [], total: emptyMode ? 0 : TOTAL, page: 1, page_size: 1 });
  }
  if (url === '/api/notes?status=draft&page_size=1') {
    return body({ items: [], total: emptyMode ? 0 : DRAFT, page: 1, page_size: 1 });
  }
  /* 其它笔记列表请求（跳转后可能触发）给一个安全的空列表，避免噪声报错 */
  if (url.startsWith('/api/notes')) {
    return body({ items: [], total: 0, page: 1, page_size: 10 });
  }
  return body(null);
};

const { renderDashboard } = await import('../../static/js/dashboard.js');

const view = {};

await safe('render', async () => renderDashboard(appEl));
await flush();

safe('collect', () => {
  view.fetchedPaths = fetchCalls.slice();
  view.title = field(appEl, '.dash-title') ? field(appEl, '.dash-title').textContent : null;
  view.headButtons = all(appEl, 'button')
    .filter((b) => String(b.className).includes('btn-'))
    .map((b) => b.textContent.trim());
  view.stats = all(appEl, '.dash-stat').map((card) => ({
    label: field(card, '.dash-stat-label') ? field(card, '.dash-stat-label').textContent : null,
    value: field(card, '.dash-stat-value') ? field(card, '.dash-stat-value').textContent : null,
  }));
  view.statLabels = view.stats.map((s) => s.label);
  view.statValues = view.stats.map((s) => s.value);
  view.recentHeading = field(appEl, 'h2') ? field(appEl, 'h2').textContent : null;
  view.rows = all(appEl, '.dash-row').map((row) => ({
    title: field(row, '.dash-row-title') ? field(row, '.dash-row-title').textContent : null,
    badge: field(row, '.badge-ok, .badge-tag')
      ? field(row, '.badge-ok, .badge-tag').textContent : null,
    time: field(row, '.dash-row-time') ? field(row, '.dash-row-time').textContent : null,
  }));
  view.foot = field(appEl, '.dash-foot') ? field(appEl, '.dash-foot').textContent : null;
});

/* 按钮跳转：点击会触发真实 navigate()，渲染会被替换，因此每次点击前重新挂载工作台 */
const clickAndRead = async (label) => {
  appEl.textContent = '';
  store.dirty = false;
  await safe(`render-${label}`, async () => renderDashboard(appEl));
  await flush();
  historyCalls.length = 0;
  const btn = all(appEl, 'button').find((b) => b.textContent.trim() === label);
  if (!btn) return null;
  await safe(`click-${label}`, async () => { btn.click(); });
  await flush();
  return historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
};

view.afterCreateUrl = await clickAndRead('新建文章');
view.afterMineUrl = await clickAndRead('我的文章');

/* 空态：没有任何文章时最近文章区给出引导文案，三张卡均为 0 */
emptyMode = true;
const emptyApp = document.createElement('main');
emptyApp.id = 'app-empty';
document.body.append(emptyApp);
await safe('renderEmpty', async () => renderDashboard(emptyApp));
await flush();
view.emptyText = field(emptyApp, '.dash-empty') ? field(emptyApp, '.dash-empty').textContent : null;
view.emptyStatValues = all(emptyApp, '.dash-stat-value').map((el) => el.textContent);

process.stdout.write(JSON.stringify({ errors, view }) + '\n');
