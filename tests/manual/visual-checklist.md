# 视觉与交互验收清单

## Phase 2 · 主页 / 关于页

> 环境说明：本执行环境（Windows 11 / Git Bash）**没有可用浏览器**，无法截图。
> 凡依赖像素渲染或 DevTools 的检查点，均以「待人工确认（本环境无浏览器）」标注，**不视为已通过**。
> 可自动化的部分改用两条替代验证路径，并在下表中给出具体证据：
> 1. `tests/js/render.mjs`（Node + 最小 DOM 双端）真实调用 `static/js` 渲染函数，断言生成的文案、结构与 ARIA；
> 2. `tests/test_static_pages.py` 断言 CSS 断点/尺寸契约与令牌接线。
> 对照稿：`图片素材/个人笔记-主页截图.jpg`（仅作参照，不作为资源）。

| # | 路由 | 视口 | 状态 | 检查点 | 结果 |
|---|------|------|------|--------|------|
| 1 | `/` | 1440×900 | 默认 | 标题两行断行与设计稿一致；下划线 4px 且在标题下方 | 结构/样式自动断言通过：`test_home_hero_copy_verbatim`（`<h1>` 含 `<br>` 且两行文案齐全）、`test_hero_underline_and_heart`（`.hero-underline` width 96px / height 4px / background `var(--c-accent)` / margin 在标题之后）；与设计稿**像素级对照：待人工确认（本环境无浏览器）** |
| 2 | `/` | 1440×900 | 默认 | 副文案三行、行高 1.75、颜色为次文字强化色 | 自动断言通过：`test_home_hero_copy_verbatim`（三个 `<span>` 行）、`test_hero_media_and_copy`+CSS（`.hero-sub` line-height `var(--lh-base)`=1.75、color `var(--c-text-muted-strong)` #6E6459，页面底实测 5.46:1） |
| 3 | `/` | 1440×900 | 默认 | 双按钮并排，主按钮为驼金底深色字 | 自动断言通过：`test_home_hero_buttons`（`.btn.btn-primary`「开始记录」+`.btn.btn-ghost`「了解更多」）、`.hero-actions` flex 并排；主按钮实测 `#3D3630` on `#D9B98C` = **6.37:1**（见下节） |
| 4 | `/` | 1440×900 | 默认 | 特性条四列，圆形图标底有 1px 边框与金色图标 | 自动断言通过：`test_home_features_four_items`（4× `.feature`/`.feature-icon`，文案齐全）、`test_features_grid`（`repeat(4, 1fr)`）、`test_feature_icon_circle`（56×56 / 50% / `var(--bd)` / `var(--c-accent)`） |
| 5 | `/` | 1440×900 | 滚动 | 顶栏出现阴影 | 自动断言通过：`test_header_scroll_shadow_toggles`（scrollY>8 加 `.is-scrolled`，回顶移除）、`test_scroll_shadow_class`（`.app-header.is-scrolled { box-shadow: var(--sd-card) }`） |
| 6 | `/` | 375×812 | 默认 | 汉堡按钮可见、导航隐藏、无横向滚动条 | 自动断言通过：`test_toggle_visible_only_on_mobile`（≤768px `.nav-toggle` display:inline-flex）、`test_mobile_drawer_slides_from_right`（抽屉 `translateX(100%)` + `visibility:hidden` 移出视口）、`test_hero_mobile_overlay`（`.hero-media` 绝对定位）；「**无横向滚动条**」为布局结果：**待人工确认（本环境无浏览器）** |
| 7 | `/` | 375×812 | 抽屉展开 | 抽屉从右滑入，遮罩可见，Esc 可关且焦点回汉堡 | 自动断言通过：`test_header_drawer_open_escape_and_scrim`（`translateX(100%)→0`、`.nav-scrim.is-visible { display:block }`、点汉堡 `aria-expanded=true`、Esc 关闭后 `aria-expanded=false` 且 `document.activeElement` 回到汉堡、点击遮罩关闭）；滑入**动画观感：待人工确认** |
| 8 | `/` | 375×812 | 默认 | hero 文案为遮罩上的白色左对齐，特性条单列 | 自动断言通过：`test_hero_mobile_overlay`（`.hero::before` 用 `var(--c-overlay)`）、`test_hero_media_and_copy`（≤768px `.hero-copy` color `var(--c-on-image)`）、`test_features_grid`（≤768px 单列）；遮罩上文字的**实际可读性观感：待人工确认** |
| 9 | `/about` | 1440×900 | 默认 | 四区块顺序正确、间距一致 | 自动断言通过：`test_about_page_sections`（4× `section.paper`，顺序 应用介绍→功能清单→技术栈→致谢与联系方式）、`test_about_paper_spacing`（`.paper + .paper` margin-top `var(--sp-6)`，内边距 `var(--sp-8)`）；**像素级间距：待人工确认** |
| 10 | `/about` | 375×812 | 默认 | 技术栈定义列表单列，无溢出 | 自动断言通过：`test_about_tech_list_two_columns`（桌面 `120px 1fr`，≤768px `1fr`）；**窄屏无溢出/换行观感：待人工确认** |
| 11 | 两页 | 键盘 | 默认 | Tab 依次可达顶栏链接与页面按钮，焦点环可见 | 部分自动断言通过：顶栏三个链接与汉堡按钮均可聚焦（`test_header_hamburger_and_drawer_aria`）、抽屉打开聚焦首个链接（`test_header_drawer_open_escape_and_scrim`）、`:focus-visible` 2px `var(--c-primary-hover)`（base.css）；**完整 Tab 走查与焦点环可见性：待人工确认（本环境无浏览器）** |
| 12 | 两页 | 1440×900 | 减动效 | DevTools 模拟 prefers-reduced-motion 后无过渡动画 | 自动断言通过：base.css `@media (prefers-reduced-motion: reduce)` 将 `animation-duration`/`transition-duration` 压到 `.01ms !important`；**DevTools 模拟实测：待人工确认** |

