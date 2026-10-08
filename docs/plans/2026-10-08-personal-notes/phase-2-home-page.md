# Phase 2: 静态主页与关于页

**Goal:** 交付与设计稿一致的静态主页与关于页（未登录态），把设计令牌落实为可复用的顶栏与页面结构。

**Prerequisites:** Phase 1 完成（应用可启动、`base.css` 令牌就位、`static/img/` 素材可用、`router.js` 可注册路由）。

**Deliverables:**
- `AppHeader` 未登录态（桌面 + 移动抽屉）
- 主页 Hero：标题、副文案、双按钮、四项特性条，桌面与移动两套布局
- 关于页：应用介绍、功能清单、技术栈说明、致谢、联系方式占位
- 两页在 1440×900 与 375×812 两档下的截图验收记录

**Interface Decisions Implemented:**
- 顶栏未登录态：`登录 / 注册 / 关于`（Phase 3 补已登录态）
- 主页 Hero 布局：桌面文案区占左侧约 45%，hero 高度 ≈ 视口高减去特性条；标题 40px/600/字距 .02em，标题下 4px 金色短下划线
- 主按钮驼金填充 + 深色文字（对比度修正）、次按钮描边
- 特性条：圆底图标 + 标题 + 说明，四列；`≤768px` 单列
- `≤768px`：顶栏收为汉堡抽屉；hero 改为整幅深色遮罩上图、文案左对齐、特性条单列
- hero 素材使用 `<picture>` 加载 WebP 并回退 JPG，`srcset` 提供 1920/960 两档

---

## Task 1: 顶栏组件（未登录态）与移动抽屉

**Goal:** 把顶栏抽成可复用的 `renderHeader()`，供主页、关于页及后续应用内页面共用，并支持移动端抽屉。

**Files:**
- Modify: `static/js/ui.js`
- Modify: `static/css/base.css`
- Modify: `static/js/router.js`（无需改动，Phase 1 已调用 `renderHeader`）

**Steps:**

- [ ] 在 `static/js/ui.js` 中实现 `renderHeader(user, activePath)`：

  - 结构：`<nav class="app-header">` 内含左侧品牌区（`<a href="/">` + `logo.svg` + 文本「个人笔记」）与右侧导航区 `<ul class="nav-links">`。
  - 未登录态渲染三个链接：`登录` → `/login`、`注册` → `/register`、`关于` → `/about`。
  - 已登录态暂时也渲染未登录三链接，并在函数顶部留 `// Phase 3 在此切换为「写笔记 / 我的主页 / 头像菜单」` 注释占位（Phase 3 Task 4 会替换）。
  - 当前路径与链接路径一致时给该链接加 `aria-current="page"` 与 `.is-active`。
  - 移动端汉堡：`<button class="nav-toggle" aria-label="打开导航菜单" aria-expanded="false" aria-controls="nav-drawer">` 与 `<div id="nav-drawer" class="nav-drawer">`；点击切换 `aria-expanded` 与 `.is-open`；按 `Escape` 或点击遮罩时关闭并回焦汉堡按钮。

- [ ] 在 `static/css/base.css` 中补齐顶栏样式：

  - `.app-header`：`position: sticky; top: 0; z-index: 20;`，高 `var(--header-h)`，背景 `var(--c-surface)`，底部 `var(--bd)`；内容居中、最大宽 `var(--page-max)`、左右内边距 `var(--gutter)`。
  - `.app-header.is-scrolled`：加 `var(--sd-card)`；在 `ui.js` 中监听 `scroll`，`window.scrollY > 8` 时切换该类。
  - 品牌区图标 32×32，文本 `var(--fs-h3)` + `var(--c-text)` + 字重 600。
  - `.nav-links a`：`var(--fs-base)`、`var(--c-text-muted-strong)`；`:hover` 与 `.is-active` 用 `var(--c-primary-hover)`。
  - `@media (max-width: 768px)`：`.nav-links` 与 `.nav-toggle` 互换可见性；抽屉从右侧滑出，宽度 `min(280px, 80vw)`，遮罩 `rgba(61,54,48,.32)`。
  - 所有可点元素 `:focus-visible` 使用 `2px solid var(--c-primary-hover)` 描边，触摸目标 ≥ 44×44px。

- [ ] 手工验证：

