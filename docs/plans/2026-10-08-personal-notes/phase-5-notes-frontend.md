# Phase 5: 笔记前端

**Goal:** 交付笔记列表页、分栏实时预览编辑器、笔记详情页，以及 Markdown 渲染清洗模块。

**Prerequisites:** Phase 2（设计令牌、顶栏、纸张容器样式）、Phase 3（登录态与守卫）、Phase 4（笔记与上传接口）。

**Deliverables:**
- `static/js/markdown.js`（渲染 + 清洗 + 降级）
- `static/js/notes.js`、`static/css/notes.css`（列表页 + 详情页）
- `static/js/editor.js`、`static/css/editor.css`（写笔记/编辑页）
- `tests/manual/xss-fixtures.md`（XSS 手工样例与期望结果）
- 视觉与交互验收记录

**Interface Decisions Implemented:**
- 纸张容器（签名元素）在编辑器、详情页、列表卡片三处的统一呈现
- 编辑器分栏：左「Markdown 源码」右「预览」；`≤768px` 改为「编辑 / 预览」顶部切换
- 编辑器脏标记流程：标题前圆点 + 离开页面二次确认 + 站内路由切换二次确认
- 笔记卡片状态徽标（草稿 / 私密 / 已分享）与失效占位
- 列表工具条：状态筛选、标签下拉、搜索（占位「搜索标题或正文…」）、排序切换、有筛选时显示「清除筛选」
- 空态文案：`还没有笔记，去写下第一篇吧`；搜索无结果空态
- 编辑器底部状态：`已保存 · 共 N 字 · 更新于 …`
- 加载骨架、字段/请求错误 toast、删除二次确认

---

## Task 1: Markdown 渲染与清洗模块

**Goal:** 交付全项目唯一的 Markdown 渲染入口，并给出可复现的 XSS 手工验证样例。

**Files:**
- Create: `static/js/markdown.js`
- Create: `tests/manual/xss-fixtures.md`

**Steps:**

- [ ] 创建 `static/js/markdown.js`：

```js
const ALLOWED_TAGS = [
  'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'ul', 'ol', 'li', 'blockquote', 'pre', 'code', 'strong', 'em', 'del',
  'a', 'img', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'sup', 'sub',
];

const ALLOWED_ATTR = ['href', 'title', 'alt', 'src', 'colspan', 'rowspan', 'class'];

let hookInstalled = false;

function installLinkHook() {
  if (hookInstalled || !window.DOMPurify) return;
  window.DOMPurify.addHook('afterSanitizeAttributes', (node) => {
    if (node.tagName === 'A' && node.getAttribute('href')) {
      node.setAttribute('target', '_blank');
      node.setAttribute('rel', 'noopener noreferrer');
    }
  });
  hookInstalled = true;
}

export function renderMarkdown(markdown) {
  const source = markdown == null ? '' : String(markdown);
  try {
    installLinkHook();
    const html = window.marked.parse(source, { gfm: true, breaks: true });
    return window.DOMPurify.sanitize(html, {
      ALLOWED_TAGS,
      ALLOWED_ATTR,
      FORBID_TAGS: ['script', 'style', 'iframe', 'form', 'object', 'embed', 'link', 'meta'],
      FORBID_ATTR: ['style', 'srcset', 'formaction'],
      ALLOW_DATA_ATTR: false,
    });
  } catch (error) {
    // 渲染或清洗失败时降级为纯文本，绝不让原始 HTML 进入 DOM
    const pre = document.createElement('pre');
    pre.className = 'md-fallback';
    pre.textContent = source;
    return pre.outerHTML;
  }
}

export function markdownToPlainText(markdown, limit = 80) {
  const holder = document.createElement('div');
  holder.innerHTML = renderMarkdown(markdown);
  return (holder.textContent || '').replace(/\s+/g, ' ').trim().slice(0, limit);
}
```

- [ ] 创建 `tests/manual/xss-fixtures.md`，列出 6 个样例与期望结果（浏览器手工执行：登录后进入 `/notes/new`，把左侧内容逐条粘贴，观察右侧预览）：

