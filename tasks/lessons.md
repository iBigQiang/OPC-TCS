# 教训库

从用户修正与实际踩坑中沉淀的规则，避免重复犯错。开新会话前先过一遍。

---

## 给要被光栅化的 DOM 加 `<img>`，空状态也必须有合法 src

**踩坑**（2026-08-23，卡片配图）：往卡片里加了 `<img id="tc-media">`，无图时不设 `src`。html-to-image 遇到没有 `src` 的 `<img>` 直接抛错，**三条导出管线全挂**。而当次验证恰好带了图片参数，没暴露；隔了一轮才发现。

**规则**：卡片（或任何会被 `html-to-image` / `toDataURL` 处理的容器）里的 `<img>`，`src` 要始终合法——空状态用 1×1 透明 GIF 占位，元素本身用 `hidden` 控制显隐。**验证时必须同时覆盖"有内容"和"空状态"两条路径**，只测有内容的那条会漏掉这类问题。

---

## transform 缩放链路上的尺寸计算，要问清楚"这是布局值还是视觉值"

**踩坑**（2026-08-23，卡片填不满安全区）：`fitScale` 让「卡片**布局**高度 = 安全区高度」，但最终 transform 是 `fitScale × cardScale`，还要再乘一次 95%，所以视觉高度只有安全区的 95%，底部白空一截。

**规则**：涉及 `transform: scale()` 的尺寸计算，先确认每个量在哪个坐标系：`offsetHeight` / `clientHeight` 是**布局值**（不受 transform 影响），`getBoundingClientRect()` 是**视觉值**（受影响）。要让"缩放后的结果"满足某个约束，得把约束先折算回布局坐标系（除以后续所有缩放系数）。

同一次还踩了几何：容器是「中心 + 偏移」定位时，可用高度不是区域总高，而是 `2 × min(中心到上边界, 中心到下边界)`——中心稍偏就会从另一头溢出。

---

## 需求描述的问题，先核对它是否真实存在

**踩坑**（2026-08-23，入库密码）：需求要加管理密码，理由是「将来大量用户使用，推文库会被低质量数据污染」。但推文库存在每个访客自己浏览器的 localStorage，A 抓的推文根本进不了 B 的库，也进不了服务器上的 `posts.json`——**这个污染路径不存在**。

如果闷头做，会交付一个解决不存在问题的功能，还让人误以为数据被保护了。

**规则**：需求里带着「因为 X 所以要做 Y」的因果时，先验证 X 是否成立。不成立就说清楚，再给一个针对真实需求的方案（本例：密码作流程门槛 + 补「导出 JSON」作真正的沉淀路径）。

同类：**需求说「缺少某字段，需要加上」时，先抽样看真实数据**。本例 `posts.json` 836 条早就全带 `metrics` 和 `datetime`，真正的 bug 在渲染层用随机值覆盖了真实值——省掉一次无谓的数据迁移。

---

## 跨域图片进 canvas，先验证再写渲染代码

**规则**（2026-08-23，图片入卡）：要把外部图片放进会被 `html-to-image` / `toDataURL()` 光栅化的 DOM 里，动手前先实测能否避免 canvas 污染：

```js
const im = new Image();
im.crossOrigin = 'anonymous';
im.onload = () => {
  const c = document.createElement('canvas');
  c.width = im.naturalWidth; c.height = im.naturalHeight;
  c.getContext('2d').drawImage(im, 0, 0);
  try { c.toDataURL(); console.log('未污染'); } catch (e) { console.log('污染', e.name); }
};
im.src = url;
```

能出结果说明服务端回了 CORS 头，可以直接用 URL（推文库只存 URL，体积小）。抛 `SecurityError` 就必须走服务端代理转 dataURL，方案完全不同。等到导出阶段才发现就得推翻重来。

配套：**导出前要 `await` 图片加载完成**，没加载完光栅化会得到空白图。

---

## wrangler pages deploy 不看 .gitignore

**踩坑**（2026-08-23，部署在线抓取）：`wrangler pages deploy .` 上传的是**文件系统内容**，`.gitignore` 对它完全无效。本项目 `docs/feedgrab-x/` 被 gitignore（含两个 token 和 X 登录态 cookie），但直接部署会把它们传成公网可访问的静态文件。

