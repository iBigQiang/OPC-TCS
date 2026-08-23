# DEVLOG

开发日志，最新版本在最前面。

---

## 2026-08-23 · 在线抓取功能落地

**方案文档**：[2026-08-23-在线抓取功能实现方案](./开发及迭代方案调研报告/2026-08-23-在线抓取功能实现方案.md)

### 背景

「在线抓取」Tab 上一轮只是占位。本轮接入已部署的 feedgrab-x 服务（`https://importer-x.hitu.me`），实现「贴链接 → 抓正文与互动数据 → 入库上卡 → 直接编辑」。

### 一个绕不开的约束：必须服务端中转

实测 `OPTIONS /import/twitter` 返回 **405 且无任何 `Access-Control-Allow-*` 头**，浏览器直连会被预检拦掉。这与接口文档第 11 行「网站后台只通过服务端调用它，前端页面不直接持有 token」的设计一致。

所以本项目**第一次有了服务端代码**：`functions/api/importer.js`（Cloudflare Pages Function），部署后即 `/api/importer`，与站点同源。

**SSRF 防护是必须项**：接口地址允许用户在设置里改，如果 Function 无脑转发任意 URL，这个站点就成了开放代理——谁都能借 Cloudflare 的出口去打任意地址。故强制校验协议必须 https、host 必须在白名单（默认 `importer-x.hitu.me`，可由环境变量 `IMPORTER_ALLOW_HOSTS` 扩展）。

### 令牌怎么放

只存 `localStorage["tcs-importer"]`，不硬编码进 `functions/`、不进仓库、不进部署产物。与现有 X API BYOK 同一套思路。

需要点明的前提：**这个令牌是部署者私有的**，不像 X API Bearer Token 那样人人可自行申请。所以「访客自带令牌」实际意味着只有持有者本人能用这个功能。Function 保留了 `env.X_IMPORTER_TOKEN` 兜底分支，配上就是对所有访客开放（会消耗部署者自己的抓取服务），默认不配。

### 字段映射

上游响应里 `thread.tweets[0].text` 才是**主推文原文**；`promptText` 是主推 + 整条 thread 的拼接（测试推文 796 字 vs 主推 147 字）。本轮取主推文。

`metrics.retweets` → 本项目的 `reposts` 是唯一需要改名的字段。

### 交互

齿轮按钮放在「02 在线抓取」标题行右侧（`margin-left:auto`），点击展开设置区（接口地址 / 访问令牌 / 保存 / 清除）。抓取成功后自动切到「自由编辑」并把正文带进编辑框——抓完就能改，不用再手动复制一次。

同一条链接重复抓取时**替换**已有记录（更新互动数据），不堆重复条目。

### 验证

Function 层（curl 直测）：

| 用例 | 结果 |
|---|---|
| 无令牌 | 401 + 中文提示 |
| 非白名单地址 `example.com` | 400「不在允许列表内」 |
| http 协议 | 400「必须是 https」 |
| 缺链接 | 400「缺少推文链接」 |
| 真实抓取 | **HTTP 200，4.18 秒** |

UI 层（Playwright，令牌从 env 文件经 `file://` 读取，不落到日志）：

| 用例 | 结果 |
|---|---|
| 未配令牌点抓取 | 提示 + 自动展开设置区 |
| 非推文链接 | 「请填一条形如 …/status/数字ID 的链接」 |
| 错误令牌 | 「访问令牌不对或已失效」 |
| 真实抓取 | 「已抓取：2026-06-07 · 147 字」，推文库 836 → 837 |
| 数据正确性 | likes 196 / views 15700 / reposts 34 / replies 33 / bookmarks 172 |
| 入库与带入 | 落 localStorage ✅、选中上卡 ✅、自动切到自由编辑且编辑框 = 抓来的正文 ✅ |
| 去重 | 再抓一次 837 → 837，提示「已更新」 |
| 回归 | 三 Tab 严格互斥；导出管线 tall 1080×1920 / poster 1080×1440 / card 1362×522；控制台 0 error |

### 开发方式变更

