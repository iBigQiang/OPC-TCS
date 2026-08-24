# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

把推文渲染成可发布的图片卡片（3:4 / 9:16 竖图、透明 PNG、3 秒动效 MP4）。**纯静态、零框架、零构建**——没有 package.json，没有测试框架，没有 lint 配置。两个第三方库已 vendored 进 `vendor/`，用 `<script>` 直接引入。

唯一的服务端代码是 `functions/api/importer.js`（Cloudflare Pages Function），只做一件事：把「在线抓取」的请求转发给 importer-x 服务。存在的理由是那个服务不发 CORS 头，浏览器直连会被预检拦掉。

改代码主要涉及 5 个文件：`index.html` / `styles.css` / `app.js` / `profile.json` / `functions/api/importer.js`。

## 常用命令

```bash
# 起本地服务（必须走 http，直接双击 index.html 不行——要 fetch profile.json / posts.json / manifest.json）
python3 -m http.server 8798

# 要验证「在线抓取」必须用这个：python 起的服务没有 functions/，/api/importer 会 404
npx wrangler pages dev .

# 重建推文库：data/raw/page-*.json（X API 原始返回）→ posts.json
python3 scripts/build_posts.py

# 重建背景：写 10 个渐变 SVG + 生成 backgrounds/manifest.json（清单唯一来源）
python3 scripts/gen_backgrounds.py

# 一次性素材脚本：从参考站补下 118 张图库（幂等，已存在的跳过）。图片已全部入库，平时不用跑
python3 scripts/fetch_backgrounds.py

# 部署（Cloudflare Pages，项目名 opc-tweet-card-studio）
# 不要直接 deploy . —— wrangler 上传的是文件系统内容，不看 .gitignore，
# 会把 docs/feedgrab-x/ 里的 token 与 X 登录态传成公网可访问的静态文件。
rm -rf .deploy-tmp && mkdir .deploy-tmp
git archive HEAD | tar -x -C .deploy-tmp
npx wrangler pages deploy .deploy-tmp --project-name=opc-tweet-card-studio --branch=main
rm -rf .deploy-tmp
```

## 验证方式

没有自动化测试。改完后必须手动过一遍，重点：

- **三种 mode × 两种 theme**：`poster`(3:4) / `tall`(9:16) 走 canvas 合成管线，`card` 走透明光栅化管线，两条路径完全独立，改一条要单独验另一条。
- **iOS Safari 是重点回归对象**。历史上背景整片变黑、导出黑边、下载被拦截都是 iOS 特有的（见 `composePoster()` / `fitStageScale()` / `deliverFile()` 的注释）。
- **embed 模式可脚本化验证**：打开 `?embed=1&text=测试`，等 `document.documentElement.dataset.ready === "1"`，读 `window.__cardDataUrl`。失败时 ready 为 `"error"`，原因在 `window.__cardError`。

## 架构

### state 单一真相源

`app.js` 顶部的 `state` 对象是唯一状态。所有交互归结为「改 state → 调 `renderCard()`」，`renderCard()` 是幂等全量渲染。

例外是高频路径：拖动卡片和缩放滑杆只调 `applyCardTransform()`，仅改 CSS transform 不重渲染。

### 两条导出管线（最容易踩的坑）

| mode | 函数 | 做法 |
|---|---|---|
| `card` | `captureCardCanvas(3)` | html-to-image 直接光栅化卡片，透明背景 |
| `poster` / `tall` | `composePoster()` | 卡片单独光栅化成 canvas，**背景用原生 `drawImage` 手动合成** |

竖图**故意不让背景走 foreignObject**——iOS Safari 对 foreignObject 里的 `<img>` 渲染不可靠，会导致背景整片变黑。

`exportLive()`（Live 图 MP4）复用同一条合成逻辑：同样的 `drawCover()`、同样的卡片坐标计算、同样的阴影参数。**改 `composePoster()` 的合成逻辑，`exportLive()` 的逐帧循环要同步改**，否则静图和动图会不一致。

`captureCardCanvas()` 捕获前会临时摘掉 `.floating` 和 `transform`——html-to-image 以卡片为根节点时会把这些样式克隆进画布，导致位移和裁切。

### 坐标系：预览 540px ↔ 导出 1080px，固定 2 倍

预览 stage 是 540×720（poster）/ 540×960（tall），导出成品是 1080×1440 / 1080×1920。所以合成时处处 `× 2`：`captureCardCanvas(2)`、`card.offsetWidth * 2 * s`、`state.cardX * 2`。