**规则**：部署前先导出干净副本：

```bash
rm -rf .deploy-tmp && mkdir .deploy-tmp
git archive HEAD | tar -x -C .deploy-tmp
npx wrangler pages deploy .deploy-tmp --project-name=<name> --branch=main
rm -rf .deploy-tmp
```

`git archive HEAD` 只导出已提交内容，gitignore 排除的天然不在其中，`functions/` 会被正常包含。

**部署后必须验证敏感路径**。注意别被 SPA 兜底骗了——配了兜底的站点对任意路径都返回 200 + index.html。判断方法是比内容哈希：

```bash
curl -s "$BASE/path/to/.env" | md5sum
curl -s "$BASE/" | md5sum        # 两者相同 = 是兜底页，文件不存在
```

---

## 接第三方 API 前，先测 CORS 预检

**踩坑**（2026-08-23，在线抓取）：需求设想是浏览器直接持令牌调 `importer-x.hitu.me`。动手前花两条 curl 验证，发现 `OPTIONS` 返回 405 且无任何 `Access-Control-Allow-*` 头——浏览器根本连不上。如果先写完前端再联调，整个方案要推倒重来。

**规则**：接任何外部 API 之前，先跑这两条：

```bash
curl -sI <api>                       # 看响应头有没有 access-control-*
curl -s -i -X OPTIONS <api> -H "Origin: https://your-site" \
  -H "Access-Control-Request-Method: POST" \
  -H "Access-Control-Request-Headers: content-type,authorization"
```

预检不通过就必须有服务端中转，这是架构决策，越早知道越好。另外**留意接口文档里的设计意图声明**——本例文档写着「前端页面不直接持有 token」，这句话本身就预示了没有 CORS 头。

---

## 「可配置的转发地址」= 开放代理，必须白名单

**规则**（2026-08-23）：只要同时具备「服务端代为发请求」和「目标地址由前端传入」这两个特性，就是 SSRF 漏洞——任何人都能借你的服务器出口去打任意地址（包括内网）。必须在服务端强制校验：协议白名单 + host 白名单，拒绝其余。

这类风险是功能组合出来的，不在任何单个需求点里，需求方也不会提，得自己主动想。

---

## 往浏览器注入密钥又不想留痕

**技巧**（2026-08-23）：测试需要把真实令牌写进页面 localStorage，但不想让它出现在对话记录/日志里。让 Playwright 先导航到 `file:///…/.env` 读取，令牌只在浏览器进程内流转，返回值只回传长度：

```js
await page.goto('file:///D:/path/to/.env');
const token = await page.evaluate(() => (document.body.textContent.match(/KEY\s*=\s*['"]?([^'"\r\n]+)/) || [])[1]);
await page.goto('http://127.0.0.1:8799/');
await page.evaluate(t => localStorage.setItem('k', t), token);
return { 令牌读到: token.length > 0 };   // 只回传长度，不回传值
```

注意 Playwright 的代码沙箱里没有 `require`，动态 `import()` 也不可用，读不了文件系统——`file://` 导航是可行的替代。

---

## 枚举值从 2 个扩到 3 个，先 grep 出所有基于它的分支

**踩坑**（2026-08-23，「选择内容」三 Tab）：`state.tab` 原本只有 `library`/`custom`，全项目有 5 处 `state.tab === "custom" ? A : B` 的三元判断。加第三个值 `fetch` 时我假设「新值天然落到 else 分支就对了」，结果 else 分支只认 `state.selected`——而带 `?text=` 参数进来时它是 null，切到新 tab 卡片正文整个变空。

**规则**：给枚举加值时，`grep` 出所有基于该枚举的判断逐个过一遍，明确新值在每处该走哪边。重复出现的判断抽成命名函数（本次抽了 `fromLibrary()` / `currentText()`），以后再加值只改一处。

---

## 删变量前先 grep 整个文件

