# 当前迭代：三栏布局改造 + 背景压暗 / 正文字号滑块 —— 已完成

**方案文档**：[2026-08-23-三栏布局与新增滑块方案](../docs/开发及迭代方案调研报告/2026-08-23-三栏布局与新增滑块方案.md)
**开发日志**：[DEVLOG](../docs/DEVLOG.md)

## 检查项

### 前置
- [x] llms.txt 从 GBK 转回 UTF-8

### A. 三栏布局
- [x] `.workspace` max-width 1200 → 1480，列改 `400px minmax(0,1fr) 400px`，加 `grid-template-areas`
- [x] 三个面板各自 `grid-area`
- [x] 新增 `@media (max-width:1279px)` 两栏退化
- [x] 现有 `@media (max-width:980px)` 补 areas，单列顺序 左→预览→右

### B. 迁移分组
- [x] index.html 新建 `<aside class="control-panel control-panel-right">`
- [x] 「03 样式」「04 背景」整块剪切过去
- [x] 左右栏分组编号重排（左 01-05，右 01-02）

### C. 新滑块
- [x] `#bg-dim`（0–55，默认 0）+ `#body-size`（14–24，默认 17）HTML
- [x] `state.bgDim` / `state.bodySize`
- [x] `bind()` 两个 `oninput`
- [x] `renderCard()` 消费两值（字号走 CSS 变量 inline style）
- [x] styles.css `.tc-body` 四档改 `calc(var(--tc-body-size))`
- [x] styles.css 新增 `.stage-dim` + `.stage.card-only .stage-dim`
- [x] index.html `#stage-bg` 后加 `#stage-dim`
- [x] `composePoster()` 插 `drawDim()`
- [x] `exportLive()` 逐帧插 `drawDim()`
- [x] card 模式隐藏「背景压暗」滑块

### D. 参数同步
- [x] `applyUrlParams()` 解析 `dim` / `fontsize`
- [x] `buildShareUrl()` 序列化（非默认值才写）
- [x] `llms.txt` 补两行
- [x] `README.md` 参数清单
- [x] `CLAUDE.md` 硬编码默认值清单 + llms.txt 编码约定

### E. 附带修复
- [x] `syncSliderInputs()` — 四个滑块 value 与 state 对齐
- [x] `refreshAgentPrompt()` — 轻量路径也刷新 Agent 指令
- [x] 四个滑块补 `<label for>`

### F. 验证
- [x] 布局五视口实测（1920/1440/1279/1100/900）
- [x] 默认态零回归（字号 17px、dim opacity 0）
- [x] 压暗预览 vs 导出像素一致性（误差 0）
- [x] 正文字号 × 长文分档（560 字 → 16.32px）
- [x] URL 往返三者一致
- [x] 三条导出管线 embed 回归
- [x] card 模式无黑幕
- [x] Impeccable 检测器扫描（两条命中均非本轮引入）
- [x] 更新 DEVLOG

## 复盘

### 顺利的部分

方案阶段把「三处同步」「两条导出管线」「className 整体赋值会抹掉 class」这些坑提前挖出来了，实施时没有返工。压暗做到预览与导出**误差 0**，靠的是一开始就选了叠黑层而不是 `filter: brightness()`——两者数学不等价，选错了后期很难对齐。

### 踩到的坑

1. **浏览器缓存导致误判**。改完 CSS 后实测仍是旧的两栏值，一度怀疑代码没生效。`curl` 确认服务端已是新内容后才定位到是浏览器缓存，用 CDP `Network.clearBrowserCache` + `setCacheDisabled` 解决。以后改完静态资源验证前先禁缓存。

2. **算宽度漏了滚动条**。规划说 1440 视口下中列 552px、zoom 0.978，实测是 537px、0.946。视口宽 ≠ 可用宽，还要扣约 15px 滚动条。

3. **超长 URL 污染上下文**。用 `location.href = '?text=' + encodeURIComponent(560字)` 做测试，Playwright 把完整 URL 回显了三次。以后长文本测试改用 `state` 直接赋值或短参数。

### 遗留

- 1440 视口 stage 缩到 94.6%（可接受；若要 1:1 把侧栏收到 380px）
- 单列下背景缩略图网格 `repeat(5,1fr)` 铺满时偏大
- 首屏「推文库」tab 下卡片正文空白