```bash
.venv/Scripts/python.exe app.py run
```

  - Expected: 访问 `/` 时顶栏显示「个人笔记 + 登录 注册 关于」；滚动后出现阴影；窗口宽度缩到 375px 时导航收为汉堡按钮，点击抽屉展开，`Esc` 可关闭且焦点回到汉堡按钮

**Dependencies:** Phase 1 Task 5

---

## Task 2: 主页 Hero 与特性条

**Goal:** 按设计稿实现主页首屏。

**Files:**
- Create: `static/js/home.js`（替换 Phase 1 的占位空模块）
- Create: `static/css/home.css`（替换 Phase 1 的空文件）
- Modify: `static/js/router.js`（把 `/` 路由的占位视图改为加载 `home.js`）

**Steps:**

- [ ] 创建 `static/js/home.js`，导出 `renderHome(root)`，并以文案常量集中声明（逐字对齐设计稿，不得改写）：

```js
import { store } from './store.js';
import { navigate } from './router.js';

const HERO = {
  titleLines: ['记录生活 · 书写成长', '遇见美好'],
  subtitle: [
    '个人笔记是一款简洁优雅的在线笔记应用，',
    '帮助你随时随地记录灵感、管理任务、沉淀思考，',
    '让每一个想法都被珍藏，让每一天都更有意义。',
  ],
  primaryCta: '开始记录',
  secondaryCta: '了解更多',
};

const FEATURES = [
  { icon: 'notebook', title: '简洁易用', desc: '界面清新，专注记录' },
  { icon: 'cloud',    title: '云端同步', desc: '多端同步，安全可靠' },
  { icon: 'shield',   title: '隐私保护', desc: '数据加密，隐私无忧' },
  { icon: 'tag',      title: '灵活分类', desc: '标签管理，高效查找' },
];
```

- [ ] 同文件实现结构：

  - `<section class="hero">` 内含 `<picture class="hero-media">`（`<source type="image/webp" srcset="/static/img/hero.webp 1920w, /static/img/hero-960.webp 960w" sizes="100vw">` + `<img src="/static/img/hero.jpg" srcset="/static/img/hero.jpg 1920w, /static/img/hero-960.jpg 960w" sizes="100vw" alt="铺着阳光的桌面上放着咖啡、翻开的手写笔记本与一枝白色小花">`），以及 `<div class="hero-copy">`。
  - `hero-copy`：`<h1>` 两行标题（行间用 `<br>`），`<span class="hero-underline" aria-hidden="true">` 作 4px 金色短下划线；`<p class="hero-sub">` 三行副文案（每行一个 `<span>` + `<br>`，移动端可自然换行）；按钮区两个 `<button>`：`.btn.btn-primary`「开始记录」、`.btn.btn-ghost`「了解更多」（各带前置内联 SVG 笔形图标与播放形图标，`aria-hidden="true"`）。
  - `<h1>` 上方叠加一个装饰心形（`aria-hidden="true"`，主色 `var(--c-primary)`），位置与设计稿一致（标题右上）。
  - `<section class="features">` 四项：`<ul>` 内每项 `<li>` 为 `.feature`，含圆形图标底（`var(--c-surface)` + 1px 边框）+ `<h3>` 标题 + `<p>` 说明。

- [ ] 按钮行为：

  - 「开始记录」：`store.isLoggedIn()` 为真则 `navigate('/notes/new')`，否则 `navigate('/login?redirect=' + encodeURIComponent('/notes/new'))`。
  - 「了解更多」：`navigate('/about')`。