```markdown
# Markdown 注入样例与期望结果

验证方式：进入 `/notes/new`，把「输入」逐条粘贴到左侧源码区，观察右侧预览与浏览器控制台。

| # | 输入 | 期望预览结果 | 不得出现 |
|---|------|--------------|----------|
| 1 | `<script>alert('xss')</script>正文` | 只显示「正文」 | 无弹窗、源码中无 `<script>` |
| 2 | `<img src=x onerror="alert('xss')">` | 不显示图片、无弹窗 | 无 `onerror` 属性 |
| 3 | `[点我](javascript:alert('xss'))` | 链接文本「点我」可见，但 href 被移除或不可执行 | 点击不执行脚本 |
| 4 | `<iframe src="https://example.com"></iframe>` | 不渲染任何 iframe | DOM 中无 `<iframe>` |
| 5 | `<a href="https://example.com" onclick="alert(1)">外链</a>` | 渲染为可点击外链 | 无 `onclick`；DOM 中带 `rel="noopener noreferrer"` 与 `target="_blank"` |
| 6 | `<style>body{display:none}</style>正文` | 只显示「正文」，页面样式不受影响 | DOM 中无 `<style>` |

附加核对：
- 控制台无异常输出
- 逐条粘贴后立即保存并刷新详情页，注入内容在详情页同样被清洗（验证存储后仍安全）
```

- [ ] 手工执行清单并记录结论；任一「不得出现」列的条件被违反即视为阻塞缺陷，必须回到本任务修正白名单后再继续。

**Security/Boundary Notes:**
- `renderMarkdown` 是全项目唯一输出 HTML 的入口，编辑器预览、笔记详情页、分享页都必须走它；禁止任何模块自行调用 `innerHTML` 插入用户内容。
- 降级分支用 `textContent` 构造 `<pre>`，不拼接字符串。
- DOMPurify 的 hook 是全局的，用 `hookInstalled` 标志保证只注册一次。

**Dependencies:** Phase 1 Task 2（vendor 文件）

---

## Task 2: 笔记列表页与工具条

**Goal:** 交付带筛选、搜索、排序、分页的笔记列表页。

**Files:**
- Create: `static/js/notes.js`（本任务先实现 `renderNoteList`）
- Create: `static/css/notes.css`
- Modify: `static/js/router.js`（注册 `/notes`）
- Modify: `static/js/ui.js`（新增可复用的 `noteCard()`、`pagination()`）

**Steps:**

- [ ] 在 `static/js/ui.js` 追加：

  - `noteCard(note, { onOpen, onRemove })`：返回 `.note-card.paper` 元素，含 `<h3>` 标题（`note.title` 为空时显示「无标题」）、`<p class="note-summary">`（`note.summary`，为空时显示「（空白笔记）」）、标签 chips、状态徽标、更新时间（`formatDate(note.updated_at)`）。
  - 状态徽标文案映射：`draft → 草稿`、`private → 私密`、`public → 已分享`；徽标底色分别用 `var(--c-border)`、`var(--c-surface)` + 主色描边、`var(--c-accent)`。
  - `noteCard` 需支持 `available === false` 的失效态：整卡改为 `.is-stale`，标题位置显示「内容已失效」，不提供「打开」行为，只提供「移除」按钮（`onRemove`）。
  - `pagination({ page, pageSize, total, onChange })`：返回分页控件，显示「第 X / Y 页」「共 N 篇」，上一页/下一页按钮在边界时 `disabled`。

- [ ] 创建 `static/js/notes.js`，导出 `renderNoteList(root, params)`：

  - 读 query 参数：`status`（默认 `all`）、`q`、`tag`、`sort`（默认 `updated`）、`page`（默认 1）。切换筛选时用 `navigate()` 更新地址栏（保留在 `/notes?…`），使筛选状态可分享、可刷新。
  - 工具条 `.note-toolbar`：
    - 状态筛选：四个按钮 `全部 / 草稿 / 私密 / 已分享`（对应 `all/draft/private/public`），当前项加 `.is-active` 与 `aria-pressed="true"`。
    - 标签下拉：`<select>`，选项来自 `api.get('/api/tags')`，首项为「全部标签」（空值）。
    - 搜索输入：`<input type="search" placeholder="搜索标题或正文…">`，`input` 事件 debounce 300ms 后跳转，跳转时 `page` 重置为 1。
    - 排序切换：两个按钮 `按更新时间 / 按创建时间`。
    - 清除筛选：仅当存在任一筛选条件时显示「清除筛选」按钮，点击回到 `/notes`。
  - 内容区：加载中显示 `skeleton(6)`；`items` 为空且无筛选条件时显示空态 `还没有笔记，去写下第一篇吧`（含按钮「写第一篇笔记」→ `/notes/new`）；为空但有筛选条件时显示 `没有找到符合条件的笔记`（含「清除筛选」）。
  - 分页：使用 `pagination()`；点击后 `navigate()` 更新 `page`。
  - 卡片点击 → `navigate('/notes/' + note.id)`。

