# Phase 8: 安全加固与全量验收

**Goal:** 补齐安全响应头、鉴权矩阵与滥用防护回归，完成全量端到端走查，并收尾文档与部署说明。

**Prerequisites:** Phase 1–7 全部完成。

**Deliverables:**
- 安全响应头中间件与 Cookie 属性断言
- `tests/test_security_headers.py`、`tests/test_authz_matrix.py`
- `tests/manual/end-to-end-walkthrough.md`（场景脚本 + 全量矩阵）
- 完整 `README.md`（含生产部署与安全清单）
- 计划状态更新为 Done

**Interface Decisions Implemented:**
- 无内联 `style` / `onclick`，以便启用严格 CSP
- 全量视觉与交互验收覆盖 10 条路由 × 3 档视口 × 关键状态
- 移动端触摸目标 ≥ 44×44px 与焦点可见的统一检查

---

## Task 1: 安全响应头与生产启动加固

**Goal:** 为所有响应附加安全头，并固化 Cookie 属性与启动期密钥检查。

**Files:**
- Modify: `app.py`（`after_request` 中间件 + 启动警告）
- Create: `tests/test_security_headers.py`
- Modify: `static/js/router.js`（移除占位视图中的内联 `style`）
- Modify: `tests/manual/visual-checklist.md`（无需改动，Phase 8 由 Task 3 汇总）

**Steps:**

- [ ] 先确认代码中不存在内联样式与内联事件（严格 CSP 的前提）：

```bash
grep -rn 'style="' index.html static/js static/css || echo "no inline style"
grep -rn 'onclick=\|onerror=\|onload=' index.html static/js || echo "no inline handler"
```

  - Expected: 两条命令均输出对应的 `no inline …`（`tests/manual/xss-fixtures.md` 中的 `style="` 与 `onclick=` 是测试输入样例，不在 grep 范围内，因为命令只扫描 `index.html`、`static/js`、`static/css`）。若第一条仍有命中，说明有样式被写成了内联形式，改用 `base.css` 中的类替代。

- [ ] 创建 `tests/test_security_headers.py`：

```python
import pytest


@pytest.mark.parametrize("path", ["/", "/about", "/api/auth/me", "/api/__nope__"])
def test_security_headers_on_every_response(client, path):
    resp = client.get(path)
    assert resp.headers["X-Content-Type-Options"] == "nosniff"
    assert resp.headers["X-Frame-Options"] == "DENY"
    assert resp.headers["Referrer-Policy"] == "no-referrer"
    assert "default-src 'self'" in resp.headers["Content-Security-Policy"]
    assert "'unsafe-inline'" not in resp.headers["Content-Security-Policy"]


def test_session_cookie_is_httponly_and_lax(client):
    resp = client.post("/api/auth/register", json={
        "email": "cookie@example.com", "username": "cookie",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    raw = " ".join(resp.headers.getlist("Set-Cookie"))
    assert "session=" in raw
    assert "HttpOnly" in raw
    assert "SameSite=Lax" in raw


def test_share_page_sets_no_referrer_policy(client, alice):
    c, headers = alice
    note_id = c.post("/api/notes", json={"title": "t", "content_md": "c",
                                         "status": "private"}, headers=headers
                     ).get_json()["data"]["note"]["id"]
    token = c.post(f"/api/notes/{note_id}/share", json={}, headers=headers
                   ).get_json()["data"]["share_url"].rsplit("/", 1)[-1]
    assert client.get(f"/api/share/{token}").headers["Referrer-Policy"] == "no-referrer"
```

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_security_headers.py -v
```

  - Expected: FAIL（尚无 `after_request` 中间件）

- [ ] 在 `app.py` 中追加：

```python
CSP = (
    "default-src 'self'; "
    "script-src 'self'; "
    "style-src 'self'; "
    "img-src 'self' data:; "
    "font-src 'self'; "
    "connect-src 'self'; "
    "object-src 'none'; "
    "base-uri 'none'; "
    "form-action 'self'; "
    "frame-ancestors 'none'"
)


def register_security_headers(app):
    @app.after_request
    def apply_security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["X-Frame-Options"] = "DENY"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["Content-Security-Policy"] = CSP
        return response
