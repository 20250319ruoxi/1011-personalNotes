/* dom-shim.mjs — 极简 DOM 实现，仅供 Node 侧渲染测试使用。
 *
 * 本环境（Windows 无浏览器）无法执行真实浏览器渲染，因此用这个最小 DOM 双端
 * 在 Node 中真实调用 static/js 下的渲染函数（ui.renderHeader / home.renderHome /
 * about.renderAbout），再把生成的节点树序列化成 HTML 断言。
 * 只实现被测渲染函数实际用到的那部分 DOM API；不是浏览器模拟器。
 */

const REFLECTED = [
  'href', 'src', 'srcset', 'sizes', 'alt', 'type', 'rel', 'target', 'name',
  'value', 'placeholder', 'role', 'title', 'for', 'width', 'height', 'download',
];

class ClassList {
  constructor(el) { this.el = el; }
  get _set() { return this.el._classes; }
  add(...names) { names.forEach((n) => { if (n) this.el._classes.add(n); }); }
  remove(...names) { names.forEach((n) => this.el._classes.delete(n)); }
  contains(name) { return this.el._classes.has(name); }
  toggle(name, force) {
    const on = force === undefined ? !this.el._classes.has(name) : !!force;
    if (on) this.el._classes.add(name); else this.el._classes.delete(name);
    return on;
  }
}

export class Element {
  constructor(tagName, doc) {
    this.tagName = String(tagName).toLowerCase();
    this.ownerDocument = doc;
    this.attributes = new Map();
    this.children = [];
    this.parentNode = null;
    this._classes = new Set();
    this._text = '';
    this._rawHtml = null;            // innerHTML 赋值的原始字符串（不解析）
    this._listeners = new Map();
    this.classList = new ClassList(this);
  }

  /* ---- 属性 ---- */
  setAttribute(name, value) {
    const key = String(name).toLowerCase();
    if (key === 'class') { this._classes = new Set(String(value).split(/\s+/).filter(Boolean)); }
    this.attributes.set(key, value == null ? '' : String(value));
    if (key === 'id') this.ownerDocument._register(this);
  }
  getAttribute(name) {
    const key = String(name).toLowerCase();
    return this.attributes.has(key) ? this.attributes.get(key) : null;
  }
  hasAttribute(name) { return this.attributes.has(String(name).toLowerCase()); }
  removeAttribute(name) { this.attributes.delete(String(name).toLowerCase()); }

  get id() { return this.getAttribute('id') || ''; }
  set id(v) { this.setAttribute('id', v); }

  get className() { return Array.from(this._classes).join(' '); }
  set className(v) {
    this._classes = new Set(String(v == null ? '' : v).split(/\s+/).filter(Boolean));
    this.attributes.set('class', this.className);
  }

  /* ---- 内容 ---- */
  get textContent() {
    if (this._rawHtml != null) return this._rawHtml;
    return this._text + this.children.map((c) => c.textContent).join('');
  }
  set textContent(value) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this._rawHtml = null;
    this._text = value == null ? '' : String(value);
  }

  get innerHTML() {
    return this._rawHtml != null ? this._rawHtml : this.children.map(serialize).join('');
  }
  set innerHTML(value) {
    this.children.forEach((c) => { c.parentNode = null; });
    this.children = [];
    this._text = '';
    this._rawHtml = value == null ? '' : String(value);
  }

  /* ---- 树操作 ---- */
  appendChild(child) {
    child.parentNode = this;
    this.children.push(child);
    this._rawHtml = null;
    return child;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  remove() {
    if (this.parentNode) {
      const i = this.parentNode.children.indexOf(this);
      if (i >= 0) this.parentNode.children.splice(i, 1);
      this.parentNode = null;
    }
  }

  /* ---- 查询 ---- */
  querySelectorAll(selector) {
    const parts = String(selector).split(',').map((s) => s.trim()).filter(Boolean);
    const out = [];
    const walk = (node) => {
      node.children.forEach((child) => {
        if (parts.some((p) => matches(child, p))) out.push(child);
        walk(child);
      });
    };
    walk(this);
    return out;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }

  /* ---- 事件 ---- */
  addEventListener(type, handler) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(handler);
  }
  removeEventListener(type, handler) {
    const list = this._listeners.get(type);
    if (!list) return;
    const i = list.indexOf(handler);
    if (i >= 0) list.splice(i, 1);
  }
  dispatchEvent(event) {
    const list = this._listeners.get(event.type) || [];
    list.slice().forEach((fn) => fn.call(this, event));
    return true;
  }
  click() {
    if (this.disabled) return;
    this.dispatchEvent({ type: 'click', target: this, preventDefault() {} });
  }
  focus() { this.ownerDocument.activeElement = this; }
  blur() { if (this.ownerDocument.activeElement === this) this.ownerDocument.activeElement = null; }
  setAttributeNS(_ns, name, value) { this.setAttribute(name, value); }
}

// 反射属性：赋值直接落到属性表，便于序列化时读取
REFLECTED.forEach((prop) => {
  Object.defineProperty(Element.prototype, prop, {
    get() { return this.getAttribute(prop) || ''; },
    set(v) { this.setAttribute(prop, v); },
    configurable: true,
  });
});