加了 Function 之后，**验证抓取必须用 `npx wrangler pages dev .`**——`python -m http.server` 起的服务下 `/api/importer` 是 404（前端对这个 404 有专门提示）。已写进 CLAUDE.md。

### 部署（当天完成）

已部署，线上抓取生效。部署 ID `ca0a6dab`，两个域名（`tcs.opc.tools` / `opc-tweet-card-studio.pages.dev`）均已验证。

**部署方式改了，这条很重要**：`wrangler pages deploy` 上传的是**文件系统内容，不看 `.gitignore`**。直接 `deploy .` 会把 `docs/feedgrab-x/` 里的 `.env`（两个 token）和 `sessions/twitter.json`（X 登录态）传成公网可访问的静态文件。

正确做法是先导出干净副本再部署：

```bash
rm -rf .deploy-tmp && mkdir .deploy-tmp
git archive HEAD | tar -x -C .deploy-tmp
npx wrangler pages deploy .deploy-tmp --project-name=opc-tweet-card-studio --branch=main
rm -rf .deploy-tmp
```

`git archive HEAD` 只导出已提交内容，`.gitignore` 排除的东西天然不在其中，且 `functions/` 会被包含。

部署前查过线上历史状态：`/docs/feedgrab-x/feedgrab-x.env` 虽然返回 200，但内容哈希与首页、与任意不存在路径完全一致（站点配了 SPA 兜底），确认**此前没有泄露过**。

线上验证：

| 项 | pages.dev | tcs.opc.tools |
|---|---|---|
| 首页 | 200 | 200 |
| `/api/importer` 无令牌 | 401（部署前是 405，即 Function 不存在） | 401 |
| SSRF 防护（非白名单地址） | 400 | 400 |
| `.env` 路径 | 兜底页，未泄露 | 兜底页，未泄露 |
| 真实抓取 | — | **HTTP 200，5.05 秒** |

线上浏览器端到端：抓取 →「已抓取：2026-06-07 · 147 字」→ 推文库 836→837 → 自动切到「自由编辑」→ 编辑框与卡片均为抓来的正文 → 落 localStorage ✅，控制台 0 error。

### 已知瑕疵（待议）

抓取后自动切到「自由编辑」，此时卡片日期显示的是**今天**而非原推文日期（2026-06-07）。原因是 `renderCard()` 里 `fromLibrary()` 为 false 时走 `todayISO()`——这是「自定义文案用当天日期」的既有逻辑。对「基于抓来的推文继续改」这个场景，保留原推文日期更合理。修法需要给编辑态引入一个日期来源标记，本轮未动。

### 仓库卫生

`.gitignore` 增加 `.dev.vars` / `.dev.vars.*`（wrangler 本地环境变量文件，会放令牌）。

---

## 2026-08-23 · 「选择内容」三 Tab + 首屏默认上卡

**方案文档**：[2026-08-23-选择内容三Tab与首屏默认上卡方案](./开发及迭代方案调研报告/2026-08-23-选择内容三Tab与首屏默认上卡方案.md)

### 背景

「01 选择内容」原本两个按钮且默认停在「自定义文案」，导致**首屏卡片正文是空的**——新访客看到一张只有头像和互动数据的空壳卡（高度仅 133px）。该问题在上一轮 DEVLOG 已记为待议项，本轮解决。

### 改动

按钮改成三个，从左到右 **推文库 / 在线抓取 / 自由编辑**（原「自定义文案」改名），默认落在「推文库」。

| 区块 | 变化 |
|---|---|
| `#library-section` | 去掉 `hidden`，成为默认可见 |
| `#fetch-section` | 新建占位（控件 `disabled`，写明即将上线） |
| `#custom-section` | 加 `hidden`，标题「写文案」→「编辑文案」 |

**首屏上卡几乎零成本**：`init()` 末尾早就有 `else if (state.posts.length) selectPost(state.posts[0])`，只因 `state.tab` 默认是 `"custom"` 才从未走到。把默认值改成 `"library"` 就自动上卡了；顺手把取值改成 `state.filtered[0] || state.posts[0]`，语义上就是「列表最上面那条」。`loadPosts()` 已按日期倒序，所以拿到的就是最新一条。