```

  并在 `create_app` 中 `register_error_handlers(app)` 之前调用 `register_security_headers(app)`。

- [ ] 在 `app.py` 的 `if __name__ == "__main__":` 分支开头追加启动期密钥检查：

```python
    if cli_app.config["SECRET_KEY"] == "dev-only-change-me":
        print("[警告] 正在使用默认 SECRET_KEY，仅可用于本地开发；"
              "部署前请通过环境变量 SECRET_KEY 替换。")
```

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_security_headers.py -v
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 新增 6 个用例全部 passed，全量无回归

- [ ] 用 waitress 启动并确认 CSP 不阻断页面：

```bash
.venv/Scripts/python.exe app.py serve
```

  - Expected: 浏览器打开 `http://127.0.0.1:5000/` 后 DevTools Console 无 CSP 违规报错；笔记列表、编辑器、分享页的样式与脚本全部正常加载

**Security/Boundary Notes:**
- CSP 不含 `'unsafe-inline'`，因此禁止任何内联 `style`、`<script>` 内联代码与 `onclick` 属性；新增前端代码必须遵守。
- `img-src` 允许 `data:` 但脚本与样式只允许同源，避免外链资源成为数据外泄或 XSS 通道。
- `frame-ancestors 'none'` 与 `X-Frame-Options: DENY` 双重防止被 iframe 嵌套。
- 默认 `SECRET_KEY` 只打印警告不阻止启动（便于本地开发），部署检查清单中把替换列为必做项。

**Dependencies:** Phase 1–7

---

## Task 2: 鉴权矩阵与滥用防护回归

**Goal:** 用表驱动测试覆盖全部受保护接口的未登录行为，并补齐伪造 token、路径穿越等滥用场景。

**Files:**
- Create: `tests/test_authz_matrix.py`

**Steps:**

- [ ] 创建 `tests/test_authz_matrix.py`：

