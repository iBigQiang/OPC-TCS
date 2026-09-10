# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目性质

把推文渲染成可发布的图片卡片（3:4 / 9:16 竖图、纯卡片 PNG、3 秒动效 MP4）。**零框架、零构建**，卡片在浏览器本地生成——没有 package.json，没有测试框架，没有 lint 配置。两个第三方库已 vendored 进 `vendor/`，用 `<script>` 直接引入。

唯一的服务端代码是 `functions/api/importer.js`（Cloudflare Pages Function），负责把「在线抓取」的请求转发给用户配置的抓取服务。默认接口为 `https://x-api.opc.tools/import/twitter`，目前通过同源转发满足浏览器跨域限制。应用正式地址为 `https://tcs.opc.tools`。

改代码主要涉及 5 个文件：`index.html` / `styles.css` / `app.js` / `profile.json` / `functions/api/importer.js`。

## 常用命令

```bash
# 起本地服务（必须走 http，直接双击 index.html 不行——要 fetch profile.json / posts.json / manifest.json）
python3 -m http.server 8798

# 要验证「在线抓取」必须用这个：python 起的服务没有 functions/，/api/importer 会 404
npx wrangler pages dev . --port 8798

# 重建推文库：data/raw/page-*.json（X API 原始返回）→ posts.json
python3 scripts/build_posts.py

# 重建背景：写 10 个渐变 SVG + 生成 backgrounds/manifest.json（清单唯一来源）
python3 scripts/gen_backgrounds.py

# 一次性素材脚本：从参考站补下 118 张图库（幂等，已存在的跳过）。图片已全部入库，平时不用跑
python3 scripts/fetch_backgrounds.py

```

## Cloudflare Pages 发布（PowerShell）

只发布经过确认的已提交版本，不直接部署原工作区；`.gitignore` 不能代替发布资源清单。

1. 记录 `git rev-parse HEAD` 的完整提交 SHA 和 `git rev-parse --short HEAD` 的短 SHA，确认所需运行文件已包含在该提交中。
2. 新建 `.wrangler/releases/<提交短SHA>/public`。该目录必须是新的发布目录；若已存在，先核对并保留原归档，不覆盖或递归删除。
3. 使用 `git archive HEAD` 仅归档以下运行资源到 `public/`：`index.html`、`styles.css`、`app.js`、`profile.json`、`posts.json`、`posts.sample.json`、`logo.png`、`avatar.jpg`、`OPC-TCS_logo.png`、`og-image-v1.png`、`twitter-card-v1.png`、`llms.txt`、`backgrounds/`、`vendor/`。将 `functions/` 从同一提交单独归档到发布目录根部，形成与 `public/` 并列的 `functions/`。先写归档文件再解包，避免通过 PowerShell 文本管道传输二进制归档。
4. 核对归档中的路径、文件和提交版本。`.dev.vars`、`docs/`、`data/raw/`、测试产物及本机配置不得进入发布目录。
5. 以 `.wrangler/releases/<提交短SHA>` 为当前目录执行 `npx wrangler pages deploy ./public --project-name=opc-tweet-card-studio --branch=main --commit-hash <完整SHA>`，其中 SHA 替换为第 1 步的值。保留发布归档，后续回滚复用对应提交的目录，不递归删除。

## 验证方式

没有自动化测试。改完后必须手动过一遍，重点：

- **三种 mode × 两种 theme**：`poster`(3:4) / `tall`(9:16) 走 canvas 合成管线，`card` 走独立的纯卡片光栅化管线；纯卡片「默认 / 3:4 / 9:16」三档都要验证切换、大小、字号、透明度和导出。默认档随内容定高，固定档保持精确比例，实际像素尺寸随内容和整体缩放变化，无额外比例留白。两条管线分别验证，纯卡片调整不得影响竖图。
- **iOS Safari 是重点回归对象**。历史上背景整片变黑、导出黑边、下载被拦截都是 iOS 特有的（见 `composePoster()` / `fitStageScale()` / `deliverFile()` 的注释）。
- **embed 模式可脚本化验证**：打开 `?embed=1&text=测试`，等 `document.documentElement.dataset.ready === "1"`，读 `window.__cardDataUrl`。失败时 ready 为 `"error"`，原因在 `window.__cardError`。

## 架构

### state 单一真相源

`app.js` 顶部的 `state` 对象是唯一状态。所有交互归结为「改 state → 调 `renderCard()`」，`renderCard()` 是幂等全量渲染。

例外是高频路径：拖动卡片和缩放滑杆只调 `applyCardTransform()`，仅改 CSS transform 不重渲染。

### 两条导出管线（最容易踩的坑）

| mode | 函数 | 做法 |
|---|---|---|
| `card`，三种 ratio | `capturePureCardCanvas()` | 按 `pureCardSize()` 指定像素尺寸直接光栅化，尺寸随内容和整体缩放变化，保留透明通道 |
| `poster` / `tall` | `composePoster()` | 卡片单独光栅化成 canvas，**背景用原生 `drawImage` 手动合成** |

