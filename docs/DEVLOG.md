# DEVLOG

开发日志，最新版本在最前面。

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