```python
import pytest

PROTECTED_ENDPOINTS = [
    ("GET", "/api/users/me/profile"),
    ("PUT", "/api/users/me/profile"),
    ("PUT", "/api/users/me/password"),
    ("GET", "/api/notes"),
    ("POST", "/api/notes"),
    ("GET", "/api/notes/1"),
    ("PUT", "/api/notes/1"),
    ("DELETE", "/api/notes/1"),
    ("POST", "/api/notes/1/share"),
    ("DELETE", "/api/notes/1/share"),
    ("GET", "/api/notes/1/comments"),
    ("POST", "/api/notes/1/comments"),
    ("DELETE", "/api/comments/1"),
    ("GET", "/api/favorites"),
    ("POST", "/api/favorites"),
    ("DELETE", "/api/favorites/1"),
    ("GET", "/api/history"),
    ("DELETE", "/api/history"),
    ("DELETE", "/api/history/1"),
    ("GET", "/api/tags"),
    ("POST", "/api/uploads/image"),
    ("POST", "/api/auth/logout"),
]

PUBLIC_ENDPOINTS = [
    ("POST", "/api/auth/register"),
    ("POST", "/api/auth/login"),
    ("GET", "/api/auth/me"),
    ("GET", "/api/share/whatever"),
    ("GET", "/api/share/whatever/comments"),
]


@pytest.mark.parametrize("method,path", PROTECTED_ENDPOINTS)
def test_protected_endpoint_requires_login(client, method, path):
    resp = client.open(path, method=method)
    assert resp.status_code == 401, f"{method} {path} 未要求登录"
    assert resp.get_json()["code"] == "UNAUTHORIZED"


@pytest.mark.parametrize("method,path", PUBLIC_ENDPOINTS)
def test_public_endpoint_does_not_require_login(client, method, path):
    resp = client.open(path, method=method, json={})
    assert resp.status_code != 401 or resp.get_json()["code"] != "UNAUTHORIZED"


def test_login_with_missing_fields_is_invalid_param(client):
    assert client.post("/api/auth/login", json={}).get_json()["code"] == "INVALID_PARAM"


def test_fake_share_tokens_are_all_rejected(client):
    for index in range(20):
        token = f"fake-token-{index:02d}-{'x' * 20}"
        resp = client.get(f"/api/share/{token}")
        assert resp.status_code == 404
        assert resp.get_json()["code"] == "SHARE_DISABLED"


def test_upload_path_traversal_filename_is_ignored(alice):
    c, headers = alice
    import io
    from PIL import Image

    buf = io.BytesIO()
    Image.new("RGB", (4, 4), (1, 2, 3)).save(buf, format="PNG")
    buf.seek(0)
    resp = c.post("/api/uploads/image",
                  data={"file": (buf, "../../../evil.png")},
                  headers=headers, content_type="multipart/form-data")
    url = resp.get_json()["data"]["url"]
    assert ".." not in url and "/" not in url.rsplit("/", 1)[0].replace("/static/uploads", "")
    assert url.startswith("/static/uploads/u")


def test_note_id_is_type_checked(alice):
    c, headers = alice
    resp = c.get("/api/notes/not-an-int")
    assert resp.status_code == 404


def test_csrf_token_from_another_session_is_rejected(app, alice):
    c, _ = alice
    other = app.test_client()
    other.post("/api/auth/register", json={
        "email": "other@example.com", "username": "otherone",
        "password": "passw0rd", "confirm_password": "passw0rd"})
    foreign_token = other.get("/api/auth/me").get_json()["data"]["csrf_token"]
    resp = c.post("/api/notes", json={"title": "t", "content_md": "c", "status": "draft"},
                  headers={"X-CSRF-Token": foreign_token})
    assert resp.status_code == 403
    assert resp.get_json()["code"] == "CSRF_INVALID"
```

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/test_authz_matrix.py -v
```

  - Expected: 全部 passed（`_csrf_protect` 在 Phase 3 Task 3 已实现「无会话直接放行」的分支，因此 22 个受保护接口统一返回 `UNAUTHORIZED`）

- [ ] 若出现 `CSRF_INVALID` 而非 `UNAUTHORIZED`，检查 `core/auth.py` 的 `_csrf_protect` 是否保留了对 `session.get("csrf_token") is None` 的提前返回分支；该分支是本次矩阵测试的前提。

- [ ] 运行：

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 全部 passed，无回归

**Security/Boundary Notes:**
- 放行「无会话请求」（Phase 3 Task 3 已实现）不放宽任何攻击面：CSRF 攻击的前提是浏览器自动携带受害者的会话 Cookie，而 `csrf_token` 仅在注册/登录成功后写入 Session，因此无会话请求本就无可利用凭证。
- 本任务的矩阵测试把「未登录访问受保护接口统一返回 `UNAUTHORIZED`」固化为回归约束，避免后续新增接口时遗漏 `login_required` 或无意改变错误码。
- 路径穿越用例验证的是「客户端文件名被完全丢弃」，这是 UUID 重命名策略的直接收益。

**Dependencies:** Task 1

---

## Task 3: 全量端到端走查与视觉终检

**Goal:** 用一个连续场景脚本走通全部 10 条路由，并按矩阵核对三档视口与关键状态。

**Files:**
- Create: `tests/manual/end-to-end-walkthrough.md`
- Modify: `tests/manual/visual-checklist.md`（补全汇总结论）

**Steps:**

- [ ] 创建 `tests/manual/end-to-end-walkthrough.md`，写入以下场景脚本（按顺序执行并逐行记录结果）：

```markdown
# 端到端走查脚本

前置：删除 `db/app.db` → `.venv/Scripts/python.exe app.py init-db` → `.venv/Scripts/python.exe app.py run`

## 场景 A：首次到访与注册（未登录）
1. 打开 `/` → 顶栏为「登录 注册 关于」，hero 与特性条完整
2. 点「开始记录」→ 跳到 `/login?redirect=%2Fnotes%2Fnew`
3. 点「注册」→ 填邮箱/用户名/密码/确认密码 → 提交 → 自动登录并落到 `/notes/new`
4. 记录：是否出现任何 CSP 报错、404 资源、控制台异常

## 场景 B：写笔记与草稿
5. 在 `/notes/new` 输入标题与 Markdown 正文（含标题、列表、引用、代码块、外链）
6. 右侧预览与左侧一致；点「插入图片」上传一张本地图片 → 正文出现 `![](...)` 且预览显示图片
7. 点「存草稿」→ toast「已保存为草稿」→ 地址栏变为 `/notes/<id>/edit`
8. 修改标题后点导航「我的主页」→ 弹出「放弃未保存的更改？」→ 点「取消」→ 留在原页
9. 再次点「存草稿」→ 状态回到「已保存」
10. 点「发布」→ 确认弹窗 → toast「已发布」→ 状态徽标变「私密」

