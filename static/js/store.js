export const store = {
  user: null,          // 当前用户对象或 null
  csrfToken: null,     // 内存中的 CSRF Token，禁止写入 localStorage
  guards: [],          // 登录态变化回调
  dirty: false,        // 编辑器脏标记：存在未保存的更改
  dirtyGuard: null,    // 由 editor.js 注入：返回 true（或 resolve true）表示可以离开

  setUser(user, csrfToken) {
    this.user = user || null;
    this.csrfToken = csrfToken || null;
    this.guards.forEach((fn) => fn(this.user));
  },
  isLoggedIn() { return this.user !== null; },
  onChange(fn) { this.guards.push(fn); },

  setDirty(value) { this.dirty = !!value; },
  canLeave() { return this.dirtyGuard ? this.dirtyGuard() : true; },
};