---

## 对比度实测（Task 4 要求：主按钮 ≥ 4.5:1）

命令：`.venv/Scripts/python.exe tests/manual/check_contrast.py`（退出码 0 = 全部达标）

| 组合 | 前景 / 背景 | 实测 | 要求 |
|------|-------------|------|------|
| 主按钮静止 文字/底色 | #3D3630 / #D9B98C | **6.37:1** | ≥4.5:1 ✅ |
| 主按钮悬停 文字/底色 | #3D3630 / #C3A47B | **5.04:1** | ≥4.5:1 ✅ |
| 正文 文字/页面底 | #3D3630 / #FAF8F5 | 11.20:1 | ≥4.5:1 ✅ |
| 次文字强化 文字/页面底 | #6E6459 / #FAF8F5 | 5.46:1 | ≥4.5:1 ✅ |
| 链接 文字/页面底 | #8A6D42 / #FAF8F5 | 4.56:1 | ≥4.5:1 ✅ |
| 链接悬停 文字/页面底 | #6E5228 / #FAF8F5 | 6.83:1 | ≥4.5:1 ✅ |
| 危险按钮 文字/卡片底 | #9E4436 / #FFFFFF | 6.30:1 | ≥4.5:1 ✅ |
| 危险按钮悬停 白字/危险底 | #FFFFFF / #9E4436 | 6.30:1 | ≥4.5:1 ✅ |
| 字段错误 文字/页面底 | #9E4436 / #FAF8F5 | 5.94:1 | ≥4.5:1 ✅ |
| 成功/失败/信息 toast 白字/底色 | #FFFFFF / #4F6B41 / #9E4436 / #8A6D42 | 5.98 / 6.30 / 4.83:1 | ≥4.5:1 ✅ |
| 顶栏激活链接 文字/顶栏底 | #6E5228 / #FFFFFF | 7.24:1 | ≥4.5:1 ✅ |
| 交互描边 页面底 / 卡片底 | #A6835A / #FAF8F5 · #FFFFFF | 3.29 / 3.49:1 | ≥3.0:1 ✅ |

### 修复前 → 修复后（本阶段强制修正项）

| 项 | 修复前 | 修复后 |
|----|--------|--------|
| 主按钮 | `--c-primary-hover` #B08F63，**3.93:1** ❌ | `--c-accent` #D9B98C，**6.37:1** ✅ |
| 链接文字 | #B08F63，**2.85:1** ❌ | `--c-info-strong` #8A6D42，**4.56:1** ✅ |
| 危险按钮文字 | #C25E4E，**4.20:1** ❌ | `--c-danger-strong` #9E4436，**6.30:1** ✅ |
| 字段错误文字 | #C25E4E，**3.96:1** ❌ | #9E4436，**5.94:1** ✅ |
| 成功/失败/信息 toast | #6B8E5A/#C25E4E/#C3A47B，**3.72 / 4.20 / 2.36:1** ❌ | #4F6B41/#9E4436/#8A6D42，**5.98 / 6.30 / 4.83:1** ✅ |
| 交互组件描边 | #EDE7DE，**1.16:1** ❌ | `--c-border-strong` #A6835A，**3.29:1** ✅ |

