/* render_profile.mjs — Phase 7 Task 3：个人主页四 Tab 渲染契约 harness。
 *
 * 复用 tests/js/dom-shim.mjs 最小 DOM 双端，在 Node 中真实调用 static/js/profile.js 的
 * renderProfile、static/js/notes.js 的 renderNoteGrid、static/js/ui.js 的 staleCard /
 * favoriteButton，把结果序列化成 JSON 供 pytest 断言。
 *
 * 覆盖：四个 Tab 的标签/激活态/URL 同步、个人信息卡片与资料保存（含 store 同步与顶栏重绘）、
 * 改密本地校验（复用 auth.js 的 FIELD_MESSAGES）、「我的笔记」工具条与网格复用、
 * 「我的收藏」「浏览足迹」的可用/失效条目、移除/取消收藏/清空流程、三处空态文案、
 * DOM 顺序（Tab 可达性近似）与 /me 的登录守卫。
 *
 * 注意：最小 DOM 双端不支持后代选择器（`.a b`），本文件一律先取容器、再在容器内部查询。
 *
 * 用法：node tests/js/render_profile.mjs  ->  stdout 打印一行 JSON
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
const flush = async () => { for (let i = 0; i < 6; i += 1) await tick(); };

const errors = {};
const safe = (key, fn, fallback = null) => {
  try { return fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};
const safeAsync = async (key, fn, fallback = null) => {
  try { return await fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};

window.marked = { parse: (source) => `MD[${source}]` };
window.DOMPurify = { addHook() {}, sanitize: (html) => `SAN${html}` };

const USER = {
  id: 1, username: 'alice', email: 'alice@example.com', avatar: null,
  bio: '', created_at: '2020-01-02T03:04:05Z',
};
const RECENT = new Date(Date.now() - 5 * 60 * 1000).toISOString();

const NOTES = {
  items: [{
    id: 41, title: '我的笔记', summary: '摘要内容', tags: ['生活'],
    status: 'private', updated_at: '2020-01-02T03:04:05Z',
  }],
  total: 1, page: 1, page_size: 10,
};

const FAVORITES = {
  items: [
    {
      note: {
        id: 21, status: 'public', title: '收藏·可用', summary: '收藏摘要',
        tags: ['生活'], updated_at: '2020-01-02T03:04:05Z',
      },
      author: { username: 'bob', avatar: null },
      available: true, favorited_at: '2020-02-01T00:00:00Z',
      share_url: '/s/tok-21',            // 他人分享的笔记只能经分享页打开
    },
    {
      note: { id: 22, status: 'private', title: null, summary: null, tags: [], updated_at: null },
      author: { username: 'bob', avatar: null },
      available: false, favorited_at: '2020-01-31T00:00:00Z',
    },
  ],
  total: 2, page: 1, page_size: 10,
};

const HISTORY = {
  items: [
    {
      note: { id: 31, status: 'public', title: '足迹·可用', summary: '足迹摘要', tags: ['随笔'] },
      author: { username: 'bob', avatar: null },
      available: true, viewed_at: RECENT,
      share_url: '/s/tok-31',
    },
    {
      note: { id: 32, status: 'private', title: null, summary: null, tags: [] },
      author: { username: 'bob', avatar: null },
      available: false, viewed_at: '2020-03-02T10:00:00Z',
    },
  ],
  total: 2, page: 1, page_size: 10,
};

let loggedIn = true;
let favoritesData = FAVORITES;
let historyData = HISTORY;
let notesData = NOTES;
let passwordPutMode = 'ok';
const fetchCalls = [];

globalThis.fetch = async (path, opts = {}) => {
  const url = String(path);
  const method = opts.method || 'GET';
  fetchCalls.push({ path: url, method, body: opts.body || null });
  const okBody = (data, message = '操作成功') => ({ json: async () => ({ code: 'OK', message, data }) });
  const errBody = (code, message) => ({ json: async () => ({ code, message, data: null }) });

  if (url.startsWith('/api/auth/me')) {
    return okBody(loggedIn
      ? { user: { ...USER }, csrf_token: 'csrf-1' }
      : { user: null, csrf_token: null });
  }

  if (url.startsWith('/api/users/me/profile')) {
    if (method === 'PUT') {
      let sent = null;
      try { sent = JSON.parse(opts.body); } catch (_) { sent = null; }
      return okBody({ user: { ...USER, username: sent.username, bio: sent.bio } }, '已保存');
    }
    return okBody({ user: { ...USER } });
  }

  if (url.startsWith('/api/users/me/password')) {
    if (passwordPutMode === 'wrong') return errBody('PASSWORD_WRONG', '原密码不正确');
    return okBody(null, '密码已修改');
  }

  if (url.startsWith('/api/favorites')) {
    if (method === 'DELETE') {
      const removed = Number(url.split('/').pop());
      favoritesData = {
        ...favoritesData,
        items: favoritesData.items.filter((i) => i.note.id !== removed),
        total: Math.max(0, favoritesData.total - 1),
      };
      return okBody(null, '已取消收藏');
    }
    return okBody(favoritesData);
  }

  if (url.startsWith('/api/history')) {
    if (method === 'DELETE') {
      if (url === '/api/history') {
        historyData = { items: [], total: 0, page: 1, page_size: 10 };
      } else {
        const removed = Number(url.split('/').pop());
        historyData = {
          ...historyData,
          items: historyData.items.filter((i) => i.note.id !== removed),
          total: Math.max(0, historyData.total - 1),
        };
      }
      return okBody(null, '已清空浏览记录');
    }
    return okBody(historyData);
  }

  if (url.startsWith('/api/notes/')) {
    return okBody({ note: { id: 21, title: '收藏·可用', content_md: '正文', status: 'private', tags: [] } });
  }
  if (url.startsWith('/api/notes')) return okBody(notesData);
  if (url.startsWith('/api/tags')) {
    return okBody({ items: [{ name: '生活', count: 2 }, { name: '随笔', count: 1 }] });
  }
  return okBody(null);
};

const { store } = await import('../../static/js/store.js');
await import('../../static/js/router.js');
const uiModule = await import('../../static/js/ui.js');
const staleCard = uiModule.staleCard;
const favoriteButton = uiModule.favoriteButton;
const profileModule = await import('../../static/js/profile.js')
  .catch((err) => ({ __importError: String(err.message).split('\n')[0] }));
if (profileModule.__importError) errors.importProfile = profileModule.__importError;
const renderProfile = profileModule.renderProfile;

const all = (root, sel) => (root ? root.querySelectorAll(sel) : []);
const field = (root, sel) => (root ? root.querySelector(sel) : null);
const texts = (list) => list.map((el) => el.textContent.trim());
const textOf = (root, sel) => (field(root, sel) ? field(root, sel).textContent : null);
const inEach = (root, outer, inner) => all(root, outer).map((el) => textOf(el, inner));
const btnByText = (root, text) =>
  all(root, 'button').find((b) => b.textContent.trim() === text) || null;
const lastToast = () => (toastRoot.children.length
  ? toastRoot.children[toastRoot.children.length - 1].textContent : null);
const lastNav = () => (historyCalls.length ? historyCalls[historyCalls.length - 1].url : null);

/* 最小 DOM 双端不做事件冒泡，这里补一层真实的冒泡语义：同一个 event 对象依次派发给祖先，
   被测代码调用 event.stopPropagation() 即中断。返回是否调用过，用于验证「取消收藏」
   既发起 DELETE，又不会把点击冒泡到卡片而误触发「打开笔记」。 */