- [ ] 在 `router.js` 注册 `/notes`（`requiresAuth: true`）：

```js
registerRoute('/notes', async (root, params) => {
  const { renderNoteList } = await import('./notes.js');
  renderNoteList(root, params);
}, { requiresAuth: true });
```

- [ ] `static/css/notes.css` 实现：

  - `.note-toolbar`：`display:flex; flex-wrap:wrap; gap:var(--sp-3); align-items:center; margin-bottom:var(--sp-6);` 内含分段按钮组 `.segmented`（圆角 8px、内部按钮无边框、选中项底色 `var(--c-accent)`）、`<select>`、搜索框（`flex:1; min-width:200px; max-width:360px; height:40px`）。
  - `.note-grid`：`display:grid; grid-template-columns:repeat(auto-fill, minmax(280px, 1fr)); gap:var(--sp-6);`
  - `.note-card`：纸张容器样式（`background-image:url('/static/img/paper.jpg')` + `background-color:var(--c-paper-fallback)` + `border:var(--bd)` + `border-radius:var(--r-2)` + `padding:var(--sp-6)`）；`:hover` 时 `box-shadow:var(--sd-card)` 且 `transform:translateY(-2px)`（`prefers-reduced-motion` 下无 transform）。
  - `.note-summary`：`var(--fs-sm)`、`var(--c-text-muted-strong)`、`display:-webkit-box; -webkit-line-clamp:3; -webkit-box-orient:vertical; overflow:hidden;`
  - `.badge`：`font-size:var(--fs-xs); padding:2px 8px; border-radius:999px;`
  - `.note-card.is-stale`：`opacity:.7;`
  - `.pagination`：居中，`gap:var(--sp-4)`。
  - `@media (max-width:768px)`：`.note-grid` 单列；工具条换行且搜索框占满整行。

- [ ] 手工验证：登录后访问 `/notes`，验证四类筛选可组合、搜索防抖生效、翻页正确、空态文案正确、刷新后筛选条件保留。

**Dependencies:** Phase 4 Task 3（列表接口）、Phase 4 Task 4（标签接口）

---

## Task 3: 写笔记编辑器

**Goal:** 交付分栏实时预览编辑器，含标题、标签联想、存草稿/发布、脏标记、图片插入与快捷键。

**Files:**
- Create: `static/js/editor.js`
- Create: `static/css/editor.css`
- Modify: `static/js/router.js`（注册 `/notes/new` 与 `/notes/<id>/edit`）
- Modify: `static/js/store.js`（`dirty` 标记与拦截钩子）

**Steps:**

- [ ] 在 `static/js/store.js` 中把 `rawPage` 替换为明确的脏标记接口：

```js
export const store = {
  // …（user / csrfToken / guards 保持不变）
  dirty: false,
  dirtyGuard: null,   // 由 editor.js 注入：返回 true 表示可以离开

  setDirty(value) { this.dirty = value; },
  canLeave() { return this.dirtyGuard ? this.dirtyGuard() : true; },
};
```

- [ ] 在 `router.js` 的路由跳转前统一拦截：

```js
export async function navigate(path, options = {}) {
  if (store.dirty && !(await store.canLeave())) return;
  store.setDirty(false);
  if (options.replace) history.replaceState({}, '', path);
  else history.pushState({}, '', path);
  await render();
}
```

  并在模块初始化时注册浏览器级拦截：

```js
window.addEventListener('beforeunload', (event) => {
  if (store.dirty) { event.preventDefault(); event.returnValue = ''; }
});
```