---

## 证据与命令

| 命令 | 结果 |
|------|------|
| `.venv/Scripts/python.exe -m pytest tests/ -q` | 62 passed |
| `.venv/Scripts/python.exe tests/manual/check_contrast.py` | 全部达标（退出码 0） |
| `node tests/js/render.mjs` | 渲染 `#app-header` / 主页 / 关于页并输出按钮跳转目标 |
| `node --check static/js/{home,about,ui,router}.js` | 语法通过 |

代码定位：顶栏渲染 `static/js/ui.js renderHeader()`；主页 `static/js/home.js renderHome()`；关于页 `static/js/about.js renderAbout()`；路由 `static/js/router.js`（`/`、`/about`）。

---

## 待人工确认的截图清单（本环境无浏览器，未采集）

建议在 Chrome DevTools 设备工具栏按下列组合各截一张，文件名即验收记录：

- `phase2-home-1440x900.png`（行 1–5）
- `phase2-home-375x812.png`（行 6、8）
- `phase2-home-375x812-drawer.png`（行 7）
- `phase2-about-1440x900.png`（行 9）
- `phase2-about-375x812.png`（行 10）
- 键盘走查与 reduced-motion 无截图，按行 11、12 逐项手工确认

## 遗留风险

1. **焦点环对比度**：规范与计划均要求 `:focus-visible` 使用 2px `#B08F63`（`--c-primary-hover`），该色对页面底实测 **2.85:1**，略低于 WCAG 1.4.11 的 3:1。本阶段严格遵循规范未改动；如需完全达标，可将焦点环改用 `--c-border-strong` #A6835A（3.29:1），但会偏离已确认的设计方向，需 master 决定。
2. **移动端遮罩上的正文可读性**：`--c-on-image` / `--c-on-image-muted` 叠加在 `--c-overlay` 与照片之上，静态令牌核算无法覆盖照片底纹，需人工在真实浏览器确认。
3. **DOM 双端差异**：Node 侧用最小 DOM 双端执行真实渲染函数，断言的是节点树/属性，不覆盖浏览器布局、层叠与动画。

---

## Phase 3 · 用户体系

> 环境说明：本执行环境（Windows 11 / Git Bash）**没有可用浏览器**，无法点击、截图或使用 DevTools。
> 凡依赖像素渲染/动画观感/真实浏览器行为的检查点，均以「**待人工确认（本环境无浏览器）**」标注，**不视为已通过**。
> 替代验证路径（已执行并给出证据）：
> 1. `tests/js/render_auth.mjs`（复用 `tests/js/dom-shim.mjs` 最小 DOM 双端）真实调用 `static/js/auth.js` 的
>    `renderLogin`/`renderRegister`、`ui.js` 的已登录顶栏与 `router.js` 的登录守卫，断言标记/字段校验/redirect 白名单/头像菜单/退出确认；
> 2. `tests/test_auth_api.py`、`tests/test_users_api.py`、`tests/test_rate_limit.py` 用 Flask test client 驱动六条链路（注册/登录/登出/me/资料/改密）与 CSRF、Origin、限流；
> 3. `tests/test_auth_views.py` 内联 CSS 契约断言覆盖 auth.css 的布局/尺寸/错误态令牌。