const realClick = (el) => {
  let stopped = false;
  const event = {
    type: 'click',
    target: el,
    preventDefault() {},
    stopPropagation() { stopped = true; },
  };
  let node = el;
  while (node && !stopped) {
    node.dispatchEvent(event);
    node = node.parentNode;
  }
  return stopped;
};

const resetShell = () => {
  appEl.innerHTML = '';
  toastRoot.innerHTML = '';
  dialogRoot.innerHTML = '';
  historyCalls.length = 0;
  fetchCalls.length = 0;
  document.title = '个人笔记';
};

store.setUser({ ...USER }, 'csrf-1');
let storeNotifications = 0;
store.onChange(() => { storeNotifications += 1; });

const renderTab = async (tab, search = '') => {
  resetShell();
  location.pathname = '/me';
  location.search = search || (tab && tab !== 'info' ? `?tab=${tab}` : '');
  await safeAsync('renderProfile', async () => { renderProfile(appEl, tab ? { tab } : {}); });
  await flush();
  return field(appEl, '.profile-panel');
};
const tabButtons = () => {
  const bar = field(appEl, '.profile-tabs');
  return bar ? all(bar, 'button') : [];
};
const activeTabLabel = () => {
  const active = tabButtons().filter((b) => b.classList.contains('is-active'));
  return active.length ? active[0].textContent.trim() : null;
};

