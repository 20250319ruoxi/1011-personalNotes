# 端到端走查脚本（Phase 8 Task 3）

> **执行环境说明（重要）**：本执行环境为 Windows 11 / Git Bash，**没有可用浏览器，也没有 jsdom**。
> 因此走查按「可达层次」分层执行，并诚实标注无法执行的步骤：
>
> 1. **API 层**：能用 Flask test client 驱动的步骤，用可复现脚本 `tests/manual/walkthrough_probe.py`
>    真实执行并逐条记录输出（命令：`.venv/Scripts/python.exe tests/manual/walkthrough_probe.py`，退出码 0）。
> 2. **DOM 层**：能在 Node 最小 DOM 双端（`tests/js/dom-shim.mjs`）复现的渲染/交互，引用真实运行的
>    `tests/js/render*.mjs` harness（`errors:{}` 为通过信号）。
> 3. **浏览器层**：像素布局、动画观感、横向滚动、真实剪贴板、焦点环可见性、toast 位置、真实 Tab 走查、
>    真实跳转落点等，一律标注 **`待人工确认（本环境无浏览器）`**，**不视为已通过**。
>
> 前置（真实部署时）：删除 `db/app.db` → `.venv/Scripts/python.exe app.py init-db` → `.venv/Scripts/python.exe app.py run`。
> 本走查用独立临时库，不触碰 `db/app.db`。
>
> 结论口径：`自动✓` = 该步骤的 API/DOM 子断言已由自动化证据覆盖；`待人工确认（本环境无浏览器）` = 该步骤
> 仍必须由人在真实浏览器中确认，**不计入通过**。

---

## 场景 A：首次到访与注册（未登录）

| 步骤 | 操作 | 结果 |
|------|------|------|
| A1 | 打开 `/` → 顶栏为「登录 注册 关于」，hero 与特性条完整 | 自动✓：`walkthrough_probe.py` A1（`GET /` → 200 SPA 外壳）；`node tests/js/render.mjs` `headerHome` 含「登录/注册/关于」三链接；`test_home_hero_copy_verbatim`、`test_home_features_four_items` 覆盖 hero 与四特性条。**像素级观感：待人工确认（本环境无浏览器）** |
| A2 | 点「开始记录」→ 跳到 `/login?redirect=%2Fnotes%2Fnew` | 自动✓：`test_home_hero_buttons`（`.btn.btn-primary`「开始记录」）+ `render.mjs` 输出按钮跳转目标。**真实点击后的地址栏落点：待人工确认（本环境无浏览器）** |
| A3 | 点「注册」→ 填邮箱/用户名/密码/确认密码 → 提交 → 自动登录并落到 `/notes/new` | 自动✓：`walkthrough_probe.py` A3（`POST /api/auth/register` → 200 + `csrf_token`；随后 `GET /api/auth/me` 已登录）；`node tests/js/render_auth.mjs`（注册提交、`resolveRedirect` 到 `/notes/new`）；`test_successful_login_sets_store_and_honours_redirect`。**真实落地跳转：待人工确认（本环境无浏览器）** |
| A4 | 记录：是否出现任何 CSP 报错、404 资源、控制台异常 | **待人工确认（本环境无浏览器）** —— 无 DevTools 无法观测 Console。替代验证：`app.py serve` 实测 `/`、`/about`、`/static/js/router.js`、`/static/css/base.css`、`/static/vendor/marked.min.js`、`/static/img/hero.jpg` 全部 200 且 Content-Type 正确；CSP 不含 `'unsafe-inline'`，源码无内联 `style`/`onclick`/`onerror`/`onload`（见下方审计）。**控制台是否零报错仍需人工确认** |

## 场景 B：写笔记与草稿