| # | 路由 | 视口 | 状态 | 检查点 | 结果 |
|---|------|------|------|--------|------|
| 1 | `/login` | 1440×900 | 默认 | 卡片居中、宽 420px、两字段与提交按钮 | 自动断言通过：`test_login_page_structure_and_copy`（`.auth-page`/`.auth-card`/h1「登录」/按钮「登录」）、`test_login_fields_types_and_autocomplete`（邮箱+密码）、`test_auth_page_layout`（`place-items:center`）、`test_auth_card_dimensions`（`width:min(420px,100%)`）；**像素级观感：待人工确认（本环境无浏览器）** |
| 2 | `/register` | 1440×900 | 默认 | 四字段、底部「已有账号？去登录」 | 自动断言通过：`test_register_page_structure_and_copy`（底部链接文案/`href=/login`）、`test_register_fields_types_and_autocomplete`（邮箱/用户名/密码/确认密码）；**像素级观感：待人工确认** |
| 3 | `/register` | 375×812 | 默认 | 卡片宽度不超过视口，输入框高 44px | 自动断言通过：`test_auth_card_dimensions`（`width:min(420px,100%)`，窄屏自适应）、`test_auth_input_height_and_invalid_state`（`height:44px`）；**窄屏实际换行/溢出：待人工确认** |
| 4 | `/login` | 1440×900 | 字段错误 | 邮箱 `abc` 失焦后红色下划线 + 「请输入正确的邮箱地址」 | 自动断言通过：`test_email_blur_marks_invalid_and_clears_on_fix`（文案逐字、`.is-invalid`、`aria-invalid`）、`test_auth_input_height_and_invalid_state`（`.field input.is-invalid{border-color:var(--c-danger)}`）、`test_error_copy_sync`（前后端逐字一致）；**红色下划线观感：待人工确认** |
| 5 | `/register` | 1440×900 | 字段错误 | 密码 `abcdefgh` 失焦后显示密码强度文案 | 自动断言通过：`test_password_blur_reports_weak`、`test_register_username_password_confirm_validation`（用户名/密码/确认密码三类文案 + 修正后清空）；**观感：待人工确认** |
| 6 | `/login` | 1440×900 | 提交中 | 按钮禁用并显示「提交中…」 | 自动断言通过：`test_submit_enters_loading_state`（文案「提交中…」、`disabled` 属性、`.is-loading`、`.spinner`）；**转圈动画观感：待人工确认** |
| 7 | `/login` | 1440×900 | 请求失败 | 错误密码提交后右上角 toast 显示「邮箱或密码错误」 | 后端文案自动断言通过：`test_login_wrong_password`（401 `INVALID_CREDENTIALS`，文案「邮箱或密码错误」来自 `core/errors.py`，由 `api.js` 统一弹出）；字段级服务端错误映射 `test_server_error_maps_to_field`；**toast 实际渲染位置/停留：待人工确认** |
| 8 | 全局 | 1440×900 | 已登录 | 顶栏为「写笔记 / 我的主页 / 头像」，头像为首字色块 | 自动断言通过：`test_header_logged_in_links`（写笔记→/notes/new、我的主页→/me、关于→/about）、`test_header_avatar_button_shows_first_character`（`.avatar-btn`、`aria-haspopup="menu"`、首字 `a`）、`test_avatar_button_is_first_char_color_block`（36×36 圆形、`var(--c-accent)` 底）；**色块观感：待人工确认** |
| 9 | 全局 | 375×812 | 已登录 | 抽屉内含三项导航与退出登录 | 自动断言通过：`test_header_logged_in_links`（三项导航）、`test_avatar_menu_items_and_open_state`（菜单项「个人主页」「退出登录」）；base.css ≤768px 将头像菜单并入抽屉（`.nav-user .avatar-btn{display:none}`、`.avatar-menu{position:static}`）；**抽屉展开观感：待人工确认** |
| 10 | 任意页 | 1440×900 | 退出确认 | 弹窗标题「退出登录」，`Esc` 可关且焦点回弹 | 自动断言通过：`test_logout_uses_confirm_dialog_with_escape`（标题/确认文案「退出登录」、`role=dialog`、`aria-modal`、Esc 关闭、焦点回弹到触发按钮）、`test_confirmed_logout_calls_api_and_returns_home`（`POST /api/auth/logout` → 清空 store → toast → 回 `/`）；**弹窗动画观感：待人工确认** |

### 三项安全走查