/* A. Tab 栏：标签 / 激活态 / URL 同步 */
const tabs = {};
await renderTab('info');
safe('tabs', () => {
  tabs.exists = !!field(appEl, '.profile-tabs');
  tabs.hasPanel = !!field(appEl, '.profile-panel');
  tabs.labels = texts(tabButtons());
  tabs.roles = tabButtons().map((b) => b.getAttribute('role'));
  tabs.activeCount = tabButtons().filter((b) => b.classList.contains('is-active')).length;
  tabs.activeLabel = activeTabLabel();
  tabs.activeCurrent = tabButtons()
    .filter((b) => b.classList.contains('is-active'))
    .map((b) => b.getAttribute('aria-current'))[0] || null;
  tabs.inactiveCurrent = tabButtons()
    .filter((b) => !b.classList.contains('is-active'))
    .map((b) => b.getAttribute('aria-current'));
});

await renderTab(undefined, '?tab=history');
safe('tabFromUrl', () => { tabs.urlActiveLabel = activeTabLabel(); });

await renderTab(undefined, '?tab=__nope__');
safe('tabInvalid', () => { tabs.invalidActiveLabel = activeTabLabel(); });

await renderTab('info');
historyData = { items: [], total: 0, page: 1, page_size: 10 };   // 空态证明切到了「浏览足迹」
await safeAsync('tabClick', async () => {
  const btn = btnByText(field(appEl, '.profile-tabs'), '浏览足迹');
  if (btn) btn.click();
});
await flush();
safe('tabClickRead', () => {
  tabs.clickedUrl = lastNav();
  tabs.clickedMethod = historyCalls.length ? historyCalls[historyCalls.length - 1].method : null;
  tabs.afterClickActive = activeTabLabel();
  tabs.afterClickHasClear = !!btnByText(appEl, '清空浏览记录');
  tabs.afterClickCards = all(appEl, '.note-card').length;
  const box = field(appEl, '.empty-state');
  tabs.afterClickEmptyText = box ? textOf(box, 'h2') : null;
});
historyData = HISTORY;

/* B. 个人信息 Tab */
const info = {};
await renderTab('info');
safe('info', () => {
  const card = field(appEl, '.profile-card');
  info.hasCard = !!card;
  info.cardPaper = card ? card.classList.contains('paper') : null;
  info.html = card ? serialize(card) : null;

  const avatar = field(appEl, '.profile-avatar');
  info.avatarText = avatar ? avatar.textContent.trim() : null;
  info.avatarClass = avatar ? avatar.className : null;
  info.avatarHasImg = avatar ? !!field(avatar, 'img') : null;

  info.username = textOf(appEl, '.profile-username');
  info.email = textOf(appEl, '.profile-email');
  info.bio = textOf(appEl, '.profile-bio');
  info.joined = textOf(appEl, '.profile-joined');

  const form = field(appEl, '.profile-form');
  info.hasForm = !!form;
  const inputs = all(form, 'input');
  const areas = all(form, 'textarea');
  info.usernamePrefill = inputs.length ? inputs[0].value : null;
  info.bioMaxlength = areas.length ? areas[0].getAttribute('maxlength') : null;
  info.hasSaveButton = !!btnByText(form, '保存资料');
  info.formLabelCount = all(form, 'label').length;

  const pwForm = field(appEl, '.profile-password-form');
  info.hasPasswordForm = !!pwForm;
  const pwInputs = all(pwForm, 'input');
  info.passwordInputs = pwInputs.map((i) => i.getAttribute('name'));
  info.passwordNames = info.passwordInputs;
  info.passwordTypes = pwInputs.map((i) => i.type);
  info.hasPasswordButton = !!btnByText(pwForm, '修改密码');
  info.passwordErrorClass = field(pwForm, '.profile-password-error')
    ? field(pwForm, '.profile-password-error').className : null;
});

store.setUser({ ...USER, avatar: '/static/uploads/u1-a.png', bio: '一句话简介' }, 'csrf-1');
await renderTab('info');
safe('infoAvatarRead', () => {
  const avatar = field(appEl, '.profile-avatar');
  const img = avatar ? field(avatar, 'img') : null;
  info.avatarImgSrc = img ? img.getAttribute('src') : null;
  info.avatarImgAlt = img ? img.getAttribute('alt') : null;
  info.bioFilled = textOf(appEl, '.profile-bio');
});
store.setUser({ ...USER }, 'csrf-1');

