/* render_notes.mjs — Phase 5 Task 2：笔记列表页 / 工具条 / 卡片 / 分页 渲染契约 harness。
 *
 * 复用 tests/js/dom-shim.mjs 最小 DOM 双端，在 Node 中真实调用 static/js/notes.js 的
 * renderNoteList / renderNoteGrid、ui.js 的 noteCard / pagination，并把结果序列化为 JSON
 * 供 pytest 断言。fetch 用可控桩件替换，覆盖骨架、数据、空态、筛选、排序、分页、防抖。
 *
 * 用法：node tests/js/render_notes.mjs  →  stdout 打印一行 JSON
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
const flush = async () => { await tick(); await tick(); await tick(); };

const errors = {};
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};

/* ---- 可控 fetch 桩件 ---- */
const NOTES = [
  { id: 11, title: '第一篇', status: 'draft', tags: ['生活', '随笔'],
    created_at: '2020-01-01T00:00:00Z', updated_at: '2020-01-02T03:04:05Z',
    summary: '这是第一篇的摘要' },
  { id: 12, title: '', status: 'public', tags: [],
    created_at: '2020-01-03T00:00:00Z', updated_at: '2020-01-04T03:04:05Z',
    summary: '' },
];

let listResponse = { items: NOTES, total: 25, page: 1, page_size: 10 };
const fetchCalls = [];
globalThis.fetch = async (path) => {
  fetchCalls.push(String(path));
  const respond = (data) => ({ json: async () => ({ code: 'OK', message: '操作成功', data }) });
  if (String(path).startsWith('/api/auth/me')) {
    return respond({ user: { id: 1, username: 'alice' }, csrf_token: 'csrf-1' });
  }
  if (String(path).startsWith('/api/tags')) {
    return respond({ items: [{ name: '生活', count: 3 }, { name: '工作', count: 2 }] });
  }
  if (String(path).startsWith('/api/notes')) return respond(listResponse);
  return respond(null);
};

const { store } = await import('../../static/js/store.js');
const uiModule = await import('../../static/js/ui.js');
const notesModule = await import('../../static/js/notes.js')
  .catch((err) => ({ __importError: String(err.message).split('\n')[0] }));
if (notesModule.__importError) errors.importNotes = notesModule.__importError;
const { renderNoteList, renderNoteGrid } = notesModule;
const { noteCard, pagination } = uiModule;
await import('../../static/js/router.js');   // 注册路由（含 /notes 守卫）

store.setUser({ id: 1, username: 'alice' }, 'csrf-1');

/* ---- DOM 查询辅助（dom-shim 不支持后代组合选择器） ---- */
const all = (root, sel) => root.querySelectorAll(sel);
const byText = (root, tag, text) =>
  all(root, tag).find((el) => el.textContent.trim() === text) || null;
const btnByText = (root, text) => byText(root, 'button', text);

let pageEl = null;
const render = async (search, response) => {
  appEl.innerHTML = '';
  location.pathname = '/notes';
  location.search = search || '';
  listResponse = response;
  historyCalls.length = 0;
  safe('renderNoteList', () => { pageEl = renderNoteList(appEl, {}); });
  const skeletonCount = all(appEl, '.skeleton').length;
  await flush();
  return skeletonCount;
};

/* ==========================================================================
   A. 工具条结构（无筛选）
   ========================================================================== */
const toolbar = {};
const skeletonCount = await render('', { items: NOTES, total: 25, page: 1, page_size: 10 });
toolbar.skeletonCount = skeletonCount;

safe('toolbar', () => {
  const bar = appEl.querySelector('.note-toolbar');
  toolbar.html = bar ? serialize(bar) : null;
  const buttons = all(bar, 'button');
  toolbar.statusButtons = buttons
    .filter((b) => ['全部', '草稿', '私密', '已分享'].includes(b.textContent.trim()))
    .map((b) => ({
      text: b.textContent.trim(),
      value: b.getAttribute('data-value'),
      active: b.classList.contains('is-active'),
      pressed: b.getAttribute('aria-pressed'),
    }));
  toolbar.sortButtons = buttons
    .filter((b) => ['按更新时间', '按创建时间'].includes(b.textContent.trim()))
    .map((b) => ({
      text: b.textContent.trim(),
      value: b.getAttribute('data-value'),
      active: b.classList.contains('is-active'),
      pressed: b.getAttribute('aria-pressed'),
    }));
  const select = bar.querySelector('select');
  toolbar.tagOptions = select
    ? select.querySelectorAll('option').map((o) => ({
        value: o.getAttribute('value') || '', text: o.textContent.trim() }))
    : null;
  const search = bar.querySelector('input');
  toolbar.search = search
    ? { type: search.getAttribute('type'), placeholder: search.getAttribute('placeholder'),
        ariaLabel: search.getAttribute('aria-label') }
    : null;
  toolbar.hasClear = !!btnByText(bar, '清除筛选');
}, null);

