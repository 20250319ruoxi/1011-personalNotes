# Markdown 注入样例与期望结果

> **环境说明（重要）**：本执行环境（Windows 11 / Git Bash）**没有可用浏览器，也没有 jsdom**，
> 因此 vendor 目录里的 `marked` / `DOMPurify` 真实构建**无法在本环境运行**。
> 下表 6 条样例的「浏览器内实际表现」**未经真实执行**，全部标注为
> **待人工确认（本环境无浏览器）**，**不视为已通过**。
>
> 本阶段改用三条**可执行**的替代验证（见文末「可执行替代验证」），它们覆盖了清洗配置本身、
> 降级路径的安全性与「单一 HTML 出口」不变式，但不能替代浏览器内的真实清洗结果。

## 手工执行方式

1. 启动应用并登录，进入 `/notes/new`。
2. 把「输入」列的内容**逐条**粘贴到左侧 Markdown 源码区，观察右侧「预览」与浏览器控制台。
3. 每条样例按「期望预览结果」与「不得出现」两列核对；任一「不得出现」条件被违反即视为**阻塞缺陷**。
4. 附加核对：控制台无异常输出；逐条粘贴后立即「存草稿」并刷新详情页 `/notes/<id>`，
   确认注入内容在详情页同样被清洗（验证「存储后仍安全」）。

## 样例与期望结果

| # | 输入 | 期望预览结果 | 不得出现 | 结果 |
|---|------|--------------|----------|------|
| 1 | `<script>alert('xss')</script>正文` | 只显示「正文」 | 无弹窗、DOM 中无 `<script>` | **待人工确认（本环境无浏览器）** |
| 2 | `<img src=x onerror="alert('xss')">` | 不显示图片、无弹窗 | DOM 中无 `onerror` 属性 | **待人工确认（本环境无浏览器）** |
| 3 | `[点我](javascript:alert('xss'))` | 链接文本「点我」可见，但 href 被移除或不可执行 | 点击不执行脚本、无 `href="javascript:…"` | **待人工确认（本环境无浏览器）** |
| 4 | `<iframe src="https://example.com"></iframe>` | 不渲染任何 iframe | DOM 中无 `<iframe>` | **待人工确认（本环境无浏览器）** |
| 5 | `<a href="https://example.com" onclick="alert(1)">外链</a>` | 渲染为可点击外链 | 无 `onclick`；DOM 中带 `rel="noopener noreferrer"` 与 `target="_blank"` | **待人工确认（本环境无浏览器）** |
| 6 | `<style>body{display:none}</style>正文` | 只显示「正文」，页面样式不受影响 | DOM 中无 `<style>` | **待人工确认（本环境无浏览器）** |

附加核对项（同样**待人工确认**）：

| # | 核对项 | 结果 |
|---|--------|------|
| A | 控制台无异常输出 | **待人工确认（本环境无浏览器）** |
| B | 逐条粘贴后保存并刷新详情页，注入内容在详情页同样被清洗 | **待人工确认（本环境无浏览器）** |

---

## 可执行替代验证（本环境已真实执行）

命令：`.venv/Scripts/python.exe -m pytest tests/test_markdown_frontend.py -q -s`

### 验证 1 · 降级路径安全（vendor 脚本加载失败时的兜底）

`tests/js/render_markdown.mjs` 在 Node 最小 DOM 双端中，把 `window.DOMPurify` 与 `window.marked`
**同时置为不存在**，然后对上面 6 条输入逐一调用 `renderMarkdown()`，断言：

- 返回值形如 `<pre class="md-fallback">…</pre>`；
- 整段输出**只有** `<pre>` 自身的开闭两个标签（`re.findall(r"<[^>]*>", out)` 严格相等），
  即不存在任何其它标签与属性 —— 没有标签/属性就没有可执行结构；
