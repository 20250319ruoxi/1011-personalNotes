export const store = {
  user: null,          // 当前用户对象或 null
  csrfToken: null,     // 内存中的 CSRF Token，禁止写入 localStorage
  guards: [],          // 登录态变化回调

  setUser(user, csrfToken) {
    this.user = user || null;
    this.csrfToken = csrfToken || null;
    this.guards.forEach((fn) => fn(this.user));
  },
  isLoggedIn() { return this.user !== null; },
  onChange(fn) { this.guards.push(fn); },
  rawPage: null,       // 编辑器脏数据标记（Phase 5 使用）
};