`styles.css` 里安全区参考线的数值（`top:75px` / `right:70px` / `bottom:150px` / `left:30px`）是**预览 px**，对应画布是双倍。参考线只在预览显示，不进成品（它在 `#safe-guides` 里，不在 `#tweet-card` 内）。

### 缩放是两级相乘

`fitScale`（长文自动缩到画框内，`renderCard()` 里按 stage 高度算）× `cardScale`（用户滑杆 50–140%）。合成时 `s = fitScale * cardScale / 100`。

### 移动端用 zoom，不用 transform

`fitStageScale()` 用 `stage.style.zoom` 适配窄屏——transform 会残留 540px 布局导致溢出错位。两个连带影响：

- `composePoster()` 必须先临时把 zoom 还原成 `"1"` 再测量捕获，`finally` 里恢复。
- `initDrag()` 的指针位移要除以 zoom 换算回画布坐标。

### rAF 猴补丁

`app.js` 开头覆写了 `window.requestAnimationFrame`：后台标签页里 rAF 被浏览器冻结，会卡死 html-to-image 导出和卡片测量，`document.hidden` 时退化为 `setTimeout`。别删。

### 数据加载与持久化

推文库优先级：`localStorage["tcs-posts"]` > `posts.json` > `posts.sample.json`。
账号信息：`profile.json` 打底 + `localStorage["tcs-profile"]` 覆盖。

**embed 模式故意忽略 localStorage**（`init()` 里 `loadProfile(q.get("embed") !== "1")`），保证同一条链接在任何设备上出图一致。

localStorage keys：`tcs-profile` / `tcs-posts` / `tcs-xkey` / `tcs-xsync` / `tcs-live-hint` / `tcs-importer`。

### 在线抓取

「在线抓取」Tab 走 `POST /api/importer`（同源 Function）→ 转发给 `importer-x.hitu.me`。

三个要点：

1. **必须转发**，不能前端直连——importer-x 的 `OPTIONS` 返回 405 且无任何 `Access-Control-Allow-*` 头。
2. **Function 里必须做 upstream 白名单校验**。接口地址允许用户在设置里改，不校验的话这个 Function 就是开放代理，谁都能借 Cloudflare 出口打任意地址（SSRF）。
3. **令牌只存 `localStorage["tcs-importer"]`**，不硬编码进 `functions/`、不进仓库。Function 保留了 `env.X_IMPORTER_TOKEN` 兜底分支，配上就是对所有访客开放（会消耗部署者自己的抓取服务），默认不配。

上游响应里 `thread.tweets[0].text` 才是主推文原文，`promptText` 是主推 + 整条 thread 的拼接。字段映射时 `metrics.retweets` → 本项目的 `reposts`。媒体只取 `thread.tweets[0].images[0]`（顶层 `media[]` 含整条 thread 的），视频取封面图不取视频本身。

### 互动数据：真实优先

`posts.json` 里的条目**基本都带真实 metrics**（836 条全有，views 全 >0）。`applyMetricsFor()` 判断任一项 >0 就用真实值，否则 `rollMetrics()` 随机兜底。「换一组数据」按钮是主动切成随机（数据不好看时美化用）。

### 卡片配图

`#tc-media` 必须带 `crossorigin="anonymous"`——没有它 html-to-image 光栅化时会污染 canvas，导出直接失败。`pbs.twimg.com` 会回显请求 Origin 的 CORS 头，实测本地与线上都能正常光栅化，所以**推文库只存图片 URL，不存 dataURL**（存 dataURL 会撑爆 localStorage 配额）。

导出前必须 `await mediaReady()`，图片没加载完光栅化会得到空白。

`fitScale` 有两套基准：**有配图时按安全区可用高度**（poster 495 / tall 722），纯文字沿用 `stage.clientHeight * 0.92`。后者不能改——改了所有历史分享链接的出图都会突然变小。安全区垂直中心比画布中心高 37.5px，正好对应默认 `cardY = -37`。

配图布局是三档（`layoutMedia()`），**绝不用居中裁切**（会把图片头尾都切掉）：

1. 全宽放得下 → 原样完整显示
2. 放不下但等比缩小后不至于太窄（≥ 卡片宽的 `MEDIA_MIN_W_RATIO`，当前 0.15）→ 加 `.fit`，等比缩小、宽度自动收窄，图片仍完整
3. 缩完太窄 → 加 `.crop`，保持全宽、`object-position: top`，只截掉底部

阈值刻意压得很低：**完整显示优先**，宁可图小也别切内容，裁切只是「缩到几乎看不出是什么」的兜底。