/* C. 保存资料 -> PUT + store 同步 + 顶栏即时更新 */
const save = {};
await renderTab('info');
storeNotifications = 0;
await safeAsync('saveProfile', async () => {
  const form = field(appEl, '.profile-form');
  all(form, 'input')[0].value = 'zoe';
  all(form, 'textarea')[0].value = '新的简介';
  const btn = btnByText(form, '保存资料');
  if (form) form.dispatchEvent({ type: 'submit', preventDefault() {} });
  if (btn) btn.click();
  await flush();
});
safe('saveProfileRead', () => {
  const put = fetchCalls.find((c) => c.method === 'PUT' && c.path.startsWith('/api/users/me/profile'));
  save.putPath = put ? put.path : null;
  save.putBody = put ? put.body : null;
  save.storeUsername = store.user ? store.user.username : null;
  save.storeBio = store.user ? store.user.bio : null;
  save.storeNotifications = storeNotifications;
  save.toast = lastToast();
  save.cardUsername = textOf(appEl, '.profile-username');
  save.cardBio = textOf(appEl, '.profile-bio');
  const avatarBtn = field(headerEl, '.avatar-btn');   // 改版后应为 null（头像菜单已移除）
  save.headerAvatarText = avatarBtn ? avatarBtn.textContent.trim() : null;
  save.headerText = serialize(headerEl);
});
store.setUser({ ...USER }, 'csrf-1');

/* D. 修改密码：本地校验（复用 auth.js 的 FIELD_MESSAGES） */
const password = {};
const fillPassword = (oldPw, newPw, confirmPw) => {
  const pwForm = field(appEl, '.profile-password-form');
  const inputs = all(pwForm, 'input');
  inputs[0].value = oldPw;
  inputs[1].value = newPw;
  inputs[2].value = confirmPw;
  if (pwForm) pwForm.dispatchEvent({ type: 'submit', preventDefault() {} });
};

await renderTab('info');
await safeAsync('passwordWeak', async () => {
  fillPassword('passw0rd', 'abcdefgh', 'abcdefgh');
  await flush();
});
safe('passwordWeakRead', () => {
  password.weakError = textOf(appEl, '.profile-password-error');
  password.weakRequests = fetchCalls
    .filter((c) => c.method === 'PUT' && c.path.startsWith('/api/users/me/password')).length;
});

await renderTab('info');
await safeAsync('passwordMismatch', async () => {
  fillPassword('passw0rd', 'newpass12', 'newpass34');
  await flush();
});
safe('passwordMismatchRead', () => {
  password.mismatchError = textOf(appEl, '.profile-password-error');
  password.mismatchRequests = fetchCalls
    .filter((c) => c.method === 'PUT' && c.path.startsWith('/api/users/me/password')).length;
});

await renderTab('info');
await safeAsync('passwordOk', async () => {
  fillPassword('passw0rd', 'newpass12', 'newpass12');
  await flush();
});
safe('passwordOkRead', () => {
  const put = fetchCalls.find((c) => c.method === 'PUT' && c.path.startsWith('/api/users/me/password'));
  password.putPath = put ? put.path : null;
  password.putBody = put ? put.body : null;
  password.toast = lastToast();
  password.clearedValues = all(field(appEl, '.profile-password-form'), 'input').map((i) => i.value);
  password.errorAfterOk = textOf(appEl, '.profile-password-error');
});

passwordPutMode = 'wrong';
await renderTab('info');
await safeAsync('passwordServerError', async () => {
  fillPassword('wrongold', 'newpass12', 'newpass12');
  await flush();
});
safe('passwordServerErrorRead', () => { password.serverToast = lastToast(); });
passwordPutMode = 'ok';