**踩坑**（2026-08-23）：删 `renderCard()` 里的 `const isCustom` 时，只检查了它在函数开头几行的用法，漏了 60 行之外 `source-link` 那处，浏览器直接 `ReferenceError`。

**规则**：删除或重命名变量前，对整个文件 grep 该名字，别凭「我记得只在这几行用过」。本项目无构建、无类型检查、无 lint，这类错误只能在浏览器运行时暴露。

---

## 静态资源改完，验证前先禁浏览器缓存

**踩坑**（2026-08-23，三栏布局改造）：改完 `styles.css` 后用 Playwright 实测，`gridTemplateColumns` 仍返回旧的两栏值，一度怀疑 CSS 编辑没生效、去翻文件和选择器优先级。实际是浏览器缓存——`curl` 拿到的是新内容，浏览器里的 `document.styleSheets` 是旧的。

**规则**：本项目是纯静态零构建，`python -m http.server` 不发 `Cache-Control`，浏览器会启发式缓存 CSS/JS。改完样式或脚本后，验证前先执行：

```js
const client = await page.context().newCDPSession(page);
await client.send('Network.enable');
await client.send('Network.clearBrowserCache');
await client.send('Network.setCacheDisabled', { cacheDisabled: true });
await page.reload({ waitUntil: 'networkidle' });
```

注意 `setCacheDisabled` 单独用不够，要先 `clearBrowserCache`。

**排查顺序**：怀疑改动没生效时，先 `curl` 服务端确认文件内容 → 再查浏览器里的 `document.styleSheets` → 最后才怀疑选择器。别一上来就改代码。

---

## 算布局宽度要扣滚动条

**踩坑**（2026-08-23）：规划三栏时按视口 1440 算中列 = 1440 − 48(padding) − 800(两侧栏) − 40(gap) = 552，承诺 stage 缩放 97.8%。实测中列 537、缩放 94.6%。

**规则**：视口宽 ≠ 可用宽。桌面端要扣约 15px 滚动条。给用户承诺具体数值前，要么实测，要么在算式里留出这 15px 并说明是估算。

---

## 长文本测试别走 URL 参数

**踩坑**（2026-08-23）：用 `location.href = '/?text=' + encodeURIComponent(560字中文)` 测长文分档，Playwright 在 tabs 列表、Page URL、Page Title 三处回显了完整的超长编码 URL，严重污染上下文。

**规则**：需要长文本的测试，改用页面内直接赋值（`state.customText = ...; renderCard()`）或先导航到短 URL 再用 evaluate 注入。URL 参数只用短值验证解析链路本身。

---

## 中文文档文件当心编码

**踩坑**（2026-08-23 发现）：`llms.txt` 在某次改动中从 UTF-8 变成了 GBK 并被提交推送。它是给 AI Agent 读的对外文档，GBK 会让绝大多数消费方读成乱码。

**规则**：Windows 环境下用工具改中文文本文件后，验证编码没被改成系统默认的 GBK：

```bash
python -c "open('llms.txt','rb').read().decode('utf-8')"
```

本项目除 `llms.txt` 外，`index.html` / `app.js` / `styles.css` / `CLAUDE.md` 都是 UTF-8 + CRLF。

---

## 预览与导出的视觉效果要用同一套数学

**规则**（2026-08-23，背景压暗）：本项目预览走 DOM/CSS、导出走 canvas，是两条独立管线。任何影响视觉的新效果，两侧的合成方式必须数学等价：

- ✅ CSS `opacity` 叠黑层 ↔ canvas `fillRect(rgba(0,0,0,a))` —— 都是 source-over 混合
- ❌ CSS `filter: brightness()` ↔ canvas `fillRect` —— 前者是乘法，后者是 alpha 混合，结果对不上

选错了后期很难对齐。实现后用像素比对验证（取同一坐标，误差应为 0）。

---

## renderCard() 里 className 是整体赋值

**规则**：`app.js` 的 `renderCard()` 中 `body.className = "tc-body " + ...` 会清空 `#tc-body` 的 class 列表。任何以「加 class」形式实现的样式覆盖都会被下次渲染抹掉。要持久化的样式走 inline style 或 CSS 变量（`className` 赋值不影响 `style` 属性）。