/* ==========================================================================
   B. 有数据：卡片与分页
   ========================================================================== */
const list = {};
safe('list', () => {
  const grid = appEl.querySelector('.note-grid');
  list.gridHtml = grid ? serialize(grid) : null;
  const cards = all(appEl, '.note-card');
  list.cardCount = cards.length;
  list.paperClass = cards.map((c) => c.classList.contains('paper'));
  list.titleTexts = cards.map((c) => {
    const h = c.querySelector('h3');
    return h ? h.textContent : null;
  });
  list.summaries = cards.map((c) => {
    const p = c.querySelector('.note-summary');
    return p ? p.textContent : null;
  });
  list.badges = cards.map((c) => {
    const b = c.querySelector('.badge');
    return b ? { text: b.textContent, cls: b.className } : null;
  });
  list.tags = all(appEl, '.tag-chip').map((li) => li.textContent);
  list.times = cards.map((c) => {
    const t = c.querySelector('.note-time');
    return t ? t.textContent : null;
  });
  list.hasSkeletonLeft = all(appEl, '.skeleton').length;
  const info = appEl.querySelector('.pagination-info');
  const total = appEl.querySelector('.pagination-total');
  list.paginationInfo = info ? info.textContent : null;
  list.paginationTotal = total ? total.textContent : null;
}, null);

/* 卡片点击 → /notes/<id> */
const cardClick = {};
safe('cardClick', () => {
  historyCalls.length = 0;
  all(appEl, '.note-card')[0].click();
});
await flush();
cardClick.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   C. 空态（无筛选）/ 空态（有筛选）
   ========================================================================== */
await render('', { items: [], total: 0, page: 1, page_size: 10 });
const emptyAll = {};
safe('emptyAll', () => {
  const box = appEl.querySelector('.empty-state');
  emptyAll.title = box ? box.querySelector('h2').textContent : null;
  const btn = box ? box.querySelector('button') : null;
  emptyAll.actionText = btn ? btn.textContent : null;
  historyCalls.length = 0;
  if (btn) btn.click();
});
await flush();
emptyAll.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
emptyAll.hasGrid = !!appEl.querySelector('.note-grid');

await render('?q=不存在', { items: [], total: 0, page: 1, page_size: 10 });
const emptyFiltered = {};
safe('emptyFiltered', () => {
  const box = appEl.querySelector('.empty-state');
  emptyFiltered.title = box ? box.querySelector('h2').textContent : null;
  const btn = box ? box.querySelector('button') : null;
  emptyFiltered.actionText = btn ? btn.textContent : null;
  historyCalls.length = 0;
  if (btn) btn.click();
});
await flush();
emptyFiltered.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   D. 清除筛选按钮（有筛选时才出现）
   ========================================================================== */
const clearFilters = {};
await render('?status=draft', { items: NOTES, total: 2, page: 1, page_size: 10 });
safe('clearFilters', () => {
  const bar = appEl.querySelector('.note-toolbar');
  const btn = btnByText(bar, '清除筛选');
  clearFilters.visible = !!btn;
  const draftBtn = btnByText(bar, '草稿');
  clearFilters.draftActive = draftBtn ? draftBtn.getAttribute('aria-pressed') : null;
  historyCalls.length = 0;
  if (btn) btn.click();
});
await flush();
clearFilters.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   E. 状态筛选 / 排序切换 → 地址栏
   ========================================================================== */
const statusClick = {};
await render('', { items: NOTES, total: 2, page: 1, page_size: 10 });
safe('statusClick', () => {
  const bar = appEl.querySelector('.note-toolbar');
  historyCalls.length = 0;
  btnByText(bar, '私密').click();
});
await flush();
statusClick.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
statusClick.search = location.search;

const sortClick = {};
await render('?status=draft', { items: NOTES, total: 2, page: 1, page_size: 10 });
safe('sortClick', () => {
  const bar = appEl.querySelector('.note-toolbar');
  historyCalls.length = 0;
  btnByText(bar, '按创建时间').click();
});
await flush();
sortClick.navUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   F. 分页：边界禁用与翻页
   ========================================================================== */
const pages = {};
await render('', { items: NOTES, total: 25, page: 1, page_size: 10 });
safe('pages', () => {
  const prev = appEl.querySelector('.pagination-prev');
  const next = appEl.querySelector('.pagination-next');
  pages.firstPrevDisabled = prev ? prev.disabled === true : null;
  pages.firstNextDisabled = next ? next.disabled === true : null;
  historyCalls.length = 0;
  if (next) next.click();
});
await flush();
pages.nextNavUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