- [ ] 创建 `static/js/editor.js`，导出 `renderEditor(root, params)`：

  - 标题输入：`.editor-title`（`<input>`，占位「请输入标题」，`maxlength="200"`，无边框大字号）。
  - 标签输入：`.tag-input`（`<input>`，占位「添加标签后按回车」，回车添加、`Backspace` 在空输入时删除最后一个标签、最多 5 个、重复标签忽略）；输入内容变化时用 `api.get('/api/tags')` 结果做前缀联想，渲染 `.tag-suggestions` 下拉（最多 6 项），点击即添加。
  - 操作按钮：`存草稿`（`.btn.btn-ghost`）与 `发布`（`.btn.btn-primary`）。
    - `存草稿`：`status='draft'`，成功后 toast `已保存为草稿`。
    - `发布`：`status='private'`，首次发布（原状态为 `draft` 或新建）时先弹 `confirmDialog({ title:'发布笔记', message:'发布后笔记将显示为「私密」，只有你自己可见。确定发布吗？', confirmText:'发布' })`；确认后提交，toast `已发布`。
  - 图片插入：编辑器底部工具条的「插入图片」按钮触发隐藏 `<input type="file" accept="image/png,image/jpeg,image/gif,image/webp">`；选中后 `api.upload('/api/uploads/image', formData)`，成功后把 `![](url)` 插入 textarea 当前光标处并更新预览。
  - 分栏：`.editor-panes` 内 `.pane-source`（`<textarea>`）与 `.pane-preview`（`.markdown-body`）。
    - 预览更新：`input` 事件 debounce 120ms 调用 `renderMarkdown(textarea.value)` 后写入 `.pane-preview`。
    - 滚动同步：两栏 `scroll` 事件按百分比同步（用 `isSyncing` 标志防止互相触发）。
    - `≤768px`：`.editor-panes` 改为单栏，顶部出现「编辑 / 预览」两个标签按钮切换 `.is-showing-source` / `.is-showing-preview`。
  - 底部状态条 `.editor-status`：`已保存`（未保存时显示 `未保存的更改`）· `共 N 字`（`textarea.value` 去掉空白后的字符数）· `更新于 M/D HH:mm`（新建时显示 `新建笔记`）。
  - 脏标记：标题、正文、标签任一变化即 `store.setDirty(true)` 并把状态文案改为 `未保存的更改`；保存成功后 `store.setDirty(false)`。
  - 离开拦截：`store.dirtyGuard = () => confirmDialog({ title:'放弃未保存的更改？', message:'当前笔记有未保存的修改，离开将丢失这些内容。', confirmText:'放弃更改', danger:true })`。
  - 快捷键：`Ctrl/Cmd + S` 触发存草稿并阻止浏览器默认保存行为。
  - 路由分派：
    - `/notes/new`：空标题、空正文、空标签、状态徽标为「新建」。
    - `/notes/<id>/edit`：`api.get('/api/notes/<id>')` 载入，若返回 `NOT_FOUND` 显示空态「笔记不存在或已被删除」并给「返回笔记列表」按钮；载入中显示骨架。
  - 保存请求：新建用 `api.post('/api/notes', {...})`，更新用 `api.put('/api/notes/<id>', {...})`；首次保存成功后把地址栏 `replaceState` 为 `/notes/<id>/edit`，避免「新建」状态下二次提交产生重复笔记。
  - 保存失败：保留全部输入内容，toast 显示后端 `message`，状态文案改为 `保存失败，请重试`。

- [ ] 在 `router.js` 注册：

```js
registerRoute('/notes/new', async (root, params) => {
  const { renderEditor } = await import('./editor.js');
  renderEditor(root, params);
}, { requiresAuth: true });

registerRoute('/notes/:id/edit', async (root, params) => {
  const { renderEditor } = await import('./editor.js');
  renderEditor(root, params);
}, { requiresAuth: true });
```