竖图**故意不让背景走 foreignObject**——iOS Safari 对 foreignObject 里的 `<img>` 渲染不可靠，会导致背景整片变黑。

`exportLive()`（Live 图 MP4）复用同一条合成逻辑：同样的 `drawCover()`、同样的卡片坐标计算、同样的阴影参数。**改 `composePoster()` 的合成逻辑，`exportLive()` 的逐帧循环要同步改**，否则静图和动图会不一致。

`captureCardCanvas()` 捕获前会临时摘掉 `.floating` 和 `transform`——html-to-image 以卡片为根节点时会把这些样式克隆进画布，导致位移和裁切。

### 竖图坐标系：预览 540px 对应导出 1080px

预览 stage 是 540×720（poster）/ 540×960（tall），导出成品是 1080×1440 / 1080×1920。所以竖图合成时处处 `× 2`：`captureCardCanvas(2)`、`card.offsetWidth * 2 * s`、`state.cardX * 2`。

纯卡片独立处理：`state.cardRatio` 默认 `auto`，基础宽度为 `540 * 0.84`（453.6px），高度随内容。`fitPureCard()` 保留用户所选正文字号及原有长度档位倍率；固定 `3:4` / `9:16` 时求自然排版宽度、等比缩放首图，必要时仅微调行距，不搜索 `fontSize` 覆盖滑块。三档的 `cardScale` 都通过整张卡片的 `zoom` 生效，保留左右各 24px、上下各 22px 的常规内边距，不额外延展上下留白。

`pureCardSize()` 按自然布局尺寸和 `3 * cardScale / 100` 计算导出像素；固定比例取整数倍宽高以保持精确比例，不固定为 1080×1440 / 1080×1920。预览顶部显示实际导出尺寸。`capturePureCardCanvas()` 等待媒体、重新布局后临时还原卡片 `zoom`，用明确的 `canvasWidth` / `canvasHeight` 光栅化并保留透明通道，结束后恢复 `zoom`；这条路径不改竖图的 `captureCardCanvas()` / `composePoster()`。

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

**embed 模式不读取 localStorage**：`init()` 使用 `loadProfile(false)`，跳过 `loadPosts()`、普通界面 `bind()` 和设置回填。未指定互动字段的手工链接仍会生成随机数；要保留数据须显式携带数值，不能承诺任意链接每次出图相同。

localStorage keys：`tcs-profile` / `tcs-posts` / `tcs-xkey` / `tcs-xsync` / `tcs-live-hint` / `tcs-importer`。

02 推文库右上「导入 / 导出 / 默认」切换浏览区与三 Tab 管理面板。导入替换本机库并清除旧同步记录、筛选；导出完整库到设备，不上传。「恢复默认推文库」仅清除 `tcs-posts` / `tcs-xsync` 后重新加载默认库，保留账号与接口配置。03 头像上传右侧独立的「恢复默认」仅清除 `tcs-profile`（含 `avatarData`），重新加载 `profile.json` 的默认头像、名称、用户名和蓝 V，不影响推文库或接口设置。

### 在线抓取

「在线抓取」Tab 走 `POST /api/importer`（同源 Function）→ 默认转发给 `https://x-api.opc.tools/import/twitter`。

三个要点：

1. **通过同源 Function 转发**，当前抓取服务未允许本站来源跨域直连。设置兼容 HTTPS 根域名与 `/import/twitter` 完整地址，`normalizeImporterUrl()` 统一路径；旧默认地址的本机配置会迁移到新默认地址。
2. **Function 里必须做 upstream 白名单校验**。默认允许 `x-api.opc.tools` 与旧服务域名；可通过 `IMPORTER_ALLOW_HOSTS` 配置。接口地址允许用户修改，不校验就会成为开放代理（SSRF）。
3. **配置只在 `localStorage["tcs-importer"]` 持久保存**，保存按钮本身不发网络请求。执行抓取时，令牌通过请求头交给本站 Function，再以 Bearer 认证发送给所填 API；本站代码不持久保存、不硬编码或写入仓库。不能把这一流程描述为「令牌不会上传」。Function 保留 `env.X_IMPORTER_TOKEN` 兜底，默认不配。

`mapImportedPost()` 优先从 `thread.tweets` 找 `id === source.tweetId` 的主推文，找不到时取首条。正文保留 `first.text` 原文和换行；时间优先取 `first.publishedAt`，首图取 `first.images[0]`。`promptText` 是整条 thread 的拼接，仅作缺少正文时的兜底；顶层 `media[]` 可能包含其他 thread 推文，不用作主推首图。互动字段直接保留 `likes` / `views` / `retweets` / `replies` / `bookmarks` / `quotes` / `score`。

### 互动数据：真实优先

`hasRealMetrics()` 根据字段是否存在及 `metricsAvailable` 判断是否有真实数据，全 0 仍为真实值；只有缺少数据时才由 `rollMetrics()` 随机兜底。「换一组数据」可主动切成随机。`normalizeMetrics()` 只在读取旧库或旧链接时兼容 `reposts`，新导入、导出和分享统一使用七个原生字段，不批量改写历史 `posts.json`；上游已有 `score` 直接保留。