**智能带入**：切到「自由编辑」时把选中的推文带进编辑框。用 `state.customSeed` 记录上次带入的原文，只在「编辑框为空」或「内容仍等于 seed（没改过）」时覆盖——**用户改过的内容永不冲掉**。代价是改过之后选新推文切回来不会自动更新，所以配了一个「用推文库选中的那条替换」按钮做显式出口。

### 实施中发现并修复的缺陷

原先 `renderCard()` 用 `isCustom = state.tab === "custom"` 二分，非 custom 分支只认 `state.selected`。加了第三个 tab 后暴露问题：**带 `?text=` 参数进来（此时 `selected` 为 null）再切到「在线抓取」，卡片正文会整个变空**。

改成按「有没有选中的推文」判断，并抽出两个共用函数：

```js
function fromLibrary() { return state.tab !== "custom" && !!state.selected; }
function currentText() { return fromLibrary() ? state.selected.text : state.customText; }
```

`renderCard()` / `buildShareUrl()` / 「复制文案」/ 两处导出文件名 tag 统一走它们，消除了 5 处重复的三元判断。顺带修好了空库时正文为空字符串的老问题。

### 验证

| 项 | 结果 |
|---|---|
| 首屏 | tab=library、列表首条高亮、正文 = 2026-08-18 那条、卡片高 367（原 133 空壳） |
| 三 Tab 互斥 | 区块严格互斥，任意顺序切换卡片都不变空 |
| 带入（未改过） | 选 A → 切编辑带入 A；选 B → 切编辑覆盖成 B |
| 带入（改过） | 改字后选 C → 切编辑**保留改动**；点「替换」→ 变成 C |
| URL 参数 | `?text=AAA` 落在自由编辑、正文 AAA、切到抓取仍是 AAA、链接仍带 `text=AAA` |
| 三条导出管线 | `tall` 1080×1920 / `poster` 1080×1440 / `card` 1362×522 |
| embed 无 text | `ready=1`，出图 1080×1440（渲染推文库最新一条） |
| 控制台 | 0 error |

### 行为变更提示

embed 模式若**不带 `text` 参数**，此前渲染「写点什么……」占位文字，改后渲染推文库最新一条。带 `text` 的链接（Agent 标准用法、「复制链接」生成的链接）完全不受影响。

### 仓库卫生

`.gitignore` 新增 `docs/feedgrab-x/`。该目录含 `IMPORT_SERVICE_TOKEN` / `X_IMPORTER_TOKEN` 与 `sessions/` 里的 X 登录态，推上公开仓库等于泄露凭证。

---

## 2026-08-23 · 三栏布局 + 背景压暗 / 正文字号滑块

**方案文档**：[2026-08-23-三栏布局与新增滑块方案](./开发及迭代方案调研报告/2026-08-23-三栏布局与新增滑块方案.md)

### 背景

两栏布局下左侧栏堆了 7 个分组、纵向很长，而预览区 732px 宽里 stage 只占 540px——**左右各 96px 是纯马赛克留白**。空间分配失衡。

### 改动

**三栏布局**：`.workspace` `max-width` 1200 → 1480，列改 `400px minmax(0,1fr) 400px`，用 `grid-template-areas` 表达三种形态。「03 样式」「04 背景」整块迁到新建的右栏，左右栏各自独立编号（左 01-05，右 01-02）。

1480 是算出来的：840（两侧栏 + gap）+ 592（中列）刚好让 540px 的 stage 不被 `fitStageScale()` 缩放。

**两个新滑块**（插在既有的卡片大小 / 卡片透明度之后）：

| 滑块 | id | 范围 | 默认 | URL 参数 |
|---|---|---|---|---|
| 正文字号 | `body-size` | 14–24 px | 17 | `fontsize` |
| 背景压暗 | `bg-dim` | 0–55 % | 0 | `dim` |

默认值刻意等于现有渲染结果（17px 是原 `.tc-body` 基准字号，压暗 0 = 不压暗），**所有已生成的分享链接出图逐像素不变**。

### 两个关键取舍