| # | 走查项 | 结论 |
|---|--------|------|
| 1 | 未登录访问 `/notes`、`/me` → 跳 `/login?redirect=...`，登录后回原路径 | 守卫机制自动断言通过：`test_guard_redirects_anonymous_to_login_with_back_target`（受保护路由 `requiresAuth` 未登录时 `replace` 跳 `/login?redirect=%2Fguard-test`）。**注：Phase 3 尚未注册 `/notes`、`/me` 路由**（按阶段边界留待后续阶段），此时访问落到「页面不存在」视图且守卫不崩溃（`test_unregistered_route_does_not_crash_guard`）；「登录后回到原路径」需待路由注册后**人工确认** |
| 2 | `redirect` 传 `//evil.example`、`https://evil.example`、`/notes` 三种值的实际落点 | 自动断言通过：`test_redirect_whitelist_predicate` → `//evil.example`→`/me`、`https://evil.example`→`/me`、`/notes`→`/notes`（另含 `/notes?page=2` 放行、空值/`\evil` 回退 `/me`）；登录成功后落点由 `test_successful_login_sets_store_and_honours_redirect` 断言（`/notes/new`） |
| 3 | 关闭 Cookie 后访问 `/api/users/me/profile` → 返回 `UNAUTHORIZED` 且前端跳登录 | 后端自动断言通过：`test_users_api.py::test_get_profile_requires_login`（无会话 client → 401 `UNAUTHORIZED`，等价于关闭 Cookie）；前端 `api.js` 的 `onApiError('UNAUTHORIZED')` 清空 store 并跳 `/login?redirect=...`（代码路径，**浏览器跳转待人工确认**） |

### 证据与命令（Phase 3）

| 命令 | 结果 |
|------|------|
| `.venv/Scripts/python.exe -m pytest tests/ -q` | **144 passed** |
| `.venv/Scripts/python.exe tests/manual/check_contrast.py` | 全部达标（退出码 0） |
| `node tests/js/render_auth.mjs` | `errors: {}`；输出登录/注册标记、字段校验、redirect 判定、守卫、顶栏已登录态、退出确认 |
| `node tests/js/render.mjs` | `errors: {}`；Phase 2 主页/关于/顶栏契约不受影响 |
| `node --check static/js/{auth,ui,router}.js` | 语法通过 |

代码定位：视图 `static/js/auth.js`（`FIELD_MESSAGES` / `resolveRedirect` / `renderLogin` / `renderRegister`）；顶栏 `static/js/ui.js renderHeader()` + `buildUserMenu()`；会话恢复与守卫 `static/js/router.js bootstrap()/render()`；接口 `api/auth.py`、`api/users.py`；CSRF/Origin `core/auth.py init_app()`；校验/安全 `core/validators.py`、`core/security.py`。

### 待人工确认的截图清单（本环境无浏览器，未采集）

建议在 Chrome DevTools 设备工具栏按下列组合各截一张：

- `phase3-login-1440x900.png`（行 1、4、6、7）
- `phase3-register-1440x900.png`（行 2、5）
- `phase3-register-375x812.png`（行 3）
- `phase3-header-loggedin-1440x900.png`（行 8）
- `phase3-header-loggedin-375x812-drawer.png`（行 9）
- `phase3-logout-confirm-1440x900.png`（行 10）
- 安全走查中的浏览器跳转/落点（走查 1、3）按步骤手工确认

### Phase 3 遗留风险

1. **`/notes`、`/me` 尚未注册路由**：按阶段边界，登录守卫的「回跳原路径」与 `/me` 页面在 Phase 4/7 注册路由后方可在浏览器完整走通；本阶段已用受保护路由 `__/guard-test__` 验证守卫机制本身。
2. **`redirect` 白名单为「单斜杠开头且非 `//`」**：可放行 `/notes?page=2` 之类站内带查询路径；对 `/\evil`、`javascript:` 等以非 `/` 开头者一律回退 `/me`（`javascript:` 不以 `/` 开头 → 回退），已由测试覆盖。
3. **原地改密不强制下线**：改密后当前会话仍有效（下次登录须用新密码），为计划记录的有意取舍，需在 Phase 8 如需强制重登时追加。
4. **DOM 双端差异**：Node 最小 DOM 断言节点树/属性，不覆盖浏览器布局、层叠、焦点环与动画观感。

---

## Phase 5 · 笔记前端

