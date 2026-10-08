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