/* E. 我的笔记 Tab */
const notesTab = {};
await renderTab('notes');
safe('notesTab', () => {
  const toolbar = field(appEl, '.note-toolbar');
  notesTab.hasToolbar = !!toolbar;
  const groups = all(toolbar, 'div').filter((d) => d.classList.contains('segmented'));
  notesTab.segmentedCount = groups.length;
  notesTab.segmentLabels = groups.map((g) => all(g, 'button').map((b) => b.textContent.trim()));
  notesTab.statusButtons = groups.length
    ? all(groups[0], 'button').map((b) => b.textContent.trim()) : [];
  notesTab.sortButtons = groups
    .map((g) => all(g, 'button').map((b) => b.textContent.trim()))
    .filter((labels) => labels.includes('按更新时间') || labels.includes('按创建时间'));
  notesTab.tagOptions = all(field(toolbar, 'select'), 'option').map((o) => o.textContent);
  const search = field(toolbar, 'input');
  notesTab.hasSearch = !!search && search.type === 'search';
  notesTab.searchType = search ? search.type : null;
  notesTab.searchPlaceholder = search ? search.getAttribute('placeholder') : null;
  notesTab.cardTitles = inEach(appEl, '.note-card', '.note-card-title');
  notesTab.hasGrid = !!field(appEl, '.note-grid');
  const get = fetchCalls.find((c) => c.path.startsWith('/api/notes?'));
  notesTab.gridQuery = get ? get.path : null;
});

notesData = { items: [], total: 0, page: 1, page_size: 10 };
await renderTab('notes');
safe('notesEmpty', () => {
  const box = field(appEl, '.empty-state');
  notesTab.emptyTitle = box ? textOf(box, 'h2') : null;
  notesTab.emptyAction = box && field(box, 'button') ? field(box, 'button').textContent : null;
});
await safeAsync('notesEmptyAction', async () => {
  const box = field(appEl, '.empty-state');
  const btn = box ? field(box, 'button') : null;
  historyCalls.length = 0;
  if (btn) btn.click();
  await flush();
});
safe('notesEmptyActionRead', () => { notesTab.emptyActionUrl = lastNav(); });
notesData = NOTES;

/* F. 我的收藏 Tab */
const favoritesTab = {};
await renderTab('favorites');
safe('favoritesTab', () => {
  favoritesTab.cards = all(appEl, '.note-card').length;
  favoritesTab.titles = inEach(appEl, '.note-card', '.note-card-title');
  favoritesTab.authors = inEach(appEl, '.note-card', '.note-card-author');
  const stales = all(appEl, '.note-card.is-stale');
  favoritesTab.staleCount = stales.length;
  const stale = stales[0] || null;
  favoritesTab.staleTitle = stale ? textOf(stale, '.note-card-title') : null;
  favoritesTab.staleAuthor = stale ? textOf(stale, '.note-card-author') : null;
  favoritesTab.staleRemoveText = stale ? textOf(stale, '.note-remove') : null;
  favoritesTab.removeTexts = all(appEl, '.note-remove').map((b) => b.textContent.trim());
  const unfavButtons = all(appEl, '.favorite-remove');
  favoritesTab.unfavoriteCount = unfavButtons.length;
  favoritesTab.unfavoriteText = texts(unfavButtons);
  favoritesTab.unfavoriteTexts = texts(unfavButtons);
  favoritesTab.unfavoriteTargets = all(appEl, '.note-card')
    .filter((c) => unfavButtons.some((b) => c.contains(b)))
    .map((c) => textOf(c, '.note-card-title'));
  favoritesTab.hasPagination = !!field(appEl, '.pagination');
  favoritesTab.hasGrid = !!field(appEl, '.profile-grid');
  const get = fetchCalls.find((c) => c.method === 'GET' && c.path.startsWith('/api/favorites?'));
  favoritesTab.getPath = get ? get.path : null;
});

await renderTab('favorites');
await safeAsync('favoriteOpen', async () => {
  historyCalls.length = 0;
  toastRoot.innerHTML = '';
  const card = all(appEl, '.note-card').find((c) => !c.classList.contains('is-stale'));
  if (card) card.click();
  await flush();
});
safe('favoriteOpenRead', () => {
  // 不再预探测详情可读性：他人条目直接跳分享页
  favoritesTab.openProbe = fetchCalls
    .filter((c) => c.method === 'GET' && c.path === '/api/notes/21').length;
  favoritesTab.openUrl = lastNav();
  favoritesTab.openToast = lastToast();
});