> 环境说明：本执行环境（Windows 11 / Git Bash）**没有可用浏览器，也没有 jsdom**，无法点击、截图或使用 DevTools。
> 凡依赖像素渲染、布局结果、动画观感、焦点环可见性的检查点，一律标注为
> 「**待人工确认（本环境无浏览器）**」，**不视为已通过**。
> 替代验证路径（已执行并给出证据）：
> 1. `tests/js/render_notes.mjs`、`tests/js/render_note_detail.mjs`、`tests/js/render_editor.mjs`
>    （复用 `tests/js/dom-shim.mjs` 最小 DOM 双端）真实调用 `static/js/notes.js` 的
>    `renderNoteList` / `renderNoteGrid` / `renderNoteDetail`、`static/js/editor.js` 的
>    `renderEditor`、`ui.js` 的 `noteCard` / `pagination`，断言标记、文案、ARIA 与交互落点；
> 2. `tests/test_notes_frontend.py`、`tests/test_editor_frontend.py` 用字节级 CSS 契约断言
>    `notes.css` / `editor.css` 的断点、尺寸与令牌接线；
> 3. `tests/test_markdown_frontend.py` 断言 Markdown 清洗配置、降级路径与「单一 HTML 出口」不变式。

| # | 路由 | 视口 | 状态 | 检查点 | 结果 |
|---|------|------|------|--------|------|
| 1 | `/notes` | 1440×900 | 有数据 | 工具条四项控件齐备；卡片网格自动填充；卡片为纸张质感 | 自动断言通过：`test_toolbar_status_filter_buttons`（全部/草稿/私密/已分享 四态按钮 + `aria-pressed`）、`test_toolbar_tag_select_and_search_input`（「全部标签」首项 + 占位「搜索标题或正文…」）、`test_toolbar_sort_buttons`、`test_note_grid_auto_fill`（`repeat(auto-fill, minmax(280px, 1fr))`）、`test_note_card_paper_styles`（paper.jpg + 兜底色 + 12px 圆角 + `var(--sp-6)` 内边距）；**纸张质感与网格密度的像素观感：待人工确认（本环境无浏览器）** |
| 2 | `/notes` | 1440×900 | 空态 | 显示「还没有笔记，去写下第一篇吧」与「写第一篇笔记」按钮 | 自动断言通过：`test_empty_state_without_filters`（文案逐字、按钮文案、点击跳 `/notes/new`、不渲染网格）；**观感：待人工确认（本环境无浏览器）** |
| 3 | `/notes` | 1440×900 | 搜索无结果 | 显示「没有找到符合条件的笔记」与「清除筛选」 | 自动断言通过：`test_empty_state_with_filters`（文案逐字、「清除筛选」点击回 `/notes`）；**观感：待人工确认（本环境无浏览器）** |
| 4 | `/notes` | 1440×900 | 加载中 | 显示 6 个骨架卡片 | 自动断言通过：`test_loading_shows_six_skeletons`（`.skeleton` 恰 6 个，数据返回后骨架清零）；**闪烁动画观感：待人工确认（本环境无浏览器）** |
| 5 | `/notes` | 375×812 | 有数据 | 工具条换行、搜索框整宽、卡片单列、无横向滚动 | 自动断言通过：`test_notes_css_mobile_breakpoint`（≤768px `.note-grid` 单列、`.note-search` `flex:1 1 100%` 且 `max-width:none`）、`test_note_toolbar_layout`（`flex-wrap:wrap`）；「无横向滚动」是布局结果：**待人工确认（本环境无浏览器）** |
| 6 | `/notes/new` | 1440×900 | 默认 | 标题输入无边框大字号；左右分栏等比；纸张容器 | 自动断言通过：`test_editor_new_mode_structure`（占位「请输入标题」、`maxlength=200`）、`test_editor_head_and_title`（`border:none` / `var(--fs-h2)` / `width:100%`）、`test_editor_wrap_and_paper`（纸底图 + 12px 圆角）、`test_editor_panes_split`（`1fr 1fr` + 预览左边框）；**像素观感：待人工确认（本环境无浏览器）** |
| 7 | `/notes/new` | 1440×900 | 输入中 | 右侧渲染结果与左侧一致；代码块有底色与横向滚动 | 自动断言通过：`test_preview_is_debounced_and_routed_through_render_markdown`（预览内容 === `renderMarkdown()` 输出、120ms 内不更新、原文不直接注入）、`test_markdown_body_typography`（`code` 底色 `var(--c-code-bg)`、`pre` `overflow-x:auto` + `var(--c-page)` 底）；**观感：待人工确认（本环境无浏览器）** |
| 8 | `/notes/new` | 1440×900 | 脏标记 | 改动后底部显示「未保存的更改」；点导航弹确认弹窗 | 自动断言通过：`test_status_count_and_dirty_marker`（改动后 `未保存的更改` + 标题圆点）、`test_navigate_is_blocked_while_dirty_and_clears_flag`（取消不跳转、离开后清标记）、`test_beforeunload_guards_only_when_dirty`；**弹窗动画与圆点观感：待人工确认（本环境无浏览器）** |
| 9 | `/notes/new` | 375×812 | 默认 | 出现「编辑 / 预览」切换，默认显示编辑 | 自动断言通过：`test_editor_tabs_hidden_on_desktop_visible_on_mobile`（桌面 `display:none`、≤768px `display:flex`）、`test_mobile_pane_toggle`（默认 `is-showing-source`，点击切到 `is-showing-preview` 且 `aria-pressed` 同步）；**实际布局观感：待人工确认（本环境无浏览器）** |
| 10 | `/notes/:id` | 1440×900 | 有数据 | 标题、元信息、纸张正文、操作条；正文宽度 720px 居中 | 自动断言通过：`test_detail_structure_and_meta`（标题/徽标/时间/`共 N 字`/标签）、`test_detail_body_is_rendered_markdown`、`test_detail_actions_only_edit_and_delete`、`test_detail_css`（`.detail-body` `max-width:var(--reading-max)`（720px）+ `margin:0 auto`）；**像素观感：待人工确认（本环境无浏览器）** |
| 11 | `/notes/:id` | 1440×900 | 删除确认 | 弹窗文案「确定要删除这篇笔记吗？删除后无法恢复。」 | 自动断言通过：`test_detail_delete_confirmation_copy`（标题「删除笔记」、正文逐字、按钮「取消 / 确定删除」、取消后零删除请求）、`test_detail_delete_confirmed_returns_to_list`（DELETE → toast「已删除」→ 回 `/notes`）；**弹窗观感：待人工确认（本环境无浏览器）** |
| 12 | `/notes/:id` | 1440×900 | 不存在 | 显示「笔记不存在或已被删除」与返回按钮 | 自动断言通过：`test_detail_missing_note_shows_empty_state`（文案逐字 + 「返回笔记列表」→ `/notes`）；**观感：待人工确认（本环境无浏览器）** |
| 13 | `/notes/new` | 键盘 | 默认 | Tab 依次可达标题、标签、两个按钮、图片按钮、正文 | 自动断言通过：`test_editor_interactive_elements_are_reachable_in_dom_order`（DOM 顺序：标题 → 标签 → 存草稿 → 发布 → 编辑/预览 → 正文 → 插入图片 → 隐藏文件框）、`test_editor_tabs_hidden_on_desktop_visible_on_mobile`（桌面上「编辑/预览」`display:none`，不在 Tab 序列内）。计划要求图片按钮位于编辑器底部工具条，故桌面实际 Tab 序列为「标题 → 标签 → 存草稿 → 发布 → 正文 → 插入图片」，与清单文字顺序（图片按钮在正文之前）不同源；**焦点环可见性与真实 Tab 走查：待人工确认（本环境无浏览器）** |
| 14 | `/notes` + `/notes/new` | 1440×900 | 减动效 | 模拟 `prefers-reduced-motion` 后卡片无位移过渡 | 自动断言通过：`test_note_card_hover_and_reduced_motion`（`@media (prefers-reduced-motion: reduce)` 下 `.note-card:hover { transform:none }` 且 `transition:none`）；`base.css` 全局把 `animation-duration` / `transition-duration` 压到 `.01ms`；**DevTools 模拟实测：待人工确认（本环境无浏览器）** |