**正文字号没有取代自动分档，而是成为它的基准。** `.tc-body` 的 `size-xs/s/m` 三档从绝对 px（15/13/11.5）改成相对倍率（`calc(var(--tc-body-size) * 0.88 / 0.76 / 0.68)`）。手动定基准与长文自动缩两者叠加，超长推文仍不会溢出画框。变量走 `#tc-body` 的 inline style 而非加 class——`renderCard()` 里那行是 `body.className = …` 整体赋值，任何 class 形式的字号覆盖都会被下次渲染抹掉。

**背景压暗用叠黑层，不用 `filter: brightness()`。** `opacity` 叠黑与导出侧 `ctx.fillRect(rgba(0,0,0,a))` 是同一套 source-over 混合数学；`brightness()` 是乘法，两者不等价，预览与成品会对不上。新增的 `drawDim()` 在 `composePoster()` 和 `exportLive()` 逐帧循环里各调一次，位置都在 `drawCover()` 之后、`ctx.save()` 之前——放到 `save()` 之后会被阴影参数污染，黑幕自己也会投影。

### 附带修复

1. **`llms.txt` 编码回 UTF-8** —— 已核实 `e7269a5` 是 UTF-8、上一次提交 `83cc840` 变成了 GBK。它是给 AI Agent 读的对外文档，GBK 会让绝大多数消费方读成乱码。
2. **`syncSliderInputs()`** —— 此前全项目没有任何代码把 state 回写到 `<input type=range>.value`，打开 `?scale=120` 会出现「标签写 120%、卡片也是 120%、拇指却停在 95」的错位。四个滑块统一修。
3. **`refreshAgentPrompt()`** —— 走轻量路径的滑块（卡片大小、背景压暗）此前不刷新「交给 AI Agent」指令框里的链接。
4. **四个滑块补 `<label for>`** —— 原为 `span`，无可访问性关联。

### 验证

| 项 | 结果 |
|---|---|
| 压暗预览 vs 导出 | `dim=40` 时导出像素 (139,150,142) = 理论值 c×0.6，**误差 0** |
| 正文字号 × 长文 | 560 字落 `size-xs` 档，基准 24px × 0.68 = 16.32px ✅ 不溢出 |
| 默认态零回归 | 字号 17px、遮罩 opacity 0 |
| URL 往返 | 滑块拇指 / 数值标签 / 实际渲染三者一致；恢复默认值后链接省略参数 |
| card 模式隔离 | `dim=50` 下透明 PNG 仍纯白无黑幕，预览遮罩 `display:none` |
| 三条导出管线 | `tall` 1080×1920 / `poster` 1080×1440 / `card` 1362×522，`ready=1` 无 error |

响应式五档实测：

| 视口 | 形态 | stage zoom |
|---|---|---|
| 1920 | 三栏 400/592/400 | 1 |
| 1440 | 三栏 400/537/400 | **0.946** |
| 1279 | 两栏，右栏落到左栏下方 | 1 |
| 1100 | 两栏 | 1 |
| 900 | 单列，顺序 左→预览→右 | 1 |

### 与规划的偏差

1440 视口下 stage 缩到 **94.6%**，规划时说的是 97.8%——算中列宽时漏了滚动条约 15px。视觉上 5% 的缩放不可察觉，且导出仍是全尺寸 1080×1440，故未调整。若要在 1440 上做到 1:1，把两侧栏从 400px 收到 380px 即可（中列 +40px）。

### 可继续优化

- 单列（<980）下背景缩略图网格仍是 `repeat(5,1fr)`，铺满 837px 时每张约 160px，偏大且拉长页面。
- 首屏「推文库」tab 下 `state.selected` 为空，卡片正文空白，需手动选一条。

---

## 2026-08-23 · 默认头像换 JPG，修复 avatar.png 404

### 背景

作者身份替换时把 `avatar.png` 手动换成了 `avatar.jpg`，但代码里 4 处硬编码文件名没跟着改。表现为首屏控制台一条 404：浏览器先按 HTML 的 `src="avatar.png"` 发请求（404），随后 `profile.json` 加载完成才由 `applyProfile()` 纠正成 `avatar.jpg`。视觉上不易察觉，但兜底路径实际是断的 —— `profile.json` 若加载失败，头像就没了。

