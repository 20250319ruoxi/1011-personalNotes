/* render_router.mjs — 路由匹配契约 harness。
 *
 * 背景：`match()` 会把请求路径去掉尾部斜杠后再 split('/')，而注册的模式没有做同样归一化，
 * 导致 `'/'` 这一条模式（split 后是 ['',''] 两段）永远匹配不上 `location.pathname === '/'`
 * （归一化后 split 出来只有 [''] 一段），首页因此落进「页面不存在」视图。
 *
 * 本 harness 在 Node 中真实调用 router.js 的 navigate()，逐条路径取出 #app 的序列化 HTML，
 * 交给 pytest 断言，确保首页、关于页、未注册路径与登录守卫四条路径都落在正确的视图上。
 *
 * 用法：node tests/js/render_router.mjs   →  stdout 打印一行 JSON
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

/* 会话恢复（/auth/me）走可控桩件：返回未登录，避免网络依赖 */
globalThis.fetch = async () => ({
  json: async () => ({ code: 'OK', message: '操作成功', data: { user: null, csrf_token: null } }),
});

const errors = {};
const safe = async (key, fn, fallback = null) => {
  try { return await fn(); } catch (err) { errors[key] = String(err.message).split('\n')[0]; return fallback; }
};

const { store } = await import('../../static/js/store.js');
const { navigate } = await import('../../static/js/router.js');

/* 首页与关于页的文案签名，取自 spec 的 Components 表 */
const HERO_SIGNATURE = '记录生活 · 书写成长';
const ABOUT_SIGNATURE = '关于个人笔记';
/* 「页面不存在」视图的判别特征：dom-shim 的 innerHTML 不解析成节点树，
 * 因此不能靠 <h2>页面不存在</h2> 的文字判断，改用空态容器 + 返回首页锚点。 */
const FALLBACK_CLASS = 'empty-state';
const FALLBACK_ANCHOR = '返回首页';

async function visit(path) {
  store.setDirty(false);
  location.pathname = path;
  location.search = '';
  const callsBefore = historyCalls.length;
  await navigate(path);
  const html = serialize(appEl);
  return {
    requested: path,
    finalPath: location.pathname + location.search,
    /* 本次访问期间产生的全部 history 调用；守卫跳转会额外多出一条 */
    historyUrls: historyCalls.slice(callsBefore).map((c) => c.url),
    hasHero: html.includes(HERO_SIGNATURE),
    hasAbout: html.includes(ABOUT_SIGNATURE),
    hasFallbackView: html.includes(FALLBACK_CLASS) && html.includes(FALLBACK_ANCHOR),
    htmlHead: html.slice(0, 300),
  };
}

const cases = {};
cases.root = await safe('root', () => visit('/'));
cases.about = await safe('about', () => visit('/about'));
cases.aboutTrailing = await safe('aboutTrailing', () => visit('/about/'));
cases.missing = await safe('missing', () => visit('/__not-a-route__'));
cases.guard = await safe('guard', () => visit('/notes/1'));

process.stdout.write(`${JSON.stringify({ errors, cases })}\n`);
