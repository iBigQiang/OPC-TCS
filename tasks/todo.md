# 当前迭代：背景图库扩容 + 网格改造 —— 已完成

**方案文档**：[背景图库扩容方案](../docs/开发及迭代方案调研报告/2026-08-24-背景图库扩容方案.md)

目标：背景库 34 项 → 152 项，全部按 `bj_n-` 编号；缩略图加名称浮动条；网格改折叠展开 + 关键词搜索。

## 检查项

### 1. 素材入库
- [x] `scripts/fetch_backgrounds.py`：下载源站 118 张 + 压缩 + 按编号命名（幂等）
- [x] `photo-ibigqiang.png` → `bj_1-ibigqiang.jpg`（PNG 转 JPG，删源 PNG）
- [x] 现有 23 张 `photo-*.jpg` → `bj_2..24-*.jpg`（`git mv`，不重编码）
- [x] 删除 `photo-wuyanzu.jpg`
- [x] 确认所有图未被 `.gitignore` 的 `bg_*.jpg` 误伤（前缀是 `bj_`）

### 2. manifest 与生成脚本
- [x] `gen_backgrounds.py` 的 `PHOTOS` 改三元组（文件名 / 中文名带序号 / 关键词）
- [x] 110 条 travel 用列表推导生成，关键词写「旅行 素材」
- [x] 渐变 SVG 加 `bj_143..152-` 前缀，名称带序号
- [x] manifest 输出 `file` / `name` / `keywords` 三字段
- [x] 重跑脚本，确认报 152 backgrounds 且中文不乱码

### 3. app.js
- [x] 拆耦合：设默认背景从 `renderBackgroundGrid()` 移到 `init()`
- [x] 拆耦合：`setBg()` 的 `active` 改由 `state.bg` 驱动
- [x] state 加 `bgQuery` / `bgVisible` / `customBgs`，常量 `BG_INITIAL` / `BG_PAGE`
- [x] `filteredBackgrounds()` 按 name + keywords 过滤
- [x] `renderBackgroundGrid()` 重写：自定义图 → 过滤结果前 N 张 → 计数 → 更多按钮
- [x] 缩略图加 `<span class="bg-name">` 与 `loading="lazy" decoding="async"`
- [x] `addCustomThumb()` 改走 `state.customBgs`
- [x] `resolveBgParam()` 加剥前缀的宽松匹配（救旧链接）
- [x] 追加：选中项落在折叠区外时自动展开到覆盖它那一页（验证时发现的缺陷）

### 4. index.html / styles.css
- [x] 背景区插搜索框 + 计数行 + 「查看更多背景」按钮
- [x] `.bg-name` 底部浮动条样式
- [x] 「查看更多」沿用 `ghost-btn` 盒模型，不引入新按钮高度

### 5. 文档
- [x] `llms.txt` 两处 slug 示例 + `bg` 参数说明（验 UTF-8 编码）
- [x] `CLAUDE.md` 背景库一节：编号规则、keywords、`bj_`/`bg_` 陷阱
- [x] `README.md` 背景数量
- [x] `docs/DEVLOG.md` 顶部加本轮条目
- [x] `tasks/lessons.md` 补教训（4 条）

### 6. 验证
- [x] 首屏 40 张 / 点 6 次到 152 / 按钮消失
- [x] 搜索命中正确、计数同步、折叠重置、清空恢复
- [x] 默认背景是 `bj_1-ibigqiang.jpg`
- [x] 选图 → 搜索 → 清空，选中态不丢
- [x] 上传自定义背景 → 搜索后仍在且仍选中
- [x] 旧 slug `?bg=photo-forest-path` 与新 slug 都能出图
- [x] 三条导出管线 `err=null`，控制台 0 error
- [x] `manifest.json` 浏览器侧读取中文不乱码