## 场景 C：列表与检索
11. 再创建 3 篇笔记（不同标签与状态）
12. 进入 `/notes` → 逐个切换「全部/草稿/私密」→ 数量正确
13. 搜索一个仅在正文出现的词 → 命中正确
14. 选择标签筛选 → 命中正确；点「清除筛选」→ 回到全部
15. 切换到「按创建时间」→ 顺序变化；翻页正确
16. 刷新页面 → 筛选条件与页码保留

## 场景 D：分享与评论
17. 打开某篇笔记详情 → 开启分享（留空密码）→ 复制链接
18. 隐私窗口打开该链接 → 直接可读正文；顶栏为未登录态
19. 隐私窗口点「收藏」→ 跳 `/login?redirect=/s/<token>` → 登录后回到分享页
20. 在分享页评论区发表一条评论 → 列表即时出现
21. 回作者窗口刷新详情页 → 评论区显示该条评论，且能看到「删除」
22. 作者删除该评论 → 分享页刷新后该评论消失
23. 作者在分享面板设置密码 → 隐私窗口刷新 → 出现密码锁屏 → 输错一次看到抖动与「访问密码错误」→ 输对进入正文
24. 作者关闭分享 → 隐私窗口刷新 → 「该分享链接已失效」

## 场景 E：收藏、足迹与个人主页
25. 进入 `/me` → 四个 Tab 依次切换，URL 同步为 `?tab=`
26. 「我的收藏」中第 19 步收藏的条目在，作者显示为对方
27. 「浏览足迹」按倒序显示已浏览的笔记与时间
28. 点「清空浏览记录」→ 确认 → 空态「还没有浏览记录」
29. 「个人信息」改用户名与简介 → 顶栏同步；改密码 → 用新密码重新登录成功
30. 场景 D 中被关闭分享的笔记 → 回到「我的收藏」该条目显示「内容已失效」+「移除」

## 场景 F：失效与异常
31. 直接访问 `/notes/999999` → 「笔记不存在或已被删除」
32. 直接访问 `/s/invalid-token` → 「该分享链接已失效」
33. 直接访问 `/about`、`/register`（已登录时）→ 分别正确渲染与跳转
34. 手改地址为 `/whatever` → 显示「页面不存在」+「返回首页」
35. DevTools 清空 Cookie 后访问 `/notes` → 跳登录；登录后回到 `/notes`
```

- [ ] 逐行执行并记录（结果、截图文件名、问题与修复）。

- [ ] 在 `tests/manual/visual-checklist.md` 末尾追加「全量矩阵汇总」，按下表核对每一格并填写结论：

| 路由 | 1440×900 | 375×812 | 必须核对的状态 |
|------|----------|---------|----------------|
| `/` | | | 默认、滚动阴影、抽屉展开、减动效 |
| `/login` | | | 默认、字段错误、提交中、请求失败 |
| `/register` | | | 默认、字段错误 |
| `/about` | | | 默认 |
| `/notes` | | | 有数据、加载骨架、空态、搜索无结果 |
| `/notes/new` | | | 默认、输入中、脏标记、预览切换（移动档） |
| `/notes/:id` | | | 有数据、删除确认、不存在、已收藏 |
| `/me` | | | 四 Tab、三处空态、失效收藏、清空确认 |
| `/s/:token` | | | 无密码、需密码、密码错误、限流、已失效 |
| 全局 | | | toast、二次确认弹窗、键盘焦点、`prefers-reduced-motion` |

- [ ] 做一次「实现后批判性复检」：关闭浏览器 DevTools 的设备模拟，以真实窗口依次浏览 10 条路由，记录任何视觉层级、间距不一致、文本溢出、元素重叠、对比度不足的问题并修复；修复后重新截图替换清单中的旧图。

- [ ] 触摸目标检查：在 375px 宽度下用 DevTools 元素检查逐个测量顶栏链接、抽屉内条目、卡片按钮、评论删除按钮、分页按钮的命中区域，全部 ≥ 44×44px，把测量结果写入清单。

**Visual Verification:** 本任务的场景脚本与全量矩阵即最终验收记录。

**Dependencies:** Task 1、Task 2、Phase 1–7

---

## Task 4: 文档收尾与移交

**Goal:** 让仓库具备可交付状态：README 完整、依赖可复现、计划状态更新。

**Files:**
- Modify: `README.md`
- Modify: `docs/plans/2026-10-08-personal-notes/personal-notes.md` 与 8 个阶段文件的 `Status` 字段

**Steps:**

- [ ] 用干净环境验证依赖可复现安装：

```bash
rm -rf .venv
python -m venv .venv
.venv/Scripts/python.exe -m pip install -i https://pypi.tuna.tsinghua.edu.cn/simple -r requirements.txt
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 安装成功；全部测试 passed