卡片底部仅按 `replies` / `retweets` / `likes` / `views` / `bookmarks` 顺序显示五项；`quotes` / `score` 保留在数据和分享参数中。显示字段与 `METRIC_KEYS` 分开维护，不能因隐藏两项而删除数据。互动图标使用官方 SVG 路径、`viewBox="0 0 24 24"` 和固定 15px 尺寸。

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

`embed=1` 要求非空 `text`；`init()` 先检查正文，再读取默认账号与 URL 参数，跳过本机推文库、设置和普通事件绑定。`runEmbed()` 隐藏 UI、渲染、把 base64 PNG 挂到 `window.__cardDataUrl`、尺寸挂到 `window.__cardSize`，成功时置 `document.documentElement.dataset.ready = "1"`。空正文、初始化或渲染失败都设置 `ready="error"` 和 `window.__cardError`；不要在外层覆盖 `runEmbed()` 已设置的错误终态。调用者等待 `"1"` 或 `"error"` 后分支处理，成功才解码 PNG，不直接对可能缺失的 dataURL 调用 `split()`；页面截图不能保证原始尺寸与透明通道。

**新增或改动 URL 参数，三处必须同步**：

1. `applyUrlParams()` —— 解析
2. `buildShareUrl()` —— 序列化（「复制链接」按钮和「交给 AI Agent」指令都用它）
3. `llms.txt` —— 对外文档，Agent 读这个

分享始终显式写入当前 `name` / `handle` / `date` / `verified`，避免本机账号或跨天打开改变内容。`verified=1/gold/0` 对应蓝 V / 金 V / 无。纯卡片用 `mode=card&ratio=auto/3:4/9:16`；省略 `ratio` 或传 `auto` 都使用默认自然高度，分享时显式写入当前比例。七项互动数值在 `metrics=off` 时仍保留，关闭参考线时保留 `guides=0`；旧 `reposts` 仅兼容读取，`x` / `y` 只影响竖图。

`buildAgentPrompt()` 只说明 URL 实际携带的内容，不承诺还原全部素材。本机头像和自定义背景不随分享 URL 携带，需另附文件或提供可跨域访问的 URL，分别填入 `avatar` / `bg`；提示根据当前素材动态生成。环回地址仅同机 Agent 可访问，远程需换正式域名并确认部署版本。卡片生成在浏览器完成，页面、外部图片和在线抓取仍有正常网络请求；05 区文案应保持这一边界。

`buildShareUrl()` 对滑块等样式参数只写非默认值以保持链接简短，默认值是**硬编码**在函数里的（`scale 95` / `opacity 90` / `fontsize 17` / `dim 10`）；徽章和纯卡片比例按上面的规则显式写入。卡片落点则抽成了常量 `DEFAULT_CARD_X` / `DEFAULT_CARD_Y`（`-20` / `-37`），state 初值、双击复位、`buildShareUrl()` 判断三处共用——**注意这两个 const 必须定义在 `state` 之前**，否则 state 初始化时命中暂时性死区直接抛错。改 `state` 的初始值时 `buildShareUrl()` 要一起改，否则链接会漏参数。同理，`index.html` 里对应滑块的 `value` 也必须跟着改 —— 这三处（`state.*`、`buildShareUrl()` 判断、滑块 `value`）任一漏改都会导致滑块位置与实际渲染值不符。`syncSliderInputs()` 负责在 URL 参数解析后把 state 回写到滑块，新增滑块要往里加一行。

**注意 `syncSliderInputs()` 让「只改 HTML 的 value」彻底失效**——它会用 `state` 的值覆盖滑块。想调默认值必须改 `state`，`index.html` 的 `value` 只是首帧渲染前的占位。滑块的 `min`/`max` 改了还要同步 `applyUrlParams()` 里对应的 `clampNum` 范围。

`llms.txt` 是 UTF-8 + CRLF，别让工具按 Windows 默认编码（GBK）写回——它是给 Agent 读的对外文档，编码一坏所有中文都是乱码。改动后用 `python -c "open('llms.txt','rb').read().decode('utf-8')"` 验一下。

外部图片（`avatar` / `bg` 传 URL）先 fetch 转 dataURL 再用，避免 canvas 被跨域污染导致 `toDataURL()` 抛错。

### X API BYOK 同步

浏览器无法直连 `api.x.com`（无 CORS 头），请求经 `https://tools.upthos.com/api/x/` 转发。**这个转发 Function 不在本仓库**，本仓库只有前端调用方。Token 在本机 localStorage 持久保存，执行同步时发送给该转发服务用于认证；不要将本应用域名更新误用于这条 BYOK 转发地址。

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
- 通用默认身份为「你的名字」/ `UserName_ID`，默认头像为 `OPC-TCS_logo.png`；`profile.json`、`DEFAULT_PROFILE` 和 `index.html` 的默认头像引用保持一致。本机修改通过 `localStorage["tcs-profile"]` 覆盖，不写回项目文件。`verified` 布尔值兼容旧配置，`badge` 使用 `blue` / `gold` / `none` 区分三种徽章。