**两个容易算错的地方**：

- `fitScale` 让「卡片**布局**高度 = 可用高度」，但最终 transform 还要再乘一次 `cardScale`。所以可用高度必须先除以 `cardScale` 折算回布局坐标系，否则卡片只填到安全区的 95%。
- `cardY = -37` 是按 3:4 定的（3:4 安全区中心正好在画布中心上方 37.5px），**9:16 的上安全线是 88 不是 75**，中心只在上方 31px。差这 6px 会让卡片整体偏上、底部空一截。`state.fitOffsetY` 就是补这个差值；用户一拖动卡片（`state.cardDragged`）就清零，拖动优先。预览与两条导出管线都走 `effectiveCardY()`，不能只改一处。

「自由编辑」里正文贴的图片直链会被 `splitMediaFromText()` 自动识别成配图并从正文摘掉（X 上媒体链接本来也不显示为文本）；反过来 `primeCustomText()` 带入推文时也会把配图以链接形式追加到正文末尾，形成闭环——手动删掉那行链接，配图就没了。`effectiveContent()` 是正文与配图的唯一出口，`renderCard()` / `buildShareUrl()` / 「复制文案」都走它。

### Agent 接口：URL 参数 → embed 渲染

`applyUrlParams()` 解析参数 → `runEmbed()` 隐藏 UI、渲染、把 base64 PNG 挂到 `window.__cardDataUrl`、尺寸挂 `window.__cardSize`，最后置 `document.documentElement.dataset.ready = "1"`。

**新增或改动 URL 参数，三处必须同步**：

1. `applyUrlParams()` —— 解析
2. `buildShareUrl()` —— 序列化（「复制链接」按钮和「交给 AI Agent」指令都用它）
3. `llms.txt` —— 对外文档，Agent 读这个

`buildShareUrl()` 只写非默认值以保持链接简短，默认值是**硬编码**在函数里的（`scale 95` / `opacity 90` / `fontsize 17` / `dim 10`）。卡片落点则抽成了常量 `DEFAULT_CARD_X` / `DEFAULT_CARD_Y`（`-20` / `-37`），state 初值、双击复位、`buildShareUrl()` 判断三处共用——**注意这两个 const 必须定义在 `state` 之前**，否则 state 初始化时命中暂时性死区直接抛错。改 `state` 的初始值时 `buildShareUrl()` 要一起改，否则链接会漏参数。同理，`index.html` 里对应滑块的 `value` 也必须跟着改 —— 这三处（`state.*`、`buildShareUrl()` 判断、滑块 `value`）任一漏改都会导致滑块位置与实际渲染值不符。`syncSliderInputs()` 负责在 URL 参数解析后把 state 回写到滑块，新增滑块要往里加一行。

**注意 `syncSliderInputs()` 让「只改 HTML 的 value」彻底失效**——它会用 `state` 的值覆盖滑块。想调默认值必须改 `state`，`index.html` 的 `value` 只是首帧渲染前的占位。滑块的 `min`/`max` 改了还要同步 `applyUrlParams()` 里对应的 `clampNum` 范围。

`llms.txt` 是 UTF-8 + CRLF，别让工具按 Windows 默认编码（GBK）写回——它是给 Agent 读的对外文档，编码一坏所有中文都是乱码。改动后用 `python -c "open('llms.txt','rb').read().decode('utf-8')"` 验一下。

外部图片（`avatar` / `bg` 传 URL）先 fetch 转 dataURL 再用，避免 canvas 被跨域污染导致 `toDataURL()` 抛错。

### X API BYOK 同步

浏览器无法直连 `api.x.com`（无 CORS 头），请求经 `https://tools.upthos.com/api/x/` 转发。**这个转发 Function 不在本仓库**，本仓库只有前端调用方。Token 只存 localStorage，不上传。

增量同步：`localStorage["tcs-xsync"]` 存 `{handle, newestId}`，同账号再同步时带 `since_id`。

**`cleanApiText()`（app.js）和 `clean_text()`（scripts/build_posts.py）是同一套清洗逻辑的两份实现**——长推取 `note_tweet` 全文、媒体 t.co 删除、普通 t.co 换成 `display_url`。改一个必须改另一个。

### 背景库是生成物

`backgrounds/manifest.json` 由 `gen_backgrounds.py` 生成，**手改会被下次重跑覆盖**。加照片的正确姿势：图片丢进 `backgrounds/` → 在脚本的 `PHOTOS` 列表加一行 → 重跑脚本（脚本只收录实际存在的文件）。渐变改 `PALETTES`。

