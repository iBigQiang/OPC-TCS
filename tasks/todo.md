# 当前迭代：在线抓取功能落地 —— 已完成

**方案文档**：[2026-08-23-在线抓取功能实现方案](../docs/开发及迭代方案调研报告/2026-08-23-在线抓取功能实现方案.md)
**开发日志**：[DEVLOG](../docs/DEVLOG.md)

## 检查项

### A. 服务端转发
- [x] 新建 `functions/api/importer.js`
- [x] SSRF 防护：https 强制 + host 白名单（`IMPORTER_ALLOW_HOSTS` 可扩展）
- [x] 令牌走请求头，`env.X_IMPORTER_TOKEN` 兜底分支预留
- [x] 固定 `includeRaw:false`，`timeoutSeconds` 默认 90 + AbortSignal 超时
- [x] 原样透传上游状态码

### B. 面板 UI
- [x] 齿轮按钮进标题行右侧（`.heading-action`）
- [x] 设置区：接口地址 / 访问令牌 / 保存 / 清除 / 说明
- [x] 抓取输入框 + 按钮 + 状态位（去掉 disabled）

### C. 前端逻辑
- [x] `IMPORTER_KEY = "tcs-importer"`，`loadImporterCfg()` / `applyImporterCfgToInputs()`
- [x] `mapImportedPost()` 字段映射（`retweets` → `reposts`）
- [x] `fetchTweetByUrl()`：链接校验 → 请求 → 去重入库 → 持久化 → 选中 → 带入编辑框 → 切 Tab
- [x] 错误码翻译（400/401/404/502/504）
- [x] 回车键触发抓取

### D. 文档
- [x] CLAUDE.md：项目性质（不再是「无后端」）、`wrangler pages dev` 命令、在线抓取三要点
- [x] `.gitignore` 加 `.dev.vars`

### E. 验证
- [x] Function 五条路径（无令牌 / SSRF / http / 缺链接 / 真实抓取 200 @4.18s）
- [x] UI 五条路径（未配令牌 / 链接校验 / 错误令牌 / 真实抓取 / 去重）
- [x] 数据正确性核对（likes 196 / views 15700 / reposts 34）
- [x] 入库 + 上卡 + 自动切到自由编辑 + 编辑框带入
- [x] 回归：三 Tab 互斥、三条导出管线、控制台 0 error
- [x] 更新 DEVLOG

## 复盘

### 关键判断

**先测 CORS 再动手是对的。** 强哥最初的设想是浏览器直接持令牌调 API。如果照做，写完全部前端代码才会在联调时撞上预检 405，整个方案要推倒。花两条 curl 先验证，把架构问题挡在编码之前。

**接口文档里那句「前端页面不直接持有 token」不是随口一提**，它同时解释了为什么没有 CORS 头——服务本来就不打算被浏览器直连。读文档时留意这类设计意图声明，能提前预判技术约束。

### 安全上的主动防护

方案里加了原始需求没提的 SSRF 白名单。因为「接口地址可配置」+「服务端转发」这两个特性叠加，等于开放代理——任何人都能 POST 到 `/api/importer` 让 Cloudflare 的服务器去请求任意地址。这类风险是功能组合出来的，不在单个需求点里，得主动想。

### 测试技巧

需要把真实令牌注入浏览器又不想让它出现在对话记录里：让 Playwright 先 `page.goto('file:///…/.env')` 读取，令牌只在浏览器进程内流转，返回值只回传长度。比在 evaluate 参数里明文传安全。

### 遗留

- **线上还不可用**：Function 要 `npx wrangler pages deploy .` 才生效，本轮只提交代码
- 抓取结果的 `media[]`（图片）目前丢弃，卡片只用正文
- 单列（<980）下背景缩略图网格 `repeat(5,1fr)` 铺满时偏大