function matches(el, selector) {
  const sel = selector.trim();
  if (!sel) return false;
  let rest = sel;
  // 属性选择器（仅支持 [attr] 与 [attr="value"]）
  const attrMatch = rest.match(/\[([\w-]+)(?:="([^"]*)")?\]/);
  if (attrMatch) {
    const name = attrMatch[1].toLowerCase();
    const want = attrMatch[2];
    if (!el.hasAttribute(name)) return false;
    if (want !== undefined && el.getAttribute(name) !== want) return false;
    rest = rest.replace(attrMatch[0], '');
  }
  // 类选择器
  const classMatches = rest.match(/\.[\w-]+/g) || [];
  if (classMatches.some((c) => !el._classes.has(c.slice(1)))) return false;
  rest = rest.replace(/\.[\w-]+/g, '');
  // id 选择器
  const idMatch = rest.match(/#[\w-]+/);
  if (idMatch) {
    if (el.id !== idMatch[0].slice(1)) return false;
    rest = rest.replace(idMatch[0], '');
  }
  // 标签选择器
  const tag = rest.trim();
  if (tag && tag !== '*' && el.tagName !== tag.toLowerCase()) return false;
  return true;
}

export function serialize(el) {
  if (el == null) return '';
  if (el.tagName === '#text') return esc(el._text);
  const tag = el.tagName;
  // 属性顺序固定，便于断言稳定
  const attrs = [];
  if (el.id) attrs.push(`id="${esc(el.id)}"`);
  if (el.className) attrs.push(`class="${esc(el.className)}"`);
  Array.from(el.attributes.keys()).sort().forEach((k) => {
    if (k === 'id' || k === 'class') return;
    attrs.push(`${k}="${esc(el.getAttribute(k))}"`);
  });
  const open = `<${tag}${attrs.length ? ' ' + attrs.join(' ') : ''}>`;
  const body = el._rawHtml != null ? el._rawHtml : esc(el._text) + el.children.map(serialize).join('');
  return `${open}${body}</${tag}>`;
}

function esc(v) {
  return String(v == null ? '' : v)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

class Document {
  constructor() {
    this._ids = new Map();
    this.activeElement = null;
    this._listeners = new Map();
    this.documentElement = new Element('html', this);
    this.head = new Element('head', this);
    this.body = new Element('body', this);
    this.documentElement.append(this.head, this.body);
  }
  _register(el) {
    const id = el.getAttribute('id');
    if (id) this._ids.set(id, el);
  }
  createElement(tag) { return new Element(tag, this); }
  createElementNS(_ns, tag) { return new Element(tag, this); }
  createTextNode(text) {
    const node = new Element('#text', this);
    node._text = String(text);
    return node;
  }
  getElementById(id) { return this._ids.get(id) || null; }
  querySelector(sel) { return this.documentElement.querySelector(sel); }
  querySelectorAll(sel) { return this.documentElement.querySelectorAll(sel); }
  addEventListener(type, fn) {
    if (!this._listeners.has(type)) this._listeners.set(type, []);
    this._listeners.get(type).push(fn);
  }
  removeEventListener(type, fn) {
    const list = this._listeners.get(type) || [];
    const i = list.indexOf(fn);
    if (i >= 0) list.splice(i, 1);
  }
}

/* 安装全局环境并返回用于测试的句柄 */
export function installDom() {
  const document = new Document();
  const historyCalls = [];

  const location = { pathname: '/', search: '', hash: '', origin: 'http://localhost' };
  const applyUrl = (url) => {
    const text = String(url || '/');
    const q = text.indexOf('?');
    location.pathname = q >= 0 ? text.slice(0, q) : text;
    location.search = q >= 0 ? text.slice(q) : '';
  };

  const history = {
    pushState(_state, _title, url) { historyCalls.push({ method: 'push', url: String(url) }); applyUrl(url); },
    replaceState(_state, _title, url) { historyCalls.push({ method: 'replace', url: String(url) }); applyUrl(url); },
  };

  const windowListeners = new Map();
  const fireWindow = (type, event = {}) => {
    (windowListeners.get(type) || []).slice().forEach((fn) => fn({ type, ...event }));
  };

  const window = {
    addEventListener(type, fn) {
      if (!windowListeners.has(type)) windowListeners.set(type, []);
      windowListeners.get(type).push(fn);
    },
    removeEventListener(type, fn) {
      const list = windowListeners.get(type) || [];
      const i = list.indexOf(fn);
      if (i >= 0) list.splice(i, 1);
    },
    setTimeout: globalThis.setTimeout, clearTimeout: globalThis.clearTimeout,
    location, history, scrollY: 0, innerWidth: 1440,
  };

  globalThis.window = window;
  globalThis.document = document;
  globalThis.location = location;
  globalThis.history = history;
  // Node 24 的 globalThis.navigator 只有 getter，改用 defineProperty 覆盖
  Object.defineProperty(globalThis, 'navigator', {
    value: { userAgent: 'node-dom-shim' }, configurable: true, writable: true,
  });

  return { document, window, location, history, historyCalls, Element, fireWindow };
}