### Phase 5 · 6 条 XSS 样例结论

`tests/manual/xss-fixtures.md` 的 6 条注入样例（`<script>`、`<img onerror>`、`javascript:` 链接、
`<iframe>`、外链 `onclick`、`<style>`）**未在真实浏览器中执行**，逐条结果均为
「**待人工确认（本环境无浏览器）**」。

已执行的三条可执行替代验证（见 `tests/test_markdown_frontend.py`，全部通过）：

| 验证 | 结论 |
|------|------|
| 降级路径安全（无 DOMPurify / 无 marked，6 条载荷逐条） | 输出只有 `<pre>` 自身两个标签，正文全部转义，危险串不处于标签或属性语境 |
| 清洗器配置断言（桩件捕获真实传入的 sanitize 配置并实际调用 hook） | 禁 `script/iframe/style/form/object/embed/link/meta` 与 `style/srcset/formaction`，`ALLOW_DATA_ATTR:false`，外链补 `target="_blank"` + `rel="noopener noreferrer"`，hook 只注册一次 |
| 单一 HTML 出口不变式（扫描 `static/js/**` 的 `innerHTML`） | 用户内容只经 `markdown.js`（`renderMarkdown`）注入：`editor.js:166`、`editor.js:315`、`notes.js:303`；另有 `home.js:46`（静态 SVG 常量，已豁免）与 `router.js` 的清空/静态字面量 |