### 为什么留 JPG 而不是转回 PNG

头像是照片、无透明通道需求，卡片里只渲染 40px 圆形。同画质下 PNG 存照片体积约为 JPG 的 3–5 倍（当前 `avatar.jpg` 24KB），转 PNG 是纯粹的体积损失。所以改的是引用，不是文件。

### 改动

| 位置 | 改动 |
|---|---|
| `app.js:10` | `DEFAULT_PROFILE.avatar` → `avatar.jpg` |
| `app.js:92` | `applyProfile()` 兜底 → `avatar.jpg` |
| `index.html:118` | `#profile-avatar-preview` 的 `src` → `avatar.jpg` |
| `index.html:214` | `#tc-avatar` 的 `src` → `avatar.jpg` |
| `README.md` | 文件清单与部署说明中的文件名 |
| `CLAUDE.md` | 兜底文件名，并补「头像用 JPG 的理由 + 四处需同改」 |

`index.html` 的 og:image / twitter:image / favicon 上一轮已指向 `avatar.jpg`，本次不动。

### 验证

首屏控制台错误 **1 → 0**，`avatar.png` 请求消失。

三条导出管线 embed 回归，尺寸与上一轮记录一致：

| mode | 尺寸 | ready |
|---|---|---|
| `tall` | 1080×1920 | 1 ✅ |
| `poster` | 1080×1440 | 1 ✅ |
| `card` | 1362×525 | 1 ✅ |

`window.__cardError` 三次均为 null。

### 观察到的待议项（本次未动）

首屏「推文库」tab 下 `state.selected` 为空，卡片正文空白、高度仅 133px，要手动选一条才出内容（`posts.json` 836 条加载正常，月份筛选 5 项正常）。属默认空态设计，非本次回归，留待下轮讨论是否默认选中一条。

---

## 2026-08-22 · 统一 card-scale 默认值为 95%

承接上一条的「已知遗留」，把上次只落了一半的「92% → 95%」补完。

### 改动

| 位置 | 改动 |
|---|---|
| `app.js:23` | `cardScale: 92` → `95` |
| `app.js:1054` | `buildShareUrl()` 判断 `!== 92` → `!== 95` |
| `llms.txt:49` | 文档「默认 92」→「默认 95」 |
| `CLAUDE.md` | 硬编码默认值清单 `92` → `95`，并补一句：三处（state / buildShareUrl / 滑块 value）必须同改 |

`index.html:97` 滑块 `value="95"` 上次已改，本次不动。

### 刻意没动的同名数字

`app.js:329` 的 `stage.clientHeight * 0.92` 是 **fitScale 的画框留白系数**（长文自动缩放时留 8% 边距），与卡片缩放默认值无关，全局替换会误伤。同理跳过 `styles.css` 的 `#92400e`（accent-hover 色值）、`.sg-label-top{top:92px}`（安全区标签位），以及各处 `1920` 中的 `92`。

### 验证

三方一致性（首屏默认态）：

| 检查项 | 结果 |
|---|---|
| 滑块 `value` | 95 |
| 标签 `#scale-val` | 95% |
| 卡片实际 transform | `scale(0.95)` |

`buildShareUrl()` 省略逻辑：

| 场景 | 链接中的 scale |
|---|---|
| 默认 95 | 省略 ✅ |
| 调到 100 | `scale=100` ✅ |
| 调回 95 | 又省略 ✅ |

URL 参数端：不传 `scale` → 生效 95% ✅；显式传 `scale=92`（旧链接）→ 生效 92% ✅，向后兼容未破坏。
embed 出图 1080×1440，`ready=1` 无 error ✅。

### 行为变更提示

此前生成的、**未带 `scale` 参数**的分享链接，现在会按 95% 渲染（原 92%）。带显式 `scale=92` 的链接不受影响。

---

## 2026-08-22 · 对齐上游在线版样式