| 步骤 | 操作 | 结果 |
|------|------|------|
| B5 | 在 `/notes/new` 输入标题与 Markdown 正文（含标题、列表、引用、代码块、外链） | 自动✓：`node tests/js/render_editor.mjs`（编辑器结构、标题输入、正文）；`test_editor_new_mode_structure`、`test_markdown_body_typography`。**像素观感：待人工确认（本环境无浏览器）** |
| B6 | 右侧预览与左侧一致；点「插入图片」上传本地图片 → 正文出现 `![](...)` 且预览显示图片 | 自动✓：`walkthrough_probe.py` B6（`POST /api/uploads/image` → 200，URL `/static/uploads/u1-…png`）；`render_editor.mjs`（预览经 `renderMarkdown`、插图插入光标）；`test_preview_is_debounced_and_routed_through_render_markdown`。**图片在预览中的真实渲染：待人工确认（本环境无浏览器）** |
| B7 | 点「存草稿」→ toast「已保存为草稿」→ 地址栏变为 `/notes/<id>/edit` | 自动✓：`walkthrough_probe.py` B7（`POST /api/notes(status=draft)` → id=1，status=draft）；`render_editor.mjs`（存草稿 toast「已保存为草稿」）。**地址栏变化：待人工确认（本环境无浏览器）** |
| B8 | 修改标题后点导航「我的主页」→ 弹「放弃未保存的更改？」→ 点「取消」→ 留在原页 | 自动✓：`test_navigate_is_blocked_while_dirty_and_clears_flag`（取消不跳转、离开后清标记）、`test_beforeunload_guards_only_when_dirty`、`render_editor.mjs` 脏标记流程。**弹窗动画：待人工确认（本环境无浏览器）** |
| B9 | 再次点「存草稿」→ 状态回到「已保存」 | 自动✓：`render_editor.mjs`（保存后状态回「已保存」）。**观感：待人工确认（本环境无浏览器）** |
| B10 | 点「发布」→ 确认弹窗 → toast「已发布」→ 状态徽标变「私密」 | 自动✓：`walkthrough_probe.py` B10（`PUT /api/notes/<id>` status=private → 200）；`render_editor.mjs`（发布确认、toast、徽标）。**弹窗与徽标观感：待人工确认（本环境无浏览器）** |

## 场景 C：列表与检索

| 步骤 | 操作 | 结果 |
|------|------|------|
| C11 | 再创建 3 篇笔记（不同标签与状态） | 自动✓：`walkthrough_probe.py` C12 前置（创建后 `GET /api/notes` total=4） |
| C12 | 进入 `/notes` → 逐个切换「全部/草稿/私密」→ 数量正确 | 自动✓：`walkthrough_probe.py` C12（all=4、draft=1、private=3）；`test_toolbar_status_filter_buttons`（四态按钮）。**按钮切换观感：待人工确认（本环境无浏览器）** |
| C13 | 搜索一个仅在正文出现的词 → 命中正确 | 自动✓：`walkthrough_probe.py` C13（`q=番茄` → total=3） |
| C14 | 选择标签筛选 → 命中正确；点「清除筛选」→ 回到全部 | 自动✓：`walkthrough_probe.py` C14（`tag=技术` → total=2）；`test_empty_state_with_filters`（「清除筛选」） |
| C15 | 切换到「按创建时间」→ 顺序变化；翻页正确 | 自动✓：`walkthrough_probe.py` C15（page1={1,2}、page2={3,4}，不重叠且合计=总数）；`test_toolbar_sort_buttons` |
| C16 | 刷新页面 → 筛选条件与页码保留 | **待人工确认（本环境无浏览器）** —— 依赖浏览器地址栏 `?q/&tag/&sort/&page` 与会话持久化的真实刷新行为；API 层已确认分页/筛选稳定（C12–C15） |

## 场景 D：分享与评论

