# 推文贴片工场 OPC Tweet Card Studio

把你的推文快速做成可发布的图片卡片：选一条推文（或现写文案）→ 选背景 → 导出 PNG。适合把 X 上的内容二次分发到抖音、小红书、视频号等图文平台。

零框架、零构建，卡片在浏览器本地生成；在线抓取通过 Cloudflare Pages Function 转发。正式访问地址：[tcs.opc.tools](https://tcs.opc.tools)。灵感来自 [dontbesilent 抖音图文生成器](https://dontbesilent-tweet-card-studio.vercel.app/)。

通过 JSON 导入或在线抓取推文，在界面中自定义头像、名称和用户名，导出 3:4 / 9:16 竖图或纯卡片 PNG。

## 快速开始

```bash
git clone <repo-url> tweet-cards
cd tweet-cards
npx wrangler pages dev . --port 8798
```

打开 [localhost:8798](http://localhost:8798)。Wrangler 同时提供本地页面与 `/api/importer` 转发接口。只测试卡片编辑和导出时也可以使用 `python3 -m http.server 8798`；静态服务器不支持在线抓取。直接双击 index.html 不行，fetch 数据需要 HTTP 协议。

首次打开是示例数据，两步换成你自己的：

1. **账号信息**（左侧 03 区）：默认头像为 `OPC-TCS_logo.png`、名称为「你的名字」、用户名为 `UserName_ID`；可上传头像、修改名称和用户名，并选择蓝 V / 金 V / 无。设置保存在本机浏览器（localStorage）；头像上传右侧的「恢复默认」只恢复默认头像、名称、用户名和蓝 V，不影响推文库及接口设置
2. **推文库管理**（左侧 02 区）：点击右上角「导入 / 导出 / 默认」，切换浏览区与管理面板。导入会替换本机推文库，并清除旧同步记录和筛选；导出将完整推文库保存到设备，不上传；「默认」中的「恢复默认推文库」只清除本机推文库和同步记录，再载入项目默认库，保留账号信息、接口地址及令牌

## 推文库格式

一个 JSON 数组，每条只有 `text` 必填：

```json
[
  {
    "date": "2026-01-01",
    "text": "推文内容\n支持换行",
    "topic": "分类（可选）",
    "sourceUrl": "https://x.com/you/status/xxx（可选）",
    "metrics": { "likes": 0, "views": 0, "retweets": 0, "replies": 0, "bookmarks": 0, "quotes": 0, "score": 0 },
    "media": { "image": "https://example.com/image.jpg" }
  }
]
```

`metrics` 沿用新抓取接口的七个字段，导入、导出和分享均完整保留；卡片仅按顺序显示回复、转推、点赞、浏览、收藏五项，`quotes` 和 `score` 保留在数据中。真实值为 0 时也会保留，只有缺少互动数据时才随机填充。「换一组数据」可主动生成随机值。旧推文库的 `reposts` 仍兼容读取，新导入和导出使用 `retweets`。`media.image` 可选，显示在正文下方。

数据来源五选一：

- **在线抓取**：在「设置」中填写接口地址与访问令牌。默认接口为 `https://x-api.opc.tools/import/twitter`，也支持输入根域名 `https://x-api.opc.tools`，程序会自动补全 `/import/twitter`。保存设置本身不发送请求，接口地址和令牌只在本机浏览器持久保存；执行抓取时，推文链接和令牌经本站 Cloudflare Function 转发给所填 API，本站不持久保存这些配置，也不写入 GitHub 仓库。卡片使用主推文原文、换行与首图，互动数据使用接口原生字段。

- **BYOK 同步**（页面 06 区）：填你自己的 X API **Bearer Token**（Developer Portal 新建 App 会给 API Key / API Key Secret / Bearer Token 三种凭证，这里只用 Bearer Token——AAAA 开头的长字符串，在 Keys and tokens 页可随时 Regenerate）和用户名，一键拉取并自动填充头像昵称。Key 只存你的浏览器 localStorage；因浏览器无法直连 api.x.com，请求经 tools.upthos.com 的无状态转发（开源 Worker，不记录不存储）。同账号再次同步自动增量。计费：X API 已改为按量付费（2026-02 起，无 Free/Basic 订阅），推文读取约 $0.005/条、用户查询 $0.010/次，月上限 300 万条读取，先在 [X Developer Console](https://developer.x.com/) 充值 credits；24 小时内重复读取同一资源只计费一次。价格以 Console 实时显示为准。

- **UI 导入 JSON**：上面说的「导入推文库 JSON」，存在浏览器本机
- **项目文件**：把文件存成项目根目录的 `posts.json`，加载优先级：本机导入 > `posts.json` > `posts.sample.json`
- **X API 抓取**：如果你用 Claude Code 且接了 X API（MCP），直接让它「用 get_users_posts 拉我的原创推文，跑 scripts/build_posts.py 生成 posts.json」。原始返回存进 `data/raw/page-*.json`，脚本负责合并去重、抽取长推全文（note_tweet）、清洗 t.co 链接、按关键词自动分类。注意时间线接口最多回溯最近 3200 条；更早的历史用 X 设置里的「下载你的数据」归档补齐

## 功能

- **素材库**：关键词搜索、主题筛选、最新/最热/最多收藏排序、随机抽取
- **自定义文案**：现写现上卡，实时预览
- **三种成品**：3:4 竖图（1080×1440）、9:16 竖图（1080×1920）或纯卡片 PNG。纯卡片提供「默认 / 3:4 / 9:16」：默认自然定高，固定比例根据内容调整排版宽度和首图，保留所选正文字号及常规内边距，不额外延展上下留白。三档的卡片大小与正文字号均可调，导出尺寸随内容和整体缩放变化，预览顶部显示当前实际尺寸；固定档保持精确比例
- **抖音安全区参考线**：避开状态栏、右侧互动按钮列、底部文案区，可开关，不进导出成品
- **Live 图素材**：导出 3 秒动效 MP4（背景推近 + 卡片呼吸，WebCodecs 本地编码），手机端用 intoLive/快捷指令转成实况照片即可按 Live 图发布
- **卡片样式**：白/黑主题、直角卡片、整体等比缩放（50%–140%，不改变排版换行）、透明度（30%–100%，文字不透）
- **自由构图**：竖图模式下卡片可拖到画框任意位置（出框裁切），双击回中；超长推文自动缩放适配
- **互动数据**：依次显示回复、转推、点赞、浏览、收藏五项，真实数据优先；缺少数据时随机填充，也可一键换一组或隐藏，数据导入、导出及分享仍保留七个原始字段
- **背景**：内置 152 张（142 张照片 + 10 个渐变），带中文名、关键词搜索与分批展开，也支持本地上传和图片 URL
- **导出**：html-to-image（DOM → SVG foreignObject → canvas）所见即所得，一键复制文案

## 给 AI Agent 调用

页面支持 URL 参数直接出图，任何带浏览器能力的 Agent（Claude Code、Codex、Playwright、浏览器 MCP…）都能调用；图片生成在浏览器完成，无需 API Key：

1. 打开 `https://tcs.opc.tools/?embed=1&text=<文字>&bg=bj_11-forest-path&mode=tall`
2. 等待 `document.documentElement.dataset.ready` 为 `"1"` 或 `"error"`
3. 成功后读取 `window.__cardDataUrl` 和 `window.__cardSize`，将 base64 解码保存为 PNG；失败时读取 `window.__cardError` 并停止保存

```js
// Playwright 示例
const fs = require('node:fs');
await page.goto('https://tcs.opc.tools/?embed=1&text=' + encodeURIComponent('这是一条推文') + '&bg=bj_16-london-night&mode=tall&theme=dark');
await page.waitForFunction(() => ['1', 'error'].includes(document.documentElement.dataset.ready));
const result = await page.evaluate(() => ({
  dataUrl: window.__cardDataUrl,
  size: window.__cardSize,
  error: window.__cardError,
}));
if (result.error || !result.dataUrl) throw new Error(result.error || '图片生成失败');
fs.writeFileSync('card.png', Buffer.from(result.dataUrl.split(',')[1], 'base64'));
console.log('导出尺寸：', result.size);
```

`embed=1` 必须提供非空 `text`，空正文或初始化失败都会返回错误终态；此模式不读取本机 localStorage，也不加载本机推文库。优先保存生成的 base64 PNG，页面截图不能保证原始尺寸和透明通道。手工链接未指定互动数据时会随机生成，重复渲染可能不同；要保留具体数值，请填写七项字段或使用「复制链接」。

参数：`text` `date` / `name` `handle` `avatar` `verified`(1|gold|0) / `mode`(poster|tall|card) `ratio`(auto|3:4|9:16，纯卡片用，默认 auto) `theme` `scale` `opacity` `fontsize` `dim` `x` `y` / `bg`(内置 slug 或图片 URL) `img`(配图 URL) `media=off` / `metrics=off` 或 `likes` `views` `retweets` `replies` `bookmarks` `quotes` `score` / `embed=1`。
完整清单见 [llms.txt](llms.txt)。「复制链接」始终写入当前名称、用户名、日期、徽章和七项互动数值，隐藏互动数据时也保留数值，并保留纯卡片比例及参考线关闭状态。`x` / `y` 仅在竖图模式生效；请按需分享链接中的账号文字和正文。

本机上传的头像与自定义背景不会自动随链接携带；要还原这些图片，请另附文件或提供可跨域访问的图片 URL，分别填入 `avatar` / `bg`。本地环回地址仅同一台电脑上的 Agent 可访问，远程调用需改用 [正式站点](https://tcs.opc.tools)，并确认部署版本已包含所需功能。卡片在浏览器生成，但加载页面、外部图片与在线抓取仍会按需发送网络请求。

## 项目结构

```
index.html / styles.css / app.js   应用本体（vanilla JS，无依赖）
profile.json                        默认账号信息（部署你自己的实例时改这里）
posts.json                          你的推文库（可选，作者的库已内置）
posts.sample.json                   示例数据（兜底加载）
OPC-TCS_logo.png                    默认头像
functions/api/importer.js           在线抓取的同源转发接口
backgrounds/ + manifest.json        内置背景库
vendor/html-to-image.js             导出库（本地 vendored，v1.11.13）
scripts/build_posts.py              X API 原始数据 → posts.json
scripts/gen_backgrounds.py          重新生成渐变背景 + manifest
data/raw/                           X API 原始返回（增量更新的基础）
```

## 部署你自己的实例

卡片编辑与导出可使用静态托管；在线抓取需要支持 `functions/api/importer.js` 的 Cloudflare Pages 环境。本地设置不会自动写回项目文件或部署产物。

使用 [CLAUDE.md 中的 Cloudflare Pages 发布流程](CLAUDE.md)：仅从已提交的 `HEAD` 将运行资源归档到新建的 `.wrangler/releases/<提交短SHA>/public`，将 `functions/` 单独归档到该发布目录根部，再从发布目录部署 `./public`。不要直接部署原工作区；`.dev.vars`、`docs/`、`data/raw/` 和测试产物不进入发布目录，归档保留用于回滚，不递归删除。

部署前可按需调整 `profile.json`、默认头像和 `posts.json`；访客在 UI 里的账号与抓取配置只持久保存到他们自己的浏览器，抓取时按上述流程发送请求。

## 自定义

- **背景**：图片丢进 `backgrounds/`，在 `scripts/gen_backgrounds.py` 的 `PHOTOS` 列表加一行（文件名带 `bj_<下一个未用序号>-` 前缀，第三项是搜索关键词），重跑脚本
- **自动分类关键词**：`scripts/build_posts.py` 里的 `TOPIC_RULES`
- **卡片样式**：`styles.css` 的 `.tweet-card` 一节

## License

[MIT](LICENSE)