**方案文档**：[2026-08-22-在线版样式同步方案](./开发及迭代方案调研报告/2026-08-22-在线版样式同步方案.md)
**对比图**：[三态对比](./开发及迭代方案调研报告/assets/2026-08-22-样式同步三态对比.png)

### 背景

本地 fork 与上游在线版 `tools.upthos.com/tweet-card` 视觉不一致，表现为首屏标题区与下方控制面板左边缘错位。

### 定位

抓取在线版源码确认：单文件 164KB，CSS 为**内嵌 `<style>` 167 行**，无外链 stylesheet，无外链 JS。

Playwright 实测（1440×900）定位到两个根因：

1. **`.hero` 塌缩至 765px**（在线版 1200px），左边缘右偏 217px
   链路：本地独有的 `<main class="app-shell">` 是 flex column 容器 → `.hero` 只写 `max-width` 未写 `width` → flex item 上的 `margin:0 auto` 抑制 `align-items:stretch` → 退化为 fit-content（720px 内容 + 45px padding = 765px，与实测吻合）
   `.workspace` 因显式写了 `width:100%` 未受影响，故只有 hero 错位

2. **根字号 15px vs 16px**，全站 rem 小 6.25%

> 注：用户初始描述为「本地是全宽」，实测恰好相反 —— 是 hero 被压窄，不是变宽。

### 实施

- `styles.css` 12 处：删 `:root` 的 `font-size:15px`；**删除 `.app-shell` 规则**（治根因，非给 `.hero` 补 `width:100%` 打补丁）并留注释防回退；`.hero h1` 补 `letter-spacing:-0.03em`；`.hero-agent` 去 `!important`；`.workspace` 去 `width:100%`；`.topnav-back` 补 transition 并改用 SVG 箭头；删第 177 行重复的 `.drag-hint`；补 `.footer a`；补 3 处注释
- `index.html`：head 补齐 SEO（description / keywords / robots / og / twitter / JSON-LD），**刻意不加 canonical 与 og:url** —— 本仓库是 fork，照抄上游会向搜索引擎声明「正版在别处」，留注释提示部署者自填；body 换 SVG 箭头、「素材库」→「推文库」、「内置渐变」→「内置图库」、补推文库格式说明、`#badge-on` 补 `active`、去死 class `.sort-row`、footer 补致谢
- **未动 `app.js`**（用户明确限定）

保留未对齐的项及理由见方案文档第 4.1 / 4.2 节（`min-width:0`、06 区转发说明等 4 项，本地表述更准确或有防御价值）。

### 验证

| 指标 | 在线版 | 改后本地 |
|---|---|---|
| 根字号 | 16px | 16px ✅ |
| `.hero` 宽 / 左边缘 | 1200 / 113 | 1200 / 113 ✅ |
| `.hero h1` 字号 / 字距 | 24.8px / -0.744px | 24.8px / -0.744px ✅ |
| `.control-panel` 左边缘 | 137 | 137 ✅ |
| `.preview-panel` 宽 / 左边缘 | 732 / 557 | 732 / 557 ✅ |
| `.stage` 宽 / 左边缘 | 540 / 653 | 540 / 653 ✅ |

三条导出管线回归（embed 模式）：`tall` 1080×1920 ✅ / `poster` 1080×1440 ✅ / `card` 1362×525（卡片本体 454×175 @3x）✅，`ready=1` 无 error。

### 已知遗留（已修复，见本文件最上方条目）

`card-scale` 默认值三处不一致，来自上一次「92% → 95%」的改动只落了一半：

| 位置 | 当前值 |
|---|---|
| `index.html:97` slider value | **95** |
| `app.js:23` `state.cardScale` | 92 |
| `app.js:1054` `buildShareUrl()` 判断 | `!== 92` |
| `llms.txt:49` 文档 | 默认 92 |

现象：首屏滑块停在 95 位置，但标签显示「92%」，卡片按 92% 渲染。补完需改 app.js 两处 + llms.txt 一处，本次因范围限定未动。

### 仓库卫生

`.gitignore` 补 `.wrangler/`（含 Cloudflare `account_id`）与 `.playwright-mcp/`。