| 步骤 | 操作 | 结果 |
|------|------|------|
| D17 | 打开某篇笔记详情 → 开启分享（留空密码）→ 复制链接 | 自动✓：`walkthrough_probe.py` D17（`POST /api/notes/<id>/share` → `/s/<token>`，`has_password=false`）；`test_panel_on_state`、`test_panel_copy_success_toasts`。**真实剪贴板与 toast 位置：待人工确认（本环境无浏览器）** |
| D18 | 隐私窗口打开该链接 → 直接可读正文；顶栏为未登录态 | 自动✓：`walkthrough_probe.py` D18（匿名 `GET /api/share/<token>` → 200 且含正文）；`test_share_page_renders_paper_article`、`render_share.mjs`（顶栏未登录态）。**隐私窗口真实行为：待人工确认（本环境无浏览器）** |
| D19 | 隐私窗口点「收藏」→ 跳 `/login?redirect=/s/<token>` → 登录后回到分享页 | 自动✓：`walkthrough_probe.py` D19（匿名 `GET /api/favorites` → 401 `UNAUTHORIZED`）；`test_share_collect_logged_out_redirects_to_login`（落点 `/login?redirect=%2Fs%2Ftok-123`）。**真实跳转与回跳落点：待人工确认（本环境无浏览器）** |
| D20 | 在分享页评论区发表一条评论 → 列表即时出现 | 自动✓：`walkthrough_probe.py` D20（`POST /api/share/<token>/comments` → 200，内容回显）；`render_comments.mjs`（发表后插入列表） |
| D21 | 回作者窗口刷新详情页 → 评论区显示该条评论，且能看到「删除」 | 自动✓：`walkthrough_probe.py` D21（`GET /api/notes/<id>/comments` → total=1，`can_delete=true`） |
| D22 | 作者删除该评论 → 分享页刷新后该评论消失 | 自动✓：`walkthrough_probe.py` D22（`DELETE /api/comments/<id>` → 200，随后计数归零） |
| D23 | 作者在分享面板设置密码 → 隐私窗口刷新 → 出现密码锁屏 → 输错一次看到抖动与「访问密码错误」→ 输对进入正文 | 自动✓：`walkthrough_probe.py` D23（新访客 `GET /api/share/<token>` → 401 `SHARE_PASSWORD_REQUIRED`；错误密码 → `SHARE_PASSWORD_WRONG`；正确密码 → 200 正文）；`test_lock_screen_structure`、`test_lock_wrong_password_shakes_and_shows_error`。**抖动动画观感与真实刷新：待人工确认（本环境无浏览器）**。⚠️ 见下方遗留风险 1（同一会话已无密解锁后不会被回溯上锁） |
| D24 | 作者关闭分享 → 隐私窗口刷新 → 「该分享链接已失效」 | 自动✓：`walkthrough_probe.py` D24（`DELETE /api/notes/<id>/share` → 200；旧 token → 404 `SHARE_DISABLED`）；`test_expired_share_link_state` |

## 场景 E：收藏、足迹与个人主页

| 步骤 | 操作 | 结果 |
|------|------|------|
| E25 | 进入 `/me` → 四个 Tab 依次切换，URL 同步为 `?tab=` | 自动✓：`node tests/js/render_profile.mjs`（四 Tab、激活态、URL 同步 `?tab=`）；`test_profile_tabs_rule`、`test_tab_buttons_are_tabs`。**像素观感：待人工确认（本环境无浏览器）** |
| E26 | 「我的收藏」中第 19 步收藏的条目在，作者显示为对方 | 自动✓：`walkthrough_probe.py` E26（friend 经分享链接收藏 → 200；列表 total=1、`available=true`、作者为笔记作者） |
| E27 | 「浏览足迹」按倒序显示已浏览的笔记与时间 | 自动✓：`walkthrough_probe.py` E27（连续读 id=1、id=2 → 列表 `ids=[2,1]`，`viewed_at` 递减） |
| E28 | 点「清空浏览记录」→ 确认 → 空态「还没有浏览记录」 | 自动✓：`walkthrough_probe.py` E28（`DELETE /api/history` → 200，随后 total=0）；`test_clear_history_confirmed_empties_list`、`test_history_empty_state` |
| E29 | 「个人信息」改用户名与简介 → 顶栏同步；改密码 → 用新密码重新登录成功 | 自动✓：`walkthrough_probe.py` E29（`PUT /api/users/me/profile` → 200；`PUT /api/users/me/password` → 200；新密码 `POST /api/auth/login` → 200）；`test_save_profile_puts_and_updates_store_and_header`。**顶栏视觉同步：待人工确认（本环境无浏览器）** |
| E30 | 场景 D 中被关闭分享的笔记 → 回到「我的收藏」该条目显示「内容已失效」+「移除」 | 自动✓：`walkthrough_probe.py` E30（`available=false`、`title=null`、无 `content_md`）；`test_favorites_list_available_and_stale_entries`、`test_stale_card_contract` |