### 7. `/code-review high` 两轴审查后的加固
- [x] 自定义图与内置图共用格子预算 + `bg-count` 分子分母含它（两轴独立发现，需求「5×8」被破坏）
- [x] `bgThumb()` 去 `innerHTML`，改逐个 `createElement` + `textContent`
- [x] placeholder 换成实测有命中的词（原「山海」零命中）
- [x] `fetch_one()` 改 `.part` + `os.replace` 原子写入，兑现 docstring 的幂等承诺
- [x] `SVG_BASE` 改从 `PHOTOS` 派生 + `check_numbers()` 编号断言（实测能拦住撞号）
- [x] 消掉 `addCustomThumb()` 的两步空转与 `applyUrlParams()` 的 `setBg()` 内联复制
- [x] `fetch_backgrounds.py` docstring 如实改写（原来把「职责不重叠」说过头了）
- [x] `.sg-label` 不对称 padding 补注释（先编了个字形理由，实测不成立后改成如实记录）
- [x] `.gitignore` 加 `__pycache__/`
- [x] 复验：脚本报 152、断言生效、首屏 40 格、加自定义仍 120/153、三条管线 `err=null`、0 console error

## 复盘

### 结果

背景库 34 → 152 项（142 张照片 + 10 个渐变 SVG），`backgrounds/` 22.7 MB。新增 118 张下载 17.9 MB，0 失败 0 跳过。前端首屏 40 张、每次 +20、关键词搜索、名称浮动条全部按方案落地，8 项浏览器验证全通过，控制台 0 error 0 warning。

### 判断对了的地方

**两个脚本严格分职责**。`fetch_backgrounds.py` 只管「源 slug → 目标文件名」，中文名与关键词只写在 `gen_backgrounds.py`。两边不重叠，就不存在「改了一份忘了另一份」的漂移风险——项目里 `cleanApiText()` / `clean_text()` 那对双胞胎就是反例，CLAUDE.md 至今得专门写一句「改一个必须改另一个」。

**关键词刻意收窄**。110 张 travel 只写「旅行 素材」，没照搬源站那串七个词。实测搜「城市」命中 9 张全是城市类；照搬的话会命中 119 张，搜索功能等于白做。

**先拆耦合再加功能**。改造前专门通读了 `renderBackgroundGrid()` 和 `setBg()`，把两个依赖「只渲染一次」的隐藏假设先移走。这两处都不会报错，只会静默功能退化，如果边加功能边发现，排查成本会高得多。

### 走过的弯路

**`numbered()` 的正则连栽两次**。第一版把整个表达式塞进 f-string：raw string 里的 `\\d` 是字面反斜杠+d（匹配不到），f-string 里含反斜杠在 3.12 前还是语法错误。提到模块级 `NUM_RE` 编译一次就干净了——顺带说明「一行写完」不等于更好。

**体积估算给早了**。规划时口头说「压缩后 8–12 MB」，实测 17.9 MB。原因是源图已经压得很紧。教训写进 lessons：给具体数字前先跑样本，别凭直觉。

**统计口径把自己骗了一次**。用 PowerShell `-like '??*'` 统计未跟踪文件，`?` 是通配符，匹配了所有行，一度以为 23 次 `git mv` 没被识别。

### 决策变更

方案里定的是「直接重命名，不管旧链接」，理由是不想维护 23 条映射表。实施时发现 `resolveBgParam()` 加一行剥前缀的正则就能全部覆盖，成本远低于映射表，所以顺手做掉了。五种写法（旧 slug / 新 slug / 带扩展名 / 中文名 / 旧 SVG slug）实测全部命中。

### 遗留

- 源站 118 张多为 960×1280，用于 `tall`(1080×1920) 导出要放大 1.5 倍。背景压暗 10% 且大半被卡片盖住，可接受，但这批图本身不是为 9:16 准备的。将来若要更清晰只能换源，不能靠重新压缩。
- 110 张 travel 沿用批量名「旅行素材 NNN」，搜索上不可细分。若以后要按内容检索，需要逐张打标（可考虑视觉模型批量生成关键词）。