- `<pre>` 正文中的 `<` / `>` 全部被转义（正文区间内不含未转义的 `<`、`>`）；
- 危险串只可能以**已转义纯文本**形态出现，永不处于标签/属性语境
  （`<\s*script`、`<\w[^>]*\bonerror=`、`="javascript:`、`src="`、`href="` 均为零匹配）；
- 载荷中的 `<`/`>` 已变成 `&lt;`/`&gt;`。

> 说明：第 2、3、5 条样例的转义文本里会**字面出现** `onerror`、`javascript:`、`onclick` 等子串，
> 这是「原文被当成纯文本展示」的必然结果，并非可执行结构；测试因此断言的是「标签/属性语境为零」，
> 而非「子串不存在」。这一点是本验证与计划字面描述的**唯一措辞差异**，已在执行报告中记录。

结论：**降级分支安全由构造保证（通过）**。

### 验证 2 · 清洗器配置断言（真实调用，非文本猜测）

`tests/js/render_markdown.mjs` 用桩件替换 `window.DOMPurify.addHook` / `sanitize`，
捕获`renderMarkdown()` **实际传入**的配置与 hook，断言：

- `FORBID_TAGS` 含 `script`、`iframe`、`style`、`form`、`object`、`embed`、`link`、`meta`；
- `FORBID_ATTR` 含 `style`、`srcset`、`formaction`；
- `ALLOW_DATA_ATTR === false`；
- `ALLOWED_TAGS` 含 `p/a/img/pre/code/table/blockquote/strong/em`，且不含上述任何被禁标签；
- `ALLOWED_ATTR` 不含 `onerror`/`onclick`/`onload`；
- hook 以 `afterSanitizeAttributes` 名称注册，且**只注册一次**（两次渲染 `addHookCount === 1`）；
- 实际调用该 hook：带 `href` 的 `<a>` 被补上 `target="_blank"` 与 `rel="noopener noreferrer"`；
  无 `href` 的 `<a>` 与非 `<a>` 元素**不被改动**；
- `marked` 收到的选项为 `{ gfm: true, breaks: true }`，其输出原样进入 `DOMPurify.sanitize`。

结论：**清洗配置与 link hook 行为正确（通过）**。

### 验证 3 · 单一 HTML 出口不变式（静态源码走查）

`tests/test_markdown_frontend.py` 扫描 `static/js/*.js` 中所有 `.innerHTML = …` 赋值，逐条分类并报告
`file:line`：

| file:line | 赋值右侧 | 分类 | 说明 |
|-----------|----------|------|------|
| `home.js:46` | `markup` | `allowlisted-static` | `iconEl()` 形参只接收同文件 `ICONS` 里的静态 SVG 字面量，无用户输入来源 |
| `markdown.js:50` | `renderMarkdown(markdown)` | `renderMarkdown` | `markdownToPlainText()` 内，唯一 HTML 出口模块自身 |
| `router.js:55` | `''` | `clear` | 清空容器 |
| `router.js:63` | `''` | `clear` | 清空容器 |
| `router.js:66` | `'<h2>页面不存在</h2>'` | `static-literal` | 静态字面量，无插值 |

同时断言：不存在 `unsafe` 分类的赋值；源码中不使用 `insertAdjacentHTML`、`= outerHTML`、
`document.write(`；豁免清单中的条目必须仍然对应真实存在的写入点（防止豁免腐坏）。

> 说明：详细清单随测试打印（`pytest -s`），本阶段最终输出见执行报告。

结论：**除 `markdown.js` 外没有任何模块把用户内容写入 `innerHTML`（通过）**。

---

## 本文件的诚实边界

- 上表 6 行 + 附加核对 A/B 均**未在真实浏览器中执行**，一律为「待人工确认（本环境无浏览器）」。
- 三条替代验证证明的是：清洗**配置**正确、降级**兜底**安全、HTML 出口**唯一**；
  它们无法证明 DOMPurify 具体版本对每个载荷的最终清洗结果。
- 请在具备浏览器的环境中按下表逐条复核后再勾选通过。