- [ ] `static/css/home.css` 实现：

  - `.hero`：`display: grid; grid-template-columns: 45% 55%; min-height: calc(100vh - var(--header-h) - 140px);`（140px 为特性条预留），背景图为 hero 图并 `background-size: cover`，作为 `<picture>` 之外的兜底。
  - `.hero-media img`：`width: 100%; height: 100%; object-fit: cover;`，桌面端铺满右侧并向右溢出到视口边缘（`justify-self: end; width: 120%;`），左侧用 `linear-gradient(90deg, var(--c-page), transparent)` 做柔和过渡。
  - `.hero-copy`：左内边距 `var(--sp-16)`，垂直居中；`h1` 用 `var(--fs-hero)`、字重 600、字距 .02em、行高 1.3；`.hero-sub` 用 `var(--fs-base)`、`var(--c-text-muted-strong)`、行高 `var(--lh-base)`。
  - `.hero-underline`：`display:block; width:96px; height:4px; border-radius:2px; background:var(--c-accent); margin:var(--sp-4) 0 var(--sp-6);`
  - `.features`：`display:grid; grid-template-columns:repeat(4,1fr); gap:var(--sp-6); max-width:var(--page-max); margin:0 auto; padding:var(--sp-8) var(--gutter) var(--sp-12);`
  - `.feature-icon`：`width:56px; height:56px; border-radius:50%; display:grid; place-items:center; background:var(--c-surface); border:var(--bd); color:var(--c-accent);`
  - `@media (max-width:1199px)`：`grid-template-columns:55% 45%`；`.features` 改 `repeat(2, 1fr)`。
  - `@media (max-width:768px)`：`.hero` 改单列，`min-height:auto`，`.hero-media` 绝对定位铺满并叠加 `rgba(61,54,48,.35)` 遮罩，`.hero-copy` 改为 `position:relative; padding: var(--sp-12) var(--gutter); color:#fff`；`.hero-sub` 与 h1 在遮罩上使用白色系（`#fff` 与 `rgba(255,255,255,.88)`）；`.features` 改单列。

- [ ] 在 `router.js` 中把 `/` 的占位视图替换为动态导入：

```js
registerRoute('/', async (root) => {
  const { renderHome } = await import('./home.js');
  renderHome(root);
});
```

- [ ] 手工验证：`http://127.0.0.1:5000/` 桌面宽度下标题两行、副文案三行、双按钮、四项特性横排；点击「开始记录」跳到 `/login?redirect=%2Fnotes%2Fnew`（Phase 3 前登录页为空页属正常）；点击「了解更多」跳到 `/about`。

**Visual Verification:**
- 1440×900：与 `图片素材/个人笔记-主页截图.jpg` 对照——标题断行、下划线位置、按钮排布、特性条四列与图标底色一致
- 375×812：汉堡出现、hero 文案转为遮罩上的白色左对齐、特性条单列、无横向滚动条
- DevTools 计算样式抽查：`h1` 字号 40px、`.hero-underline` 高度 4px 且颜色为 `#D9B98C`

**Dependencies:** Phase 1 Task 6（hero 素材）、Task 1（顶栏）

---

## Task 3: 关于页

**Goal:** 交付静态关于页，承载应用介绍、功能清单与技术栈说明。

**Files:**
- Create: `static/js/about.js`
- Create: `static/css/about.css`
- Modify: `static/js/router.js`（注册 `/about`）

**Steps:**

- [ ] 创建 `static/js/about.js`，导出 `renderAbout(root)`，页面含四个纸卡片区块：

  1. **应用介绍**：标题「关于个人笔记」，正文「个人笔记是一款简洁优雅的在线笔记应用，帮助你随时随地记录灵感、管理任务、沉淀思考。所有笔记默认只有你自己可见，需要分享时可以生成带密码的链接。」
  2. **功能清单**：`<ul>` 列出 8 项，逐字使用：`Markdown 笔记撰写与实时预览`、`草稿与发布状态管理`、`标签分类与关键词搜索`、`带密码的链接分享`、`笔记评论`、`笔记收藏`、`浏览足迹回顾`、`图片上传与引用`
  3. **技术栈说明**：表格或定义列表，内容为「页面显示：原生 HTML + CSS + JavaScript」「服务端：Python 3.12 + Flask」「数据库：SQLite」「Markdown 渲染：marked + DOMPurify（本地内置，不使用在线 CDN）」
  4. **致谢与联系方式**：致谢「Markdown 渲染由 marked 提供，HTML 清洗由 DOMPurify 提供，均以本地文件方式内置」；联系方式使用占位文本「联系邮箱：example@example.com」，并在 `about.js` 顶部以常量 `CONTACT_EMAIL` 声明，便于替换。

- [ ] `static/css/about.css` 实现：

  - `.about-page`：`max-width: var(--reading-max); margin: 0 auto; padding: var(--sp-12) var(--gutter) var(--sp-16);`
  - `.paper` 区块间距 `var(--sp-6)`，内边距 `var(--sp-8)`；`h2` 用 `var(--fs-h2)`；正文 `var(--fs-base)` / `var(--lh-reading)` / `var(--c-text)`；列表项前用 `var(--c-accent)` 圆点。
  - 技术栈定义列表用两列网格（`grid-template-columns: 120px 1fr`），`≤768px` 改单列。