- [ ] 把 `README.md` 补全为以下章节（每节内容必须可独立阅读）：

  1. **项目简介**：一句话说明与 10 个功能点的清单
  2. **技术栈**：Python 3.12 / Flask 3.0.3 / SQLite / 原生 HTML+CSS+JS；前端 vendor 版本 `marked@12.0.2`、`dompurify@3.1.6`
  3. **目录结构**：与 `docs/specs` 中的架构章节一致的文件树
  4. **快速开始**：创建虚拟环境 → 安装依赖 → `.venv/Scripts/python.exe app.py init-db` → `.venv/Scripts/python.exe app.py run` → 访问 `http://127.0.0.1:5000`
  5. **镜像与依赖锁定**：说明 `pip.conf` 使用清华 TUNA，`npm pack` 使用 npmmirror 下载 vendor 文件，所有版本已锁定
  6. **测试**：`.venv/Scripts/python.exe -m pytest tests/ -v`，并说明手工清单位于 `tests/manual/`
  7. **环境变量**：`SECRET_KEY`（生产必填）、`COOKIE_SECURE=1`（生产必填）、`DATABASE`（可选）
  8. **生产部署**：使用 `.venv/Scripts/python.exe app.py serve`（waitress）配合反向代理与 HTTPS；`static/uploads` 必须以静态资源返回且禁止脚本执行；`db/app.db` 与 `static/uploads/` 纳入备份；反向代理层对 `/api/auth/login` 与 `/api/share/*/verify` 追加频率限制
  9. **安全清单**：替换 `SECRET_KEY`、开启 `COOKIE_SECURE`、CSP 已启用且禁止内联样式、上传白名单与配额、分享 token 熵值、密码哈希算法
  10. **运行时产物**：`db/app.db`、`static/uploads/*`、`__pycache__/`、`.venv/` 不入版本控制

- [ ] 核对需求文档的 10 个功能点与交付物一一对应，把核对结果写入 README 的「项目简介」下方（用「已实现」标记）。

- [ ] 把计划索引与 8 个阶段文件的 `Status` 全部更新为 `Done`，并把每个阶段文件的「Phase Completion Checklist」逐项勾选（未完成项保留未勾选并说明原因）。

- [ ] 最终全量验证：

```bash
.venv/Scripts/python.exe -m pytest tests/ -v
```

  - Expected: 全部测试 passed，无 skipped（除非某用例有明确说明）

**Dependencies:** Task 1–3

---

## Phase Completion Checklist

- [ ] 全部 4 个任务完成
- [ ] `.venv/Scripts/python.exe -m pytest tests/ -v` 全部通过（含 `test_security_headers.py` 6 项、`test_authz_matrix.py` 28 项）
- [ ] 所有响应带 `X-Content-Type-Options`、`X-Frame-Options`、`Referrer-Policy`、严格 CSP，且不含 `'unsafe-inline'`
- [ ] Session Cookie 具备 `HttpOnly` 与 `SameSite=Lax`
- [ ] 22 个受保护接口未登录时统一返回 `UNAUTHORIZED`
- [ ] 端到端走查的 35 个步骤全部通过并记录结论
- [ ] 全量视觉矩阵 10 行 × 3 档视口全部填写结论，问题已修复
- [ ] 375px 宽度下所有可点元素命中区域 ≥ 44×44px 并已记录测量值
- [ ] 干净的虚拟环境可完成安装与全量测试
- [ ] `README.md` 十个章节齐备，含生产部署与安全清单
- [ ] 计划索引与阶段文件状态更新为 `Done`
