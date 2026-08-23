# 当前迭代：「选择内容」三 Tab + 首屏默认上卡 —— 已完成

**方案文档**：[2026-08-23-选择内容三Tab与首屏默认上卡方案](../docs/开发及迭代方案调研报告/2026-08-23-选择内容三Tab与首屏默认上卡方案.md)
**开发日志**：[DEVLOG](../docs/DEVLOG.md)

## 检查项

### A. 三个 Tab
- [x] 按钮改成 推文库 / 在线抓取 / 自由编辑，`active` 挪到 `tab-library`
- [x] 副标题改「从推文库选一条，或自己写」
- [x] `#library-section` 去 `hidden`；`#custom-section` 加 `hidden`
- [x] 新建 `#fetch-section` 占位（控件 disabled + 说明文字）
- [x] 「写文案」→「编辑文案」

### B. 首屏上卡
- [x] `state.tab` 默认 `"custom"` → `"library"`
- [x] init 取值改 `state.filtered[0] || state.posts[0]`

### C. 智能带入
- [x] `state.customSeed` 记录上次带入的原文
- [x] `primeCustomText(force)`
- [x] Tab 绑定加第三项，切 custom 时调用
- [x] 「用推文库选中的那条替换」按钮（force 出口）

### D. 实施中发现的缺陷
- [x] 抽 `fromLibrary()` / `currentText()`，修「带 ?text= 切到在线抓取卡片变空」
- [x] `renderCard()` / `buildShareUrl()` / 复制文案 / 两处导出 tag 统一走新函数
- [x] 清掉残留的 `isCustom` 引用（`source-link` 那处）

### E. 样式
- [x] `.text-input:disabled` / `.chip:disabled` 禁用态

### F. 验证
- [x] 首屏（tab / 高亮 / 正文 / 卡片高 367）
- [x] 三 Tab 互斥，任意顺序切换卡片不变空
- [x] 带入四分支（带入 / 覆盖 / 保留改动 / 强制替换）
- [x] `?text=` 不被推文库覆盖
- [x] 在线抓取占位控件禁用
- [x] 三条导出管线 embed 回归
- [x] embed 不带 text 也能出图
- [x] 控制台 0 error
- [x] 更新 DEVLOG

### G. 仓库卫生
- [x] `.gitignore` 加 `docs/feedgrab-x/`（含 token 与 X 登录态，不可提交）

## 复盘

### 顺利的部分

方案阶段先摸链路，发现 `init()` 里早就有「非 custom tab 自动选第一条」的分支，只是默认值挡着从未走到——首屏上卡这个需求实际只改了一个默认值加一个取值，没写新逻辑。

### 踩到的坑

**加第三个枚举值时，要把所有二分判断都找出来。** `state.tab` 原本只有 `library`/`custom` 两个值，全项目有 5 处 `state.tab === "custom" ? A : B` 的三元判断。加了 `fetch` 后这些判断的 else 分支语义就变了——只认 `state.selected`，而带 `?text=` 进来时它是 null，导致卡片变空。

教训：枚举从 2 值扩到 3 值时，`grep` 出所有基于它的分支逐个过一遍，别假设「新值天然落到 else 分支就对了」。这次顺手抽成 `fromLibrary()` / `currentText()` 两个函数，以后再加 tab 只改一处。

还有一个连带遗漏：删掉 `const isCustom` 时只看了它在函数前几行的用法，没 grep 整个函数体，漏了 60 行外 `source-link` 那处，浏览器直接报 `ReferenceError`。**删变量前先 grep 全文件。**

### 遗留

- 单列（<980）下背景缩略图网格 `repeat(5,1fr)` 铺满时偏大
- 「在线抓取」功能待实现（`docs/feedgrab-x/` 是相关的本地服务参考）