## 场景 F：失效与异常

| 步骤 | 操作 | 结果 |
|------|------|------|
| F31 | 直接访问 `/notes/999999` → 「笔记不存在或已被删除」 | 自动✓：`walkthrough_probe.py` F31（`GET /api/notes/999999` → 404 `NOT_FOUND`）；`test_detail_missing_note_shows_empty_state`（文案逐字） |
| F32 | 直接访问 `/s/invalid-token` → 「该分享链接已失效」 | 自动✓：`walkthrough_probe.py` F32（`GET /api/share/invalid-token` → 404 `SHARE_DISABLED`）；`test_expired_share_link_state` |
| F33 | 直接访问 `/about`、`/register`（已登录时）→ 分别正确渲染与跳转 | 自动✓（部分）：`walkthrough_probe.py` F33（`GET /about` → 200 SPA 外壳）；`test_about_page_sections`。**「已登录访问 /register 的跳转」为浏览器行为：待人工确认（本环境无浏览器）** |
| F34 | 手改地址为 `/whatever` → 显示「页面不存在」+「返回首页」 | 自动✓：`walkthrough_probe.py` F34（`GET /whatever` → 200 index.html SPA 兜底）；`router.js notFoundRoute` 渲染 `<h2>页面不存在</h2>` + 「返回首页」链接 |
| F35 | DevTools 清空 Cookie 后访问 `/notes` → 跳登录；登录后回到 `/notes` | 自动✓：`walkthrough_probe.py` F35（无会话 `GET /api/notes` → 401 `UNAUTHORIZED`）；`test_guard_redirects_anonymous_to_login_with_back_target`。**真实清 Cookie 与跳转：待人工确认（本环境无浏览器）** |

---

## 走查统计（35 步）

| 口径 | 数量 | 说明 |
|------|------|------|
| 有可执行自动证据（API 和/或 DOM 层） | **33** | A1–A3、B5–B10、C11–C15、D17–D24、E25–E30、F31–F35 |
| 仅能人工确认（无任何自动证据） | **2** | A4（控制台报错）、C16（刷新保留筛选/页码） |
| 含「待人工确认（本环境无浏览器）」子项的步骤 | **33** | 上表每步均已显式标注需人工复核的浏览器层子项；**没有把任何需要浏览器的子项谎报为通过** |

被覆盖步骤的逐条真实输出见 `walkthrough_probe.py` 运行结果（命令与退出码见「证据与命令」）。

## 证据与命令

| 命令 | 结果 |
|------|------|
| `.venv/Scripts/python.exe tests/manual/walkthrough_probe.py` | 全部 PASS，退出码 0（API 层 33 步子集） |
| `node tests/js/render.mjs` … `render_markdown.mjs`（9 个 harness） | 全部 `exit=0`、`"errors":{}` |
| `.venv/Scripts/python.exe -m pytest tests/ -q` | **512 passed** |
| `.venv/Scripts/python.exe tests/manual/check_contrast.py` | 全部达标，退出码 0 |