- [ ] `static/css/editor.css` 实现：

  - `.editor-wrap`：`max-width:var(--page-max); margin:0 auto; padding:var(--sp-6) var(--gutter) var(--sp-12);`
  - `.editor-paper`：纸张容器（同 `.note-card` 的底图与边框），`border-radius:var(--r-2)`，`padding:var(--sp-6)`。
  - `.editor-head`：`display:flex; gap:var(--sp-3); align-items:center;` 左标题输入占满剩余空间，右侧为标签输入与两个按钮；`≤768px` 换行，按钮半宽。
  - `.editor-title`：`font-size:var(--fs-h2); font-weight:600; border:none; background:transparent; outline:none; width:100%;`
  - `.editor-panes`：`display:grid; grid-template-columns:1fr 1fr; gap:0; margin-top:var(--sp-4); border-top:var(--bd);`
  - `.pane-source textarea`：`width:100%; min-height:52vh; border:none; background:transparent; resize:none; font-family:ui-monospace,Consolas,monospace; font-size:var(--fs-sm); line-height:1.8; outline:none;`
  - `.pane-preview`：`min-height:52vh; overflow-y:auto; padding-left:var(--sp-6); border-left:var(--bd);`
  - `.markdown-body` 的排版：`h1..h6` 用 `var(--fs-h2)` 递减并加下边距；`p` 用 `var(--fs-base)` / `var(--lh-reading)`；`code` 底色 `rgba(195,164,123,.16)`、圆角 4px；`pre` 底色 `var(--c-page)`、内边距 `var(--sp-4)`、横向滚动；`blockquote` 左侧 3px `var(--c-accent)` 描边 + `var(--c-text-muted-strong)`；`img` 最大宽度 100%；`table` 全宽、单元格 1px `var(--c-border)`。
  - `.editor-status`：`var(--fs-xs)`、`var(--c-text-muted)`，与正文同容器底部。
  - `@media (max-width:768px)`：`.editor-panes` 单栏；`.pane-preview` 去掉左边框与左内边距；默认显示源码，通过 `.is-showing-preview` 切换。

- [ ] 手工验证：
  - 新建笔记输入 Markdown，右侧 120ms 内出现渲染结果
  - 插入一张本地图片，正文出现 `![](/static/uploads/uX-….png)`，预览显示图片
  - 点「存草稿」→ toast「已保存为草稿」，状态改为「已保存」，地址栏变为 `/notes/<id>/edit`
  - 修改标题后点「笔记列表」→ 弹出「放弃未保存的更改？」；选「取消」留在原页
  - `Ctrl+S` 存草稿且浏览器不弹出保存对话框
  - 375px 宽度下出现「编辑 / 预览」切换且默认显示编辑

**Security/Boundary Notes:** 预览仅通过 `renderMarkdown()` 输出；`textarea.value` 不得直接赋给 `innerHTML`。图片插入使用返回的 `url`，不接受用户手填路径。

**Dependencies:** Phase 4 Task 2/5、Task 1、Task 2

---

## Task 4: 笔记详情页

**Goal:** 交付作者视角的笔记详情页与操作条。

**Files:**
- Modify: `static/js/notes.js`（新增 `renderNoteDetail`）
- Modify: `static/css/notes.css`
- Modify: `static/js/router.js`（注册 `/notes/:id`）

**Steps:**

- [ ] 在 `static/js/notes.js` 新增 `renderNoteDetail(root, params)`：

  - 载入 `api.get('/api/notes/' + params.id)`；`NOT_FOUND` 时显示空态「笔记不存在或已被删除」+「返回笔记列表」按钮。
  - 结构（单栏纸张）：
    - `<h1 class="detail-title">`：标题，空则显示「无标题」。
    - `.detail-meta`：状态徽标 + 更新时间 + 「共 N 字」+ 标签 chips。
    - `.detail-body.markdown-body`：`renderMarkdown(note.content_md)`；`content_md` 为空时显示「（空白笔记）」。
    - `.detail-actions`：本阶段只放 `编辑`（→ `/notes/<id>/edit`）与 `删除`（危险按钮）。分享与收藏按钮分别由 Phase 6、Phase 7 在此处插入。
    - 正文最大宽度 `var(--reading-max)` 并居中。
  - 删除：`confirmDialog({ title:'删除笔记', message:'确定要删除这篇笔记吗？删除后无法恢复。', confirmText:'确定删除', danger:true })`，确认后 `api.del('/api/notes/<id>')` → toast「已删除」→ `navigate('/notes')`。

- [ ] 在 `router.js` 注册：

```js
registerRoute('/notes/:id', async (root, params) => {
  const { renderNoteDetail } = await import('./notes.js');
  renderNoteDetail(root, params);
}, { requiresAuth: true });
```

- [ ] `notes.css` 追加 `.detail-title`（`var(--fs-h2)`，字重 600）、`.detail-meta`（`var(--fs-sm)` + `var(--c-text-muted-strong)`，`display:flex; flex-wrap:wrap; gap:var(--sp-3); align-items:center`）、`.detail-body`（`max-width:var(--reading-max); margin:0 auto;`）、`.detail-actions`（顶部 `var(--bd)` 分隔，按钮 `gap:var(--sp-3)`；`≤768px` 按钮半宽换行）。