152 项：照片 `bj_1`–`bj_142`、渐变 SVG `bj_143`–`bj_152`。文件名格式 `bj_<n>-<slug>.<ext>`，manifest 每条三字段 `file` / `name`（中文名 + 三位序号）/ `keywords`（搜索用，空格分隔）。

三条容易踩的：

- **序号写死在文件名里，`name` 的三位序号由 `numbered()` 从文件名解析**——两处各写一遍迟早不一致。序号也绝不按列表位置计算：往中间插一张图不该导致后面全部改名，新图直接取下一个未用序号接在末尾。渐变段的起点 `SVG_BASE` 从 `PHOTOS` 的最大序号派生，别改回手写常量：一套编号只允许一个手写起点，两端都手写就等着它们错开。`check_numbers()` 拦的正是这个——撞号不会崩，只会静默产出两个同名条目（比如两个「旅行素材 143」），前端搜索和分享链接跟着一起错。
- **`.gitignore` 里有 `bg_*.jpg`**（无斜杠 = 匹配任意层级）。前缀是 `bj_` 不是 `bg_`，**一字之差会让整个图库被 git 静默忽略、部署后全部 404**。批量加图后跑一次 `git check-ignore backgrounds/bj_*.jpg` 确认为空。
- **`keywords` 别写太宽**。参考站给 110 张 travel 全写了「旅行 城市 山海 雪景 汽车 风景 建筑」，搜「城市」会命中全部 110 张、把真正叫「城市屋顶」的淹掉。本项目那批只写「旅行 素材」。

前端网格（`renderBackgroundGrid()`）是幂等全量重渲染，搜索/展开/上传都只改 state 再调它。所以两件事**不能**放在渲染里：设默认背景（在 `init()` 里做一次，否则每次搜索都重置用户选择）、`active` 标记（由 `state.bg` 比对 src 得出，靠 DOM 元素传引用的话一次重渲染就丢）。折叠常量 `BG_INITIAL` / `BG_PAGE` 和 `DEFAULT_CARD_*` 同理必须定义在 `state` 之前，state 初值引用它。选中项若被折叠挡住会自动展开到覆盖它那一页并写回 `state.bgVisible`——只放大局部变量的话，下次点「查看更多」会从 40 起算反而变少。

**自定义上传图（`state.customBgs`）排在最前，并和内置图共用同一份格子预算**（`shown = list.slice(0, bgVisible - custom)`），`bg-count` 的分子分母也都含它。不共用的话上传一张首屏就变 41 格、第 9 行冒出一个孤格，「5 列 × 8 行」当场破掉。它只是不参与搜索匹配——搜任何词自定义图都还在。

`bgThumb()` 逐个 `createElement` 而不是拼 `innerHTML`：自定义背景的 src 是 dataURL，MIME 段来自「粘贴图片 URL」拉到的远端 `Content-Type`（外部可控），拼进 `src="${...}"` 理论上能靠一个引号逃出属性。注意 `img.src = x` 之后 `getAttribute("src")` 仍返回原始字符串（`.src` 返回绝对化 URL），所以 `setBg()` 的比对必须继续用 `getAttribute`。

`resolveBgParam()` 的匹配剥掉 `^(photo-|bj_\d+-)` 前缀，所以编号化之前发出去的分享链接（`?bg=photo-forest-path`、`?bg=ink-dawn`）仍然有效。

## 约定

- 注释全中文，且只写「为什么」不写「是什么」——现有注释基本都在解释某个反直觉的取舍（iOS 兼容、zoom vs transform、rAF 冻结），保持这个密度。
- 卡片本身（`.tweet-card` 一节）要贴 X 原生视觉，不跟站点配色走。站点用 `:root` 里的琥珀色变量，卡片用硬编码的 X 色值（`#1d9bf0` 蓝、`#0f1419` 深色文字、dark 模式 `#000` / `#e7e9ea`）。
- `profile.json` 是部署者自己的身份（当前是作者的），`DEFAULT_PROFILE` 和 HTML 里硬编码的 `avatar.jpg` 是通用兜底。改默认身份改 `profile.json`，别动 `DEFAULT_PROFILE`。头像用 JPG 不用 PNG——是照片、无透明需求，同画质下体积只有 PNG 的 1/3。换头像时 `app.js` 两处兜底与 `index.html` 两处 `src` 的文件名要一起改，否则首屏会先请求到 404 再被 `profile.json` 纠正。