await render('?page=3', { items: NOTES, total: 25, page: 3, page_size: 10 });
safe('pagesLast', () => {
  pages.lastInfo = appEl.querySelector('.pagination-info').textContent;
  const prev = appEl.querySelector('.pagination-prev');
  const next = appEl.querySelector('.pagination-next');
  pages.lastPrevDisabled = prev.disabled === true;
  pages.lastNextDisabled = next.disabled === true;
});

/* ==========================================================================
   G. 搜索防抖（300ms，跳转时 page 重置为 1）
   ========================================================================== */
const debounce = {};
await render('?page=2', { items: NOTES, total: 25, page: 2, page_size: 10 });
safe('debounceInput', () => {
  const bar = appEl.querySelector('.note-toolbar');
  const input = bar.querySelector('input');
  historyCalls.length = 0;
  input.value = '关键词';
  input.dispatchEvent({ type: 'input' });
  input.dispatchEvent({ type: 'input' });
});
await tick(150);
debounce.navBeforeWait = historyCalls.length;
await tick(220);
debounce.navAfterWait = historyCalls.length;
debounce.lastUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;

/* ==========================================================================
   H. noteCard 失效占位
   ========================================================================== */
const stale = {};
safe('stale', () => {
  let opened = 0;
  let removed = 0;
  const card = noteCard(
    { id: 99, available: false, title: null, status: 'private', tags: [], summary: null },
    { onOpen: () => { opened += 1; }, onRemove: () => { removed += 1; } },
  );
  stale.html = serialize(card);
  stale.className = card.className;
  stale.isStale = card.classList.contains('is-stale');
  stale.title = card.querySelector('h3').textContent;
  stale.hasSummary = !!card.querySelector('.note-summary');
  card.click();
  stale.openedOnCardClick = opened;
  const removeBtn = card.querySelector('button');
  stale.removeText = removeBtn ? removeBtn.textContent : null;
  if (removeBtn) removeBtn.click();
  stale.removedOnRemoveClick = removed;
}, null);

/* ==========================================================================
   I. pagination 单元
   ========================================================================== */
const pag = {};
safe('pagination', () => {
  const single = pagination({ page: 1, pageSize: 10, total: 0, onChange: () => {} });
  pag.single = {
    info: single.querySelector('.pagination-info').textContent,
    total: single.querySelector('.pagination-total').textContent,
    prevDisabled: single.querySelector('.pagination-prev').disabled === true,
    nextDisabled: single.querySelector('.pagination-next').disabled === true,
  };
  const picked = [];
  const mid = pagination({ page: 2, pageSize: 10, total: 25, onChange: (n) => picked.push(n) });
  pag.midInfo = mid.querySelector('.pagination-info').textContent;
  mid.querySelector('.pagination-prev').click();
  mid.querySelector('.pagination-next').click();
  pag.picked = picked;
}, null);

/* ==========================================================================
   J. renderNoteGrid 可独立复用（Phase 7 /me 将复用它）
   ========================================================================== */
const gridExport = {};
gridExport.isFunction = typeof renderNoteGrid === 'function';
let gridHost = null;
safe('gridHost', () => {
  gridHost = document.createElement('div');
  location.search = '';
  listResponse = { items: NOTES, total: 2, page: 1, page_size: 10 };
  if (gridExport.isFunction) {
    renderNoteGrid(gridHost, { status: 'all', q: '', tag: '', sort: 'updated', page: 1 });
  }
});
await flush();
safe('gridHostRead', () => {
  gridExport.hostHtml = serialize(gridHost);
  gridExport.hostCardCount = all(gridHost, '.note-card').length;
  gridExport.hostHasToolbar = !!gridHost.querySelector('.note-toolbar');
}, null);

/* ==========================================================================
   K. 路由注册与登录守卫
   ========================================================================== */
const guard = {};
store.setUser(null, null);
historyCalls.length = 0;
location.pathname = '/';
location.search = '';
safe('guard', () => {});
try { await (await import('../../static/js/router.js')).navigate('/notes'); } catch (err) {
  errors.guard = String(err.message).split('\n')[0];
}
await flush();
guard.lastUrl = historyCalls.length ? historyCalls[historyCalls.length - 1].url : null;
guard.method = historyCalls.length ? historyCalls[historyCalls.length - 1].method : null;
store.setUser({ id: 1, username: 'alice' }, 'csrf-1');

process.stdout.write(JSON.stringify({
  errors,
  skeletonCount,
  toolbar,
  list,
  cardClick,
  emptyAll,
  emptyFiltered,
  clearFilters,
  statusClick,
  sortClick,
  pages,
  debounce,
  stale,
  pagination: pag,
  gridExport,
  guard,
  fetchCalls,
}) + '\n');