**「保存后刷新详情页仍被清洗」结论：待人工确认（本环境无浏览器）** ——
自动侧只能证明「详情页正文只经 `renderMarkdown(note.content_md)` 渲染」（`test_detail_body_is_rendered_markdown`），
无法证明真实 DOMPurify 对已存储内容的最终清洗结果。

### 证据与命令（Phase 5）

| 命令 | 结果 |
|------|------|
| `.venv/Scripts/python.exe -m pytest tests/ -q` | **全部通过**（详见本阶段执行报告；含本阶段新增 3 个测试文件） |
| `node tests/js/render_notes.mjs` | `errors: {}`；输出工具条/卡片/分页/空态/筛选/防抖/失效占位/守卫 |
| `node tests/js/render_note_detail.mjs` | `errors: {}`；输出详情结构、空态、编辑/删除流程 |
| `node tests/js/render_editor.mjs` | `errors: {}`；输出编辑器结构、预览、标签、保存、发布、失败、快捷键、插图、切换、滚动同步 |
| `node tests/js/render_markdown.mjs` | `errors: {}`；输出降级输出、清洗配置、hook 行为、纯文本摘要 |
| `node --check static/js/{markdown,notes,editor,ui,router,store}.js` | 语法通过 |

代码定位：唯一 HTML 出口 `static/js/markdown.js renderMarkdown()`；列表/详情 `static/js/notes.js`；
编辑器 `static/js/editor.js`；卡片与分页 `static/js/ui.js noteCard()/pagination()`；
脏标记 `static/js/store.js` + `static/js/router.js navigate()/beforeunload`；
路由注册 `static/js/router.js`（`/notes`、`/notes/new`、`/notes/:id/edit`、`/notes/:id`）。

### 待人工确认的截图清单（本环境无浏览器，未采集）

- `phase5-notes-1440x900.png`（行 1）
- `phase5-notes-empty-1440x900.png`（行 2）
- `phase5-notes-noresult-1440x900.png`（行 3）
- `phase5-notes-loading-1440x900.png`（行 4）
- `phase5-notes-375x812.png`（行 5）
- `phase5-editor-1440x900.png`（行 6、7）
- `phase5-editor-dirty-1440x900.png`（行 8）
- `phase5-editor-375x812.png`（行 9）
- `phase5-detail-1440x900.png`（行 10）
- `phase5-detail-delete-1440x900.png`（行 11）
- `phase5-detail-missing-1440x900.png`（行 12）
- 键盘走查与 reduced-motion 无截图，按行 13、14 逐项手工确认

### Phase 5 遗留风险

1. **Markdown 清洗未经真实浏览器验证**：本环境无浏览器、无 jsdom，DOMPurify 无法运行。
   已验证清洗**配置**、降级兜底与单一 HTML 出口，但具体版本的清洗结果与「存储后仍安全」需人工复核。
2. **编辑器 Ctrl+S 的作用域**：快捷键绑定在 `document` 上，但仅在编辑器仍挂载时生效
   （通过 `activeEditor.wrap.parentNode` 判定）；焦点不在编辑器内时浏览器仍可能弹出保存对话框。
3. **标签上限静默忽略**：第 6 个标签被忽略且不提示（计划未规定文案，未新增中文提示）。
4. **详情页正文阅读层**：`.detail-body` 用 `background-color: var(--c-paper-fallback)` + 去除纸张底图
   来降低纹理干扰，属「半透明暖白层」的等效实现（未引入新色值令牌），观感需人工确认。
5. **DOM 双端差异**：Node 最小 DOM 断言节点树/属性与 CSS 文本契约，不覆盖浏览器布局、层叠、
   焦点环可见性与动画观感。