- [ ] 在 `router.js` 中注册：

```js
registerRoute('/about', async (root) => {
  const { renderAbout } = await import('./about.js');
  renderAbout(root);
});
```

- [ ] 手工验证：访问 `http://127.0.0.1:5000/about`，四个区块自上而下完整显示；顶栏「关于」链接带 `aria-current="page"`；375px 宽度下技术栈改单列且无横向滚动。

**Dependencies:** Task 1（顶栏）

---

## Task 4: 主页与关于页视觉验收

**Goal:** 用清单化截图核对主页与关于页是否达到设计稿保真度，并修复发现的层级、间距、溢出、重叠、对比度问题。

**Files:**
- Create: `tests/manual/visual-checklist.md`
- Modify: 按发现的视觉缺陷修改 `home.css`、`base.css`、`about.css`

**Steps:**

- [ ] 创建 `tests/manual/visual-checklist.md`，用下表逐项填写「截图文件名 + 通过/问题 + 修复说明」：

```markdown
# 视觉与交互验收清单

## Phase 2 · 主页 / 关于页

| # | 路由 | 视口 | 状态 | 检查点 | 结果 |
|---|------|------|------|--------|------|
| 1 | `/` | 1440×900 | 默认 | 标题两行断行与设计稿一致；下划线 4px 且在标题下方 | |
| 2 | `/` | 1440×900 | 默认 | 副文案三行、行高 1.75、颜色为次文字强化色 | |
| 3 | `/` | 1440×900 | 默认 | 双按钮并排，主按钮为驼金底深色字 | |
| 4 | `/` | 1440×900 | 默认 | 特性条四列，圆形图标底有 1px 边框与金色图标 | |
| 5 | `/` | 1440×900 | 滚动 | 顶栏出现阴影 | |
| 6 | `/` | 375×812 | 默认 | 汉堡按钮可见、导航隐藏、无横向滚动条 | |
| 7 | `/` | 375×812 | 抽屉展开 | 抽屉从右滑入，遮罩可见，Esc 可关且焦点回汉堡 | |
| 8 | `/` | 375×812 | 默认 | hero 文案为遮罩上的白色左对齐，特性条单列 | |
| 9 | `/about` | 1440×900 | 默认 | 四区块顺序正确、间距一致 | |
| 10 | `/about` | 375×812 | 默认 | 技术栈定义列表单列，无溢出 | |
| 11 | 两页 | 键盘 | 默认 | Tab 依次可达顶栏链接与页面按钮，焦点环可见 | |
| 12 | 两页 | 1440×900 | 减动效 | DevTools 模拟 prefers-reduced-motion 后无过渡动画 | |
```

- [ ] 逐项截图（Chrome DevTools 设备工具栏切换 1440×900 与 375×812），对照 `图片素材/个人笔记-主页截图.jpg` 判断断行、间距、配色是否一致，把结论写入清单「结果」列。

- [ ] 修复清单中标记为问题的项，重新截图确认；允许的偏差只有「素材图裁切比例」与「系统字体渲染差异」两类，其余偏差必须修复。

- [ ] 用对比度核算工具确认主按钮「白底/驼金底 + 深色字」的对比度 ≥ 4.5:1，把实测值写入清单。

**Visual Verification:** 本任务产出即验收记录；Phase 8 会在此表基础上追加应用内页面与全部状态行。

**Dependencies:** Task 1、Task 2、Task 3

---

## Phase Completion Checklist

- [ ] 全部 4 个任务完成
- [ ] `.venv/Scripts/python.exe -m pytest tests/ -v` 仍全部通过（本阶段无新增接口，回归即可）
- [ ] 主页在 1440×900 与 375×812 两档下与设计稿一致，无横向滚动
- [ ] 关于页四区块完整，联系方式为占位文本
- [ ] 顶栏未登录态、滚动阴影、移动抽屉三态均可用，键盘可达
- [ ] `tests/manual/visual-checklist.md` 中 12 行均填写结论，问题项已修复
- [ ] `home.css`、`about.css` 中无硬编码色值（全部引用 `base.css` 令牌）
- [ ] 可以进入 Phase 3