/* 本人的笔记：后端不下发 share_url，打开走作者详情页 */
favoritesData = {
  items: [{
    note: { id: 51, status: 'private', title: '我自己的收藏', summary: '摘要', tags: [],
            updated_at: '2020-01-01T00:00:00Z' },
    author: { username: 'alice', avatar: null },
    available: true, favorited_at: '2020-01-05T00:00:00Z',
  }],
  total: 1, page: 1, page_size: 10,
};
await renderTab('favorites');
await safeAsync('favoriteOpenOwn', async () => {
  historyCalls.length = 0;
  const card = field(appEl, '.note-card');
  if (card) card.click();
  await flush();
});
safe('favoriteOpenOwnRead', () => { favoritesTab.ownUrl = lastNav(); });
favoritesData = FAVORITES;

await renderTab('favorites');
await safeAsync('favoriteRemoveStale', async () => {
  const stale = field(appEl, '.note-card.is-stale');
  const btn = stale ? field(stale, '.note-remove') : null;
  if (btn) btn.click();
  await flush();
});
safe('favoriteRemoveStaleRead', () => {
  const del = fetchCalls.find((c) => c.method === 'DELETE' && c.path.startsWith('/api/favorites/'));
  favoritesTab.removePath = del ? del.path : null;
  favoritesTab.cardsAfterRemove = all(appEl, '.note-card').length;
  favoritesTab.staleAfterRemove = all(appEl, '.note-card.is-stale').length;
});

await renderTab('favorites');
let stopped = false;
await safeAsync('favoriteRemoveAvailable', async () => {
  historyCalls.length = 0;
  const btn = field(appEl, '.favorite-remove');
  if (btn) stopped = realClick(btn);
  await flush();
});
safe('favoriteRemoveAvailableRead', () => {
  const del = fetchCalls.find((c) => c.method === 'DELETE' && c.path.startsWith('/api/favorites/'));
  favoritesTab.unfavDeletePath = del ? del.path : null;
  favoritesTab.stopPropagationCalled = stopped;
  favoritesTab.unfavNavUrl = lastNav();
  favoritesTab.cardsAfterUnfav = all(appEl, '.note-card').length;
});

favoritesData = { items: [], total: 0, page: 1, page_size: 10 };
await renderTab('favorites');
safe('favoritesEmpty', () => {
  const box = field(appEl, '.empty-state');
  favoritesTab.emptyTitle = box ? textOf(box, 'h2') : null;
});
favoritesData = FAVORITES;

/* G. 浏览足迹 Tab */
const historyTab = {};
await renderTab('history');
safe('historyTab', () => {
  historyTab.cards = all(appEl, '.note-card').length;
  historyTab.titles = inEach(appEl, '.note-card', '.note-card-title');
  historyTab.authors = inEach(appEl, '.note-card', '.note-card-author');
  historyTab.times = all(appEl, '.note-time').map((t) => t.textContent);
  historyTab.staleCount = all(appEl, '.note-card.is-stale').length;
  historyTab.hasClearButton = !!btnByText(appEl, '清空浏览记录');
  historyTab.hasPagination = !!field(appEl, '.pagination');
  const get = fetchCalls.find((c) => c.method === 'GET' && c.path.startsWith('/api/history?'));
  historyTab.getPath = get ? get.path : null;
});

await renderTab('history');
await safeAsync('historyOpen', async () => {
  historyCalls.length = 0;
  const card = all(appEl, '.note-card').find((c) => !c.classList.contains('is-stale'));
  if (card) card.click();
  await flush();
});
safe('historyOpenRead', () => { historyTab.openUrl = lastNav(); });

await renderTab('history');
await safeAsync('historyClearOpen', async () => {
  const btn = btnByText(appEl, '清空浏览记录');
  if (btn) btn.click();
  await flush();
});
safe('historyClearDialog', () => {
  const dialog = field(dialogRoot, '.dialog');
  historyTab.dialogTitle = dialog ? textOf(dialog, '.dialog-title') : null;
  historyTab.dialogMessage = dialog ? textOf(dialog, '.dialog-message') : null;
  const confirm = dialog ? btnByText(dialog, '清空') : null;
  historyTab.confirmText = confirm ? confirm.textContent.trim() : null;
  historyTab.confirmClass = confirm ? confirm.className : null;
  const cancel = dialog ? btnByText(dialog, '取消') : null;
  historyTab.cancelText = cancel ? cancel.textContent.trim() : null;
  if (cancel) cancel.click();
});
await flush();
historyTab.deleteAfterCancel = fetchCalls
  .filter((c) => c.method === 'DELETE' && c.path === '/api/history').length;