- [ ] 手工验证：创建一篇含标题、标签、图片、列表、引用的笔记 → 详情页渲染正确且排版可读；点「删除」→ 确认 → 回到列表且该篇消失；直接访问已删除笔记的 `/notes/<id>` → 显示「笔记不存在或已被删除」。

**Dependencies:** Task 1、Task 2、Task 3、Phase 4 Task 2

---

## Task 5: 笔记前端视觉与流程验收

**Goal:** 按清单核对笔记列表、编辑器、详情页的视觉与交互，修复发现的问题。

**Files:**
- Modify: `tests/manual/visual-checklist.md`

**Steps:**

- [ ] 在 `tests/manual/visual-checklist.md` 追加「Phase 5 · 笔记前端」表格：

| # | 路由 | 视口 | 状态 | 检查点 | 结果 |
|---|------|------|------|--------|------|
| 1 | `/notes` | 1440×900 | 有数据 | 工具条四项控件齐备；卡片网格自动填充；卡片为纸张质感 | |
| 2 | `/notes` | 1440×900 | 空态 | 显示「还没有笔记，去写下第一篇吧」与「写第一篇笔记」按钮 | |
| 3 | `/notes` | 1440×900 | 搜索无结果 | 显示「没有找到符合条件的笔记」与「清除筛选」 | |
| 4 | `/notes` | 1440×900 | 加载中 | 显示 6 个骨架卡片 | |
| 5 | `/notes` | 375×812 | 有数据 | 工具条换行、搜索框整宽、卡片单列、无横向滚动 | |
| 6 | `/notes/new` | 1440×900 | 默认 | 标题输入无边框大字号；左右分栏等比；纸张容器 | |
| 7 | `/notes/new` | 1440×900 | 输入中 | 右侧渲染结果与左侧一致；代码块有底色与横向滚动 | |
| 8 | `/notes/new` | 1440×900 | 脏标记 | 改动后底部显示「未保存的更改」；点导航弹确认弹窗 | |
| 9 | `/notes/new` | 375×812 | 默认 | 出现「编辑 / 预览」切换，默认显示编辑 | |
| 10 | `/notes/:id` | 1440×900 | 有数据 | 标题、元信息、纸张正文、操作条；正文宽度 720px 居中 | |
| 11 | `/notes/:id` | 1440×900 | 删除确认 | 弹窗文案「确定要删除这篇笔记吗？删除后无法恢复。」 | |
| 12 | `/notes/:id` | 1440×900 | 不存在 | 显示「笔记不存在或已被删除」与返回按钮 | |
| 13 | `/notes/new` | 键盘 | 默认 | Tab 依次可达标题、标签、两个按钮、图片按钮、正文 | |
| 14 | `/notes` + `/notes/new` | 1440×900 | 减动效 | 模拟 `prefers-reduced-motion` 后卡片无位移过渡 | |

- [ ] 逐项截图核对并填写「结果」列；修复问题后重新截图。

- [ ] 执行 `tests/manual/xss-fixtures.md` 的 6 条样例，把结论追加到清单末尾（含「保存后刷新详情页仍被清洗」一项）。

**Visual Verification:** 本任务产出即 Phase 5 验收记录。

**Dependencies:** Task 1–4

---

## Phase Completion Checklist

- [ ] 全部 5 个任务完成
- [ ] `.venv/Scripts/python.exe -m pytest tests/ -v` 全部通过（本阶段无后端改动，属回归）
- [ ] 笔记列表的筛选、搜索、排序、分页、空态、骨架全部可用，刷新后筛选状态保留
- [ ] 编辑器分栏实时预览可用，图片可插入并可正常显示
- [ ] 存草稿、发布、删除、脏标记离开拦截、`Ctrl+S` 全部可用
- [ ] 详情页正文排版可读，删除后回到列表；已删除笔记直链显示空态
- [ ] `tests/manual/xss-fixtures.md` 的 6 条样例全部通过，且保存后刷新仍被清洗
- [ ] `tests/manual/visual-checklist.md` 中 Phase 5 的 14 行 + XSS 结论已填写
- [ ] `notes.css`、`editor.css` 中无硬编码色值
- [ ] 可以进入 Phase 6
