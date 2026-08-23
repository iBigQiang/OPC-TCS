# 教训库

从用户修正与实际踩坑中沉淀的规则，避免重复犯错。开新会话前先过一遍。

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