await safeAsync('historyClearConfirm', async () => {
  const btn = btnByText(appEl, '清空浏览记录');
  if (btn) btn.click();
  await flush();
  const dialog = field(dialogRoot, '.dialog');
  const confirm = dialog ? btnByText(dialog, '清空') : null;
  if (confirm) confirm.click();
  await flush();
});
safe('historyClearConfirmed', () => {
  const del = fetchCalls.find((c) => c.method === 'DELETE' && c.path === '/api/history');
  historyTab.clearPath = del ? del.path : null;
  historyTab.cardsAfterClear = all(appEl, '.note-card').length;
  const box = field(appEl, '.empty-state');
  historyTab.emptyAfterClear = box ? textOf(box, 'h2') : null;
  historyTab.toast = lastToast();
});

historyData = HISTORY;
await renderTab('history');
await safeAsync('historyRemoveStale', async () => {
  const stale = field(appEl, '.note-card.is-stale');
  const btn = stale ? field(stale, '.note-remove') : null;
  if (btn) btn.click();
  await flush();
});
safe('historyRemoveStaleRead', () => {
  const del = fetchCalls.find((c) => c.method === 'DELETE' && c.path.startsWith('/api/history/'));
  historyTab.removePath = del ? del.path : null;
  historyTab.cardsAfterRemove = all(appEl, '.note-card').length;
});

historyData = { items: [], total: 0, page: 1, page_size: 10 };
await renderTab('history');
safe('historyEmpty', () => {
  const box = field(appEl, '.empty-state');
  historyTab.emptyTitle = box ? textOf(box, 'h2') : null;
});
historyData = HISTORY;

/* H. ui.js staleCard 单元契约 */
const stale = {};
safe('staleCard', () => {
  let removed = 0;
  const card = staleCard({ authorName: 'bob', onRemove: () => { removed += 1; } });
  stale.className = card.className;
  stale.isStale = card.classList.contains('is-stale');
  stale.paper = card.classList.contains('paper');
  stale.title = textOf(card, '.note-card-title');
  stale.author = textOf(card, '.note-card-author');
  stale.removeText = textOf(card, '.note-remove');
  stale.tabindex = card.getAttribute('tabindex');
  stale.role = card.getAttribute('role');
  stale.clickable = card.getAttribute('tabindex') !== null || card.getAttribute('role') !== null;
  stale.hasBadge = serialize(card).includes('badge');
  const btn = field(card, '.note-remove');
  if (btn) btn.click();
  stale.removedCalls = removed;
});

/* I. ui.js favoriteButton 单元契约 */
const favBtnUnit = {};
safe('favoriteButtonUnit', () => {
  const on = favoriteButton({ id: 99 }, { isFavorited: true });
  favBtnUnit.onText = on.textContent;
  favBtnUnit.onPressed = on.getAttribute('aria-pressed');
  favBtnUnit.onClass = on.className;
  const off = favoriteButton({ id: 98 });
  favBtnUnit.offText = off.textContent;
  favBtnUnit.offPressed = off.getAttribute('aria-pressed');
  favBtnUnit.offClass = off.className;
});

/* J. DOM 顺序（Tab 键可达性近似） */
const keyboard = {};
await renderTab('info');
safe('keyboard', () => {
  keyboard.tabOrder = texts(tabButtons());
  const panel = field(appEl, '.profile-panel');
  keyboard.panelOrder = all(panel, 'textarea, input, button')
    .map((el) => el.textContent.trim() || el.getAttribute('name') || el.getAttribute('type') || '');
});

/* K. 路由：/me 需要登录 */
const routing = {};
loggedIn = false;
store.setUser(null, null);
resetShell();
location.pathname = '/me';
location.search = '';
await safeAsync('routingNavigate', async () => {
  const router = await import('../../static/js/router.js');
  await router.navigate('/me');
});
await flush();
safe('routing', () => {
  routing.lastUrl = lastNav();
  routing.method = historyCalls.length ? historyCalls[historyCalls.length - 1].method : null;
  routing.hasProfile = !!field(appEl, '.profile-page');
});
loggedIn = true;
store.setUser({ ...USER }, 'csrf-1');

process.stdout.write(JSON.stringify({
  errors, tabs, info, save, password, notesTab, favoritesTab, historyTab,
  stale, favBtnUnit, keyboard, routing,
}) + '\n');
