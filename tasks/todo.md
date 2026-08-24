# 当前迭代：抓取增强（入库门禁 / 真实互动数据 / 图片入卡）—— 已完成

**方案文档**：[抓取增强方案](../docs/开发及迭代方案调研报告/2026-08-23-抓取增强方案.md)
**关联调研**：[CORS 方案调研](../docs/开发及迭代方案调研报告/2026-08-23-CORS方案调研.md)

## 检查项

### 1. CORS 调研（只出文档）
- [x] 读 feedgrab-x 源码确认框架与现状（FastAPI，无 CORS 中间件）
- [x] 写调研文档：技术可行但不建议，中转层保留

### 2. 入库门禁
- [x] Function 加 `X-Admin-Password` 校验，响应注入 `_canSave` / `_adminRequired`
- [x] 设置区加「管理入库密码」，存进 `tcs-importer`
- [x] 前端按 `_canSave` 分流（入库 / 仅上卡）
- [x] 保存后自动收起设置面板
- [x] 补「导出推文库 JSON」按钮

### 3. 真实互动数据
- [x] `hasRealMetrics()` / `applyMetricsFor()`
- [x] `state.metricsIsReal` 标记
- [x] 「换一组数据」语义改为主动切随机

### 4. 图片入卡
- [x] `mapImportedPost()` 取主推文 images/videos，正文清 t.co
- [x] `post.media = { image, video }`，`normalizePosts()` 保留该字段
- [x] `#tc-media` + `crossorigin="anonymous"` + X 原生样式
- [x] `mediaReady()`，导出与 embed 前等待图片
- [x] `measureFitScale()` 双基准（有图按安全区）
- [x] 图片加载后重测 fitScale
- [x] 右栏「推文配图」开关，仅有图时显示
- [x] URL 参数 `img` / `media=off`（三处同步）

### 5. 文档
- [x] CLAUDE.md：真实数据优先、配图三要点、fitScale 双基准
- [x] README / llms.txt：新参数与推文库格式
- [x] 界面上的推文库格式说明补 datetime / media

### 6. 验证
- [x] Function 门禁两条路径
- [x] 真实数据 / 换一组数据
- [x] 设置面板收起与展开
- [x] 密码错误不入库、密码正确入库
- [x] 正文 t.co 清除、配图显示
- [x] 安全区约束（上下各余 11px / 10px）
- [x] 带图导出三条管线全部 `err=null`
- [x] 控制台 0 error
- [x] 更新 DEVLOG

## 复盘

### 澄清比实现更重要的一次

需求说「防止推文库被低质量数据污染」，但推文库在 localStorage，每个访客各自独立，这个污染路径根本不存在。如果不先核对就直接做密码，会交付一个解决了不存在问题的功能，还让人误以为数据安全了。

先说清事实、再给「密码作流程门槛 + 导出 JSON 作真正沉淀路径」的组合，才是对需求的正确回应。

### 需求里说「已经缺的」东西可能早就有

「需要修改推文库数据文件格式，让他带上互动数据和发布时间字段」——实测 `posts.json` 836 条全部已有 `metrics` 和 `datetime`。真正的问题在渲染层用随机值覆盖了真实值。

**动手改数据格式前先抽样看真实数据**，省掉一次无谓的迁移。

### 跨域图片进 canvas 的前置验证

`crossorigin="anonymous"` + 服务端回 CORS 头 = canvas 不被污染。这个必须在写渲染代码前实测，否则等到导出阶段才发现 `SecurityError`，图片方案要整个推翻（退化成经 Function 代理转 dataURL）。

验证方法：加载图片 → `drawImage` → `toDataURL()`，能出结果就是没污染。

### 遗留

- ~~线上要配 `IMPORT_ADMIN_PASSWORD`~~ 已配（Secret，生产环境），部署 `045e0215` 后生效
- 抓取后切到「自由编辑」时卡片日期显示今天而非原推文日期（上一轮记录的瑕疵，仍未修）
- 视频只存 URL 不播放，卡片用封面图
- 单列（<980）下背景缩略图网格铺满时偏大
