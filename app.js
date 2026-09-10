/* Ray OPC 推文切片工场 —— 无框架单页应用 */

// 后台标签页里 rAF 被冻结，会卡死 html-to-image 导出和卡片测量；隐藏时退化为 setTimeout
const _raf = window.requestAnimationFrame.bind(window);
window.requestAnimationFrame = (cb) =>
  document.hidden ? setTimeout(() => cb(performance.now()), 32) : _raf(cb);

const $ = (id) => document.getElementById(id);

const DEFAULT_PROFILE = { name: "你的名字", handle: "UserName_ID", avatar: "OPC-TCS_logo.png", verified: true, badge: "blue" };

/* 卡片默认落点（px，相对画框中心）。双击复位、state 初值、buildShareUrl()
   的「是否写进链接」判断共用这两个常量，散成三处硬编码迟早对不上。 */
const DEFAULT_CARD_X = -20;
const DEFAULT_CARD_Y = -37;

/* 背景网格的折叠节奏：首屏 5 列 × 8 行，之后每次多展开 4 行。
   和 DEFAULT_CARD_* 同理必须定义在 state 之前——state 初值引用它，写在后面会命中 TDZ。 */
const BG_INITIAL = 40;
const BG_PAGE = 20;

const state = {
  profile: { ...DEFAULT_PROFILE },
  posts: [],
  filtered: [],
  selected: null,        // 当前上卡的推文对象
  customText: "",
  customSeed: "",        // 上次带入编辑框的推文原文，用来判断用户改没改过
  customDate: "",        // 编辑框内容的日期，空则用今天
  customDateEdited: false, // 手选或链接指定的日期，切换标签时也要保留
  tab: "library",        // library | fetch | custom
  mode: "poster",        // poster | tall | card
  cardRatio: "auto",
  theme: "light",        // light | dark
  metricsOn: true,
  metricsIsReal: false,  // 当前展示的互动数据是推文自带的真实值还是随机生成的
  mediaOn: true,         // 是否在卡片上展示推文配图
  mediaUrl: "",          // 当前卡片的配图（URL 参数 img 也写这里）
  // 默认落在抖音安全区中央：右侧 140px / 底部 300px / 顶部 150px / 左侧 60px（画布px，预览折半）
  cardScale: 95,         // 用户设置的缩放（%），在 fitScale 基础上叠加
  fitScale: 1,           // 长文自动适配画框的缩放
  cardX: DEFAULT_CARD_X, // 拖动偏移（px，相对画框中心）
  cardY: DEFAULT_CARD_Y,
  cardDragged: false,    // 用户是否手动定过位；定过就不再自动往安全区中心贴
  fitOffsetY: 0,         // 为贴合安全区中心做的补偿（3:4 与 9:16 的安全区中心不一样高）
  cardOpacity: 90,
  bodySize: 17,          // 正文基准字号（px），size-xs/s/m 四档在此基础上按倍率缩
  bgDim: 10,             // 背景压暗（%），0 = 不压暗；card 模式无背景故不生效
  guidesOn: true,        // 抖音安全区参考线（仅预览，不进导出）
  search: "",
  chip: { kind: "all", v: "" },
  month: "",
  sort: "new",           // new | hot | saved
  bg: null,              // 当前背景的 URL / dataURL
  fakeMetrics: null,     // 卡片上显示的随机互动数据
  dateOverride: "",      // URL 参数指定的日期
  backgrounds: [],       // manifest 内容，供 bg 参数解析
  bgQuery: "",           // 背景搜索词，匹配 name + keywords
  bgVisible: BG_INITIAL, // 内置背景当前展开到第几张
  customBgs: [],         // 用户上传/贴 URL 的背景（dataURL）；不参与搜索与折叠计数
};

const LIST_CAP = 200;
/* 1×1 透明 GIF：卡片配图的占位。html-to-image 遇到没有 src 的 <img> 会直接抛错，
   所以 #tc-media 的 src 必须始终合法，无图时用它顶着（元素本身仍是 hidden）。 */
const BLANK_PNG = "data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==";

/* ---------- 工具 ---------- */

function fmtNum(n) {
  if (n == null) return "0";
  if (n >= 10000) return (n / 10000).toFixed(n >= 100000 ? 0 : 1).replace(/\.0$/, "") + "万";
  if (n >= 1000) return n.toLocaleString("en-US");
  return String(n);
}

function fmtDate(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${m}月${d}日`;
}

function todayISO() {
  const t = new Date();
  return `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, "0")}-${String(t.getDate()).padStart(2, "0")}`;
}

function isISODate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || Number(value.slice(0, 4)) < 1) return false;
  const date = new Date(value + "T00:00:00Z");
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/* ---------- 账号信息（profile.json 默认值 + localStorage 本机覆盖） ---------- */

const PROFILE_KEY = "tcs-profile";
const POSTS_KEY = "tcs-posts";
const IMPORTER_KEY = "tcs-importer";

async function loadProfile(useLocalOverride = true) {
  try {
    const base = await fetch("profile.json").then((r) => (r.ok ? r.json() : {}));
    Object.assign(state.profile, base);
  } catch { /* 没有 profile.json 就用内置默认 */ }
  if (useLocalOverride) {
    try {
      Object.assign(state.profile, JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}"));
    } catch { /* 本机覆盖损坏则忽略 */ }
  }
  applyProfile();
}

function saveProfileOverride(patch) {
  Object.assign(state.profile, patch);
  try {
    const saved = JSON.parse(localStorage.getItem(PROFILE_KEY) || "{}");
    localStorage.setItem(PROFILE_KEY, JSON.stringify(Object.assign(saved, patch)));
  } catch (e) {
    alert("保存到本机失败（可能是头像图片太大）：" + e.message);
  }
  applyProfile();
}

function applyProfile() {
  const p = state.profile;
  const avatarSrc = p.avatarData || p.avatar || DEFAULT_PROFILE.avatar;
  $("tc-avatar").src = avatarSrc;
  const brandAvatar = $("brand-avatar");
  if (brandAvatar) brandAvatar.src = avatarSrc;
  $("profile-avatar-preview").src = avatarSrc;
  $("tc-name-text").textContent = p.name;
  $("tc-handle-text").textContent = "@" + p.handle;
  const badge = p.verified ? (p.badge === "gold" ? "gold" : "blue") : "none";
  $("tc-badge").style.display = badge === "blue" ? "" : "none";
  $("tc-badge-gold").style.display = badge === "gold" ? "" : "none";
  const brandEyebrow = $("brand-eyebrow");
  if (brandEyebrow) brandEyebrow.textContent = `${p.name} · @${p.handle}`.toUpperCase();
  $("profile-name").value = p.name;
  $("profile-handle").value = p.handle;
  $("badge-on").classList.toggle("active", badge === "blue");
  $("badge-gold").classList.toggle("active", badge === "gold");
  $("badge-off").classList.toggle("active", badge === "none");
}

/* 导入的推文库：字段宽容，缺什么补什么 */
function normalizePosts(arr) {
  return arr
    .filter((p) => p && typeof p.text === "string" && p.text.trim())
    .map((p, i) => {
      const out = {
        id: String(p.id || i + 1),
        date: p.date || todayISO(),
        datetime: p.datetime || p.date || "",
        text: p.text,
        long: !!p.long,
        sourceUrl: p.sourceUrl || "",
        topic: p.topic || "未分类",
        metrics: normalizeMetrics(p.metrics),
        metricsAvailable: p.metricsAvailable ?? !!p.metrics,
      };
      // media 可选：只有真带图才留字段，避免给每条都塞一个空对象
      if (p.media && (p.media.image || p.media.video)) {
        out.media = { image: p.media.image || "", video: p.media.video || "" };
      }
      return out;
    })
    .sort((a, b) => (a.date < b.date ? 1 : -1));
}

/* ---------- 素材库 ---------- */

function applyFilter() {
  const q = state.search.trim().toLowerCase();
  let list = state.posts;
  if (state.chip.kind === "topic") list = list.filter((p) => p.topic === state.chip.v);
  else if (state.chip.kind === "tag") list = list.filter((p) => (p.tags || []).includes(state.chip.v));
  if (state.month) list = list.filter((p) => p.date.startsWith(state.month));
  if (q) list = list.filter((p) => p.text.toLowerCase().includes(q));
  if (state.sort === "hot") list = [...list].sort((a, b) => b.metrics.likes - a.metrics.likes);
  else if (state.sort === "saved") list = [...list].sort((a, b) => b.metrics.bookmarks - a.metrics.bookmarks);
  state.filtered = list;
  renderList();
}

/* 客观特征标签：从数据确定性推导，任何账号都适用。
   爆款/高收藏按库内分位数（前 10%），样本 ≥20 条才启用。 */
const TAG_DEFS = [
  ["爆款", (p, ctx) => ctx.likesP90 > 0 && p.metrics.likes >= ctx.likesP90],
  ["高收藏", (p, ctx) => ctx.bmP90 > 0 && p.metrics.bookmarks >= ctx.bmP90],
  ["长推", (p) => p.text.length > 300],
  ["清单体", (p) => /(^|\n)\s*(?:[1１][、.．)）]|1\uFE0F?\u20E3)/.test(p.text)],
  ["提问式", (p) => /[？?]/.test(p.text.split("\n")[0]) || /[？?]\s*$/.test(p.text)],
  ["金句", (p) => p.text.length <= 60],
];

function computeTags() {
  const withLikes = state.posts.filter((p) => p.metrics && p.metrics.likes > 0);
  const pct = (values, q) => { const s = [...values].sort((a, b) => a - b); return s[Math.floor(s.length * q)]; };
  const ctx = {
    likesP90: withLikes.length >= 20 ? pct(withLikes.map((p) => p.metrics.likes), 0.9) : 0,
    bmP90: withLikes.length >= 20 ? pct(withLikes.map((p) => p.metrics.bookmarks), 0.9) : 0,
  };
  state.posts.forEach((p) => {
    p.tags = TAG_DEFS.filter(([, match]) => match(p, ctx)).map(([name]) => name);
  });
}

function renderChips() {
  const wrap = $("topic-chips");
  wrap.innerHTML = "";
  const mk = (label, count, active, onclick) => {
    const b = document.createElement("button");
    b.className = "chip" + (active ? " active" : "");
    b.innerHTML = `${label}<em>${count}</em>`;
    b.onclick = onclick;
    wrap.appendChild(b);
  };
  const pick = (kind, v) => () => { state.chip = { kind, v }; renderChips(); applyFilter(); };
  mk("全部", state.posts.length, state.chip.kind === "all", pick("all", ""));
  const topicCounts = {};
  state.posts.forEach((p) => { if (p.topic && p.topic !== "未分类") topicCounts[p.topic] = (topicCounts[p.topic] || 0) + 1; });
  Object.entries(topicCounts).forEach(([t, n]) => mk(t, n, state.chip.kind === "topic" && state.chip.v === t, pick("topic", t)));
  const tagCounts = {};
  state.posts.forEach((p) => (p.tags || []).forEach((t) => { tagCounts[t] = (tagCounts[t] || 0) + 1; }));
  TAG_DEFS.forEach(([name]) => { if (tagCounts[name]) mk(name, tagCounts[name], state.chip.kind === "tag" && state.chip.v === name, pick("tag", name)); });
}

function renderMonthOptions() {
  const sel = $("month-filter");
  const months = [...new Set(state.posts.map((p) => p.date.slice(0, 7)))].sort().reverse();
  sel.innerHTML = '<option value="">全部时间</option>' +
    months.map((m) => `<option value="${m}">${Number(m.slice(0, 4))}年${Number(m.slice(5))}月</option>`).join("");
  sel.value = months.includes(state.month) ? state.month : "";
  state.month = sel.value;
}

function refreshLibrary() {
  computeTags();
  renderChips();
  renderMonthOptions();
  applyFilter();
}

function renderList() {
  const ul = $("post-list");
  ul.innerHTML = "";
  state.filtered.slice(0, LIST_CAP).forEach((p) => {
    const li = document.createElement("li");
    li.className = "post-item" + (state.selected && state.selected.id === p.id ? " active" : "");
    const label = p.topic && p.topic !== "未分类" ? p.topic : ((p.tags && p.tags[0]) || "");
    li.innerHTML = `
      <div class="pi-meta"><span>${p.date}${label ? " · " + label : ""}</span><span>点赞 ${fmtNum(p.metrics.likes)}</span></div>
      <div class="pi-text"></div>`;
    li.querySelector(".pi-text").textContent = p.text;
    li.onclick = () => selectPost(p);
    ul.appendChild(li);
  });
  if (state.filtered.length > LIST_CAP) {
    const li = document.createElement("li");
    li.className = "list-more";
    li.textContent = `共 ${state.filtered.length} 条，仅显示前 ${LIST_CAP} 条，继续用关键词缩小范围`;
    ul.appendChild(li);
  }
  $("lib-count").textContent = `· ${state.filtered.length}/${state.posts.length} 条`;
}

/* 随机但好看的互动数据：浏览量对数均匀分布，其余按真实比例区间派生。
   只在推文没带真实数据时兜底——posts.json 里的条目基本都有真实 metrics。 */
function rollMetrics() {
  const r = (min, max) => min + Math.random() * (max - min);
  const views = Math.round(30000 * Math.pow(25, Math.random()) / 100) * 100; // 3万 ~ 75万
  const likes = Math.round(views * r(0.022, 0.045));
  state.fakeMetrics = {
    views,
    likes,
    bookmarks: Math.round(likes * r(0.55, 1.05)),
    retweets: Math.round(likes * r(0.15, 0.32)),
    replies: Math.round(likes * r(0.05, 0.12)),
    quotes: Math.round(likes * r(0.01, 0.04)),
  };
  state.fakeMetrics.score = metricScore(state.fakeMetrics);
  state.metricsIsReal = false;
}

const METRIC_KEYS = ["likes", "views", "retweets", "replies", "bookmarks", "quotes", "score"];
const METRIC_LABELS = { likes: "点赞", views: "浏览", retweets: "转推", replies: "回复", bookmarks: "收藏", quotes: "引用", score: "权重分" };

/* 只在旧库的读取边界兼容 reposts，新数据和导出统一使用接口原名。 */
function normalizeMetrics(raw = {}) {
  const m = raw || {};
  return Object.fromEntries(METRIC_KEYS.map((key) => {
    const value = Number(key === "retweets" ? m.retweets ?? m.reposts : m[key]);
    return [key, Number.isFinite(value) ? Math.max(0, value) : 0];
  }));
}

/* 与新接口评分公式一致，已有接口 score 直接保留，不重新计算。 */
function metricScore(m) {
  return Math.trunc(m.likes + m.retweets * 2 + m.replies * 3 + m.bookmarks * 4 + m.views / 1000);
}

/* 全零也是有效的接口结果；只有缺少数据时才用随机值。 */
function hasRealMetrics(p) {
  const m = p && p.metrics;
  return !!m && p.metricsAvailable !== false && METRIC_KEYS.some((k) => Object.hasOwn(m, k));
}

/* 有真实数据就用真实的，没有才随机——「换一组数据」按钮可以强制切回随机 */
function applyMetricsFor(p) {
  if (hasRealMetrics(p)) {
    state.fakeMetrics = normalizeMetrics(p.metrics);
    state.metricsIsReal = true;
  } else {
    rollMetrics();
  }
}

function selectPost(p) {
  // 选用新推文时解除旧分享链接的日期覆盖，日期跟随新内容。
  state.dateOverride = "";
  state.selected = p;
  applyMetricsFor(p);
  state.mediaUrl = (p && p.media && p.media.image) || "";
  renderList();
  renderCard();
}

/* 从推文库切到自由编辑时，把选中的那条带进编辑框，省得重敲或再复制一次。
   只在文案与日期都未修改时自动带入——用户改过的东西不能冲掉。
   改过之后想换一条，用「用推文库选中的那条替换」按钮走 force。 */
function primeCustomText(force) {
  if (!state.selected) return;
  if (!force && (state.customDateEdited || (state.customText.trim() && state.customText !== state.customSeed))) return;
  // 配图以链接形式一并带进编辑框：想去掉图片，手动删掉这行链接即可
  const img = (state.selected.media && state.selected.media.image) || "";
  const text = img ? state.selected.text.replace(/\s+$/, "") + "\n" + img : state.selected.text;
  state.customText = text;
  state.customSeed = text;
  state.customDate = state.selected.date || "";   // 日期跟着来源推文走，不用今天
  state.customDateEdited = false;
  state.dateOverride = "";
  $("custom-text").value = state.customText;
}

function randomPost() {
  if (!state.filtered.length) return;
  const p = state.filtered[Math.floor(Math.random() * state.filtered.length)];
  selectPost(p);
  const active = document.querySelector(".post-item.active");
  if (active) active.scrollIntoView({ block: "nearest" });
}

/* ---------- 卡片渲染 ---------- */

const METRIC_ICONS = {
  replies: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M1.751 10c0-4.42 3.584-8 8.005-8h4.366c4.49 0 8.129 3.64 8.129 8.13 0 2.96-1.607 5.68-4.196 7.11l-8.054 4.46v-3.69h-.067c-4.49.1-8.183-3.51-8.183-8.01zm8.005-6c-3.317 0-6.005 2.69-6.005 6 0 3.37 2.77 6.08 6.138 6.01l.351-.01h1.761v2.3l5.087-2.81c1.951-1.08 3.163-3.13 3.163-5.36 0-3.39-2.744-6.13-6.129-6.13H9.756z"/></svg>',
  retweets: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4.5 3.88l4.432 4.14-1.364 1.46L5.5 7.55V16c0 1.1.896 2 2 2H13v2H7.5c-2.209 0-4-1.79-4-4V7.55L1.432 9.48.068 8.02 4.5 3.88zM16.5 6H11V4h5.5c2.209 0 4 1.79 4 4v8.45l2.068-1.93 1.364 1.46-4.432 4.14-4.432-4.14 1.364-1.46 2.068 1.93V8c0-1.1-.896-2-2-2z"/></svg>',
  likes: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M16.697 5.5c-1.222-.06-2.679.51-3.89 2.16l-.805 1.09-.806-1.09C9.984 6.01 8.526 5.44 7.304 5.5c-1.243.07-2.349.78-2.91 1.91-.552 1.12-.633 2.78.479 4.82 1.074 1.97 3.257 4.27 7.129 6.61 3.87-2.34 6.052-4.64 7.126-6.61 1.111-2.04 1.03-3.7.477-4.82-.561-1.13-1.666-1.84-2.908-1.91zm4.187 7.69c-1.351 2.48-4.001 5.12-8.379 7.67l-.503.3-.504-.3c-4.379-2.55-7.029-5.19-8.382-7.67-1.36-2.5-1.41-4.86-.514-6.67.887-1.79 2.647-2.91 4.601-3.01 1.651-.09 3.368.56 4.798 2.01 1.429-1.45 3.146-2.1 4.796-2.01 1.954.1 3.714 1.22 4.601 3.01.896 1.81.846 4.17-.514 6.67z"/></svg>',
  views: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M8.75 21V3h2v18h-2zM18 21V8.5h2V21h-2zM4 21l.004-10h2L6 21H4zm9.248 0v-7h2v7h-2z"/></svg>',
  bookmarks: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 4.5C4 3.12 5.119 2 6.5 2h11C18.881 2 20 3.12 20 4.5v18.44l-8-5.71-8 5.71V4.5zM6.5 4c-.276 0-.5.22-.5.5v14.56l6-4.29 6 4.29V4.5c0-.28-.224-.5-.5-.5h-11z"/></svg>',
};

/* 编辑框里贴的图片直链自动转成卡片配图，并从正文里摘掉——X 上的媒体链接
   本来也不作为文本显示。取最后一个匹配（通常贴在末尾）。 */
const IMG_URL_RE = /https?:\/\/\S+?\.(?:jpg|jpeg|png|webp|gif)(?:[?#]\S*)?(?=\s|$)/gi;

function splitMediaFromText(raw) {
  const found = String(raw || "").match(IMG_URL_RE);
  if (!found || !found.length) return { text: raw || "", image: "" };
  const image = found[found.length - 1];
  const text = String(raw).replace(image, "")
    .split("\n").map((l) => l.replace(/\s+$/, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
  return { text, image };
}

/* 卡片实际要渲染的正文与配图。自由编辑时正文里贴的图链优先，
   否则用推文自带的（抓取来的或 URL 的 img 参数）。 */
function effectiveContent() {
  if (state.tab === "custom") {
    const sp = splitMediaFromText(state.customText);
    if (sp.image) return { text: sp.text, image: sp.image };
    // 内容是从推文带进来的（customSeed 有值），图链就一定在文本里；
    // 现在文本里没有了，说明用户主动删掉了 —— 不要再拿 mediaUrl 把它变回来
    if (state.customSeed) return { text: state.customText, image: "" };
    return { text: state.customText, image: state.mediaUrl };
  }
  return { text: currentText(), image: state.mediaUrl };
}

/* 当前上卡的文案与日期。「在线抓取」tab 还没有自己的内容源，
   所以判断按「有没有选中的推文」而不是按 tab 名——否则从自由编辑切过去卡片会变空。 */
function fromLibrary() {
  return state.tab !== "custom" && !!state.selected;
}
function currentText() {
  return fromLibrary() ? state.selected.text : state.customText;
}
/* 编辑框里的内容是从某条推文带过来的时候，日期要跟着那条推文走。
   卡片是那条推文的样子，用抓取当天的日期就错了。 */
function currentDate() {
  const date = state.dateOverride || (fromLibrary() ? state.selected.date : state.customDate);
  return isISODate(date) ? date : todayISO();
}

/* 正文渲染：链接 / @提及 / #话题 显示为 X 蓝，与真实推文一致 */
function renderBody(text) {
  const esc = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return esc
    .replace(/(?:https?:\/\/)?(?:[\w-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/gi, (m) => `<span class="tc-link">${m}</span>`)
    .replace(/(^|[^\w@/])@([A-Za-z0-9_]{2,15})/g, '$1<span class="tc-link">@$2</span>')
    .replace(/(^|[^&\w])#([\p{L}\p{N}_]+)/gu, '$1<span class="tc-link">#$2</span>');
}

function renderCard() {
  const content = effectiveContent();
  const text = content.text || "写点什么……";
  const date = currentDate();

  const body = $("tc-body");
  body.innerHTML = renderBody(text);
  body.className = "tc-body " + (text.length > 500 ? "size-xs" : text.length > 320 ? "size-s" : text.length > 170 ? "size-m" : "");
  // 走 CSS 变量而非加 class——上一行是 className 整体赋值，任何 class 形式的字号覆盖都会被下次渲染抹掉
  body.style.setProperty("--tc-body-size", state.bodySize + "px");
  $("bodysize-val").textContent = state.bodySize + "px";

  $("tc-date").textContent = fmtDate(date);

  const card = $("tweet-card");
  card.classList.toggle("dark", state.theme === "dark");
  $("scale-val").textContent = state.cardScale + "%";

  // 背景半透明（只透卡片底色，文字不透）
  const alpha = state.cardOpacity / 100;
  card.style.backgroundColor = state.theme === "dark"
    ? `rgba(0, 0, 0, ${alpha})` : `rgba(255, 255, 255, ${alpha})`;
  $("opacity-val").textContent = state.cardOpacity + "%";

  // 背景压暗（预览侧）：与导出侧 composePoster()/exportLive() 的 fillRect 用同一个 alpha
  $("stage-dim").style.opacity = state.bgDim / 100;
  $("dim-val").textContent = state.bgDim + "%";

  const metricsEl = $("tc-metrics");
  const m = state.fakeMetrics;
  if (state.metricsOn && m) {
    metricsEl.classList.remove("hidden");
    metricsEl.innerHTML = ["replies", "retweets", "likes", "views", "bookmarks"]
      .map((k) => `<span data-metric="${k}" title="${METRIC_LABELS[k]}" aria-label="${METRIC_LABELS[k]} ${m[k]}">${METRIC_ICONS[k]}<b>${fmtNum(m[k])}</b></span>`).join("");
  } else {
    metricsEl.classList.add("hidden");
  }

  const link = $("source-link");
  if (fromLibrary() && state.selected.sourceUrl) {
    link.style.display = "";
    link.href = state.selected.sourceUrl;
  } else {
    link.style.display = "none";
  }

  // 推文配图：换图时才重设 src，避免每次渲染都触发重新加载导致闪烁。
  // 无图时回落到透明占位而不是清空 src——空 src 的 <img> 会让 html-to-image 光栅化直接失败
  const mediaEl = $("tc-media");
  const showMedia = !!content.image && state.mediaOn;
  mediaEl.classList.toggle("hidden", !showMedia);
  const wantSrc = showMedia ? content.image : BLANK_PNG;
  if (mediaEl.getAttribute("src") !== wantSrc) mediaEl.src = wantSrc;

  const stage = $("stage");
  const isFrame = state.mode !== "card"; // poster(3:4) 或 tall(9:16)
  stage.classList.toggle("card-only", !isFrame);
  stage.classList.toggle("card-auto", !isFrame && state.cardRatio === "auto");
  stage.classList.toggle("tall", state.mode === "tall" || (!isFrame && state.cardRatio === "9:16"));
  $("card-ratio-option").classList.toggle("hidden", isFrame);
  $("preview-label").textContent = state.mode === "card" ? (state.cardRatio === "auto" ? "纯卡片 · 自适应内容 · 透明背景 PNG" : `纯卡片 · ${state.cardRatio} · 1080×${state.cardRatio === "9:16" ? 1920 : 1440}`)
    : state.mode === "tall" ? "9:16 竖图 · 1080×1920" : "3:4 竖图 · 1080×1440";
  $("drag-hint").style.display = isFrame ? "" : "none";

  // 安全区参考线只在竖图模式且开关打开时显示
  $("safe-guides").classList.toggle("hidden", !isFrame || !state.guidesOn);
  $("safe-hatch").classList.toggle("hidden", !isFrame || !state.guidesOn);
  $("guides-option").classList.toggle("hidden", !isFrame);   // 纯卡片没有画布，参考线无意义
  $("live-btn").style.display = isFrame ? "" : "none";
  $("dim-option").style.display = isFrame ? "" : "none"; // 纯卡片没背景可压

  refreshAgentPrompt();

  // 竖图模式：卡片浮动（整体缩放 + 可拖动）；长文先自动缩到画框内，再叠加用户缩放
  card.classList.toggle("floating", isFrame);
  if (!isFrame) card.style.transform = "";
  if (isFrame) {
    $("tc-content").style.width = "";
    $("tc-content").style.transform = "";
    $("tc-body").style.lineHeight = "";
    $("tc-body").style.fontSize = "";
  }
  requestAnimationFrame(measureFitScale);
}

/* 纯卡片尊重用户字号，通过排版宽度适配比例，再整体等比缩放。 */
function fitPureCard() {
  const stage = $("stage"), card = $("tweet-card"), content = $("tc-content");
  const media = $("tc-media"), body = $("tc-body");
  content.style.width = "";
  content.style.transform = "";
  body.style.fontSize = "";
  body.style.lineHeight = "";
  stage.style.setProperty("--pure-card-height", "auto");
  stage.style.setProperty("--pure-card-scale", state.cardScale / 100);
  const resetMedia = () => {
    media.classList.remove("fit", "crop");
    media.style.maxHeight = "";
    media.style.height = "";
  };
  resetMedia();
  let width = 540 * 0.84;
  stage.style.setProperty("--pure-card-width", width + "px");
  if (state.cardRatio !== "auto") {
    const ratio = state.cardRatio === "9:16" ? 9 / 16 : 3 / 4;
    const measure = (value) => {
      stage.style.setProperty("--pure-card-width", value + "px");
      resetMedia();
      if (!media.classList.contains("hidden")) {
        const other = card.offsetHeight - media.offsetHeight;
        media.classList.add("fit");
        media.style.maxHeight = Math.max(MEDIA_MIN_H, value / ratio - other - 1) + "px";
      }
      return card.offsetHeight - value / ratio;
    };
    if (Math.abs(measure(width)) > 2) {
      let low = 144, high = width;
      while (measure(high) > 0 && high < 8192) high *= 1.5;
      for (let i = 0; i < 18; i++) {
        const mid = (low + high) / 2;
        if (measure(mid) > 0) low = mid; else high = mid;
      }
      width = high;
    }
    measure(width);
    // 换行存在离散变化，只将不足一行的余量分配到行距，不覆盖所选字号。
    const remaining = width / ratio - card.offsetHeight;
    if (remaining > 1) {
      const lineHeight = parseFloat(getComputedStyle(body).lineHeight);
      const lines = Math.max(1, Math.round(body.offsetHeight / lineHeight));
      body.style.lineHeight = lineHeight + remaining / lines + "px";
    }
    stage.style.setProperty("--pure-card-height", width / ratio + "px");
  }
  stage.style.setProperty("--pure-stage-width", Math.max(540, width * state.cardScale / 100) + "px");
  fitStageScale();
  const size = pureCardSize();
  $("preview-label").textContent = "纯卡片 · " + (state.cardRatio === "auto" ? "默认" : state.cardRatio) + " · " + size.width + "×" + size.height;
}

/* 纯卡片的导出像素跟随整体大小；固定比例以整数倍尺寸避免像素舍入改变比例。 */
function pureCardSize() {
  const card = $("tweet-card"), density = 3 * state.cardScale / 100;
  if (state.cardRatio === "auto") return { width: Math.round(card.offsetWidth * density), height: Math.round(card.offsetHeight * density) };
  const [w, h] = state.cardRatio === "9:16" ? [9, 16] : [3, 4];
  const multiple = Math.max(1, Math.round(card.offsetWidth * density / w));
  return { width: multiple * w, height: multiple * h };
}

/* 独立处理纯卡片的缩放与透明通道，避免触及竖图的捕获和合成。 */
async function capturePureCardCanvas() {
  await mediaReady();
  fitPureCard();
  const card = $("tweet-card"), size = pureCardSize();
  const previousZoom = card.style.zoom;
  card.style.zoom = "1";
  try {
    return await htmlToImage.toCanvas(card, {
      pixelRatio: 1, canvasWidth: size.width, canvasHeight: size.height,
    });
  } finally {
    card.style.zoom = previousZoom;
  }
}

/* 安全区上下边界与垂直中心（预览 px）。
   tall 的上边界是 88 不是 75，所以两种模式的安全区中心并不一样：
   3:4 在画布中心上方 37.5px（正好等于默认 cardY），9:16 只在上方 31px。 */
function safeBounds(stage) {
  const top = state.mode === "tall" ? 88 : 75;
  const bottom = stage.clientHeight - 150;
  return { top, bottom, center: (top + bottom) / 2, height: bottom - top };
}

/* 卡片实际的垂直偏移 = 用户设的 cardY + 贴合安全区的补偿。
   预览和两条导出管线必须共用它，否则成品位置会和预览对不上。 */
function effectiveCardY() {
  return state.cardY + (state.fitOffsetY || 0);
}

/* 图片被压到比这更矮就没意义了，此时改为缩整张卡片 */
const MEDIA_MIN_H = 140;
/* 等比缩小后宽度不足卡片的这个比例，才退而求其次用裁切。
   定得很低是刻意的：完整显示优先，宁可图小一点也别把内容切掉，
   裁切只是「缩到几乎看不出是什么」时的极端兜底。 */
const MEDIA_MIN_W_RATIO = 0.15;

/* 图片在可用高度 room 内怎么摆：
   1) 全宽放得下 → 原样完整显示
   2) 放不下但等比缩小后不至于太窄 → 等比缩小，宽度自动收窄，图片仍然完整
   3) 缩完太窄 → 保持全宽、从顶部开始，只截掉底部（居中裁切会把图片头尾都丢掉） */
function layoutMedia(room) {
  const media = $("tc-media");
  media.classList.remove("fit", "crop");
  media.style.maxHeight = "";
  media.style.height = "";
  const fullW = media.offsetWidth, fullH = media.offsetHeight;
  if (!fullH || fullH <= room) return;

  const scaledW = fullW * (room / fullH);
  if (scaledW >= fullW * MEDIA_MIN_W_RATIO) {
    media.classList.add("fit");
    media.style.maxHeight = room + "px";
  } else {
    media.classList.add("crop");
    media.style.height = room + "px";
  }
}

/* 目标：只要装得下就完整显示，装不下按 layoutMedia 的三档处理，
   实在放不开才缩整卡。纯文字卡沿用原来的画框 92%——
   改了会让所有历史分享链接的出图突然变小。 */
function measureFitScale() {
  const stage = $("stage");
  const card = $("tweet-card");
  const media = $("tc-media");
  if (!card.offsetHeight) return;
  if (state.mode === "card") { fitPureCard(); return; }

  if (media.classList.contains("hidden")) {
    media.classList.remove("fit", "crop");
    media.style.maxHeight = "";
    media.style.height = "";
    state.fitOffsetY = 0;
    state.fitScale = Math.min(1, (stage.clientHeight * 0.92) / card.offsetHeight);
    applyCardTransform();
    return;
  }

  /* 有配图时把卡片对齐到安全区中心再撑满。默认 cardY=-37 是按 3:4 定的
     （3:4 安全区中心正好在画布中心上方 37.5px），9:16 只在上方 31px，
     照搬就会整体偏上、底部空一截。这里用 fitOffsetY 补掉这 6px 差值；
     用户一旦手动拖动卡片，initDrag 会把它清零，拖动依然说了算。 */
  const sb = safeBounds(stage);
  state.fitOffsetY = state.cardDragged ? 0 : sb.center - stage.clientHeight / 2 - state.cardY;

  // avail 是「屏幕上的」高度，而这里测的都是布局高度，最终还要再乘一次 cardScale，
  // 所以先折算回布局坐标系，否则卡片只会填到安全区的 cardScale%（默认 95%）。
  // 图片本身不会放大超过自然尺寸，所以调小「卡片大小」时滑块依然有效。
  const scale = Math.max(0.1, state.cardScale / 100);
  const avail = Math.max(120, sb.height - 4) / scale;   // 留 2px 余量，避免舍入后压线
  // 先复位成「全宽等比」再测，才能算出卡片里除图片以外占了多少
  media.classList.remove("fit", "crop");
  media.style.maxHeight = "";
  media.style.height = "";
  const other = card.offsetHeight - media.offsetHeight;
  layoutMedia(Math.max(MEDIA_MIN_H, avail - other));
  state.fitScale = Math.min(1, avail / card.offsetHeight);
  applyCardTransform();
}

function applyCardTransform() {
  const card = $("tweet-card");
  if (state.mode === "card") return;
  const s = (state.fitScale * state.cardScale) / 100;
  card.style.transform = `translate(-50%, -50%) translate(${state.cardX}px, ${effectiveCardY()}px) scale(${s.toFixed(3)})`;
}

/* 拖动卡片（仅竖图模式），双击回中 */
function initDrag() {
  const card = $("tweet-card");
  const stage = $("stage");
  let drag = null;
  card.addEventListener("pointerdown", (e) => {
    if (state.mode === "card") return;
    e.preventDefault();
    drag = { x0: e.clientX, y0: e.clientY, baseX: state.cardX, baseY: state.cardY };
    state.cardDragged = true;   // 用户自己定位了，别再自动往安全区中心贴
    state.fitOffsetY = 0;
    card.classList.add("dragging");
    card.setPointerCapture(e.pointerId);
  });
  card.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const z = Number(stage.style.zoom || 1) || 1; // 移动端 zoom 下指针位移要换算回画布坐标
    const limX = stage.clientWidth * 0.55, limY = stage.clientHeight * 0.55;
    state.cardX = Math.max(-limX, Math.min(limX, drag.baseX + (e.clientX - drag.x0) / z));
    state.cardY = Math.max(-limY, Math.min(limY, drag.baseY + (e.clientY - drag.y0) / z));
    applyCardTransform();
  });
  const end = () => { drag = null; card.classList.remove("dragging"); };
  card.addEventListener("pointerup", end);
  card.addEventListener("pointercancel", end);
  // 双击回中：连同「手动定过位」的标记一起复位，重新交给安全区自动贴合
  card.addEventListener("dblclick", () => {
    state.cardX = DEFAULT_CARD_X; state.cardY = DEFAULT_CARD_Y; state.cardDragged = false;
    measureFitScale();
  });
}

/* ---------- 背景 ---------- */

function filteredBackgrounds() {
  const q = state.bgQuery.trim().toLowerCase();
  if (!q) return state.backgrounds;
  return state.backgrounds.filter(
    (b) => (b.name || "").toLowerCase().includes(q) || (b.keywords || "").toLowerCase().includes(q)
  );
}

function bgThumb(src, name) {
  const btn = document.createElement("button");
  btn.className = "bg-thumb" + (state.bg === src ? " active" : "");
  btn.title = name;
  /* 逐个建元素而不是拼 innerHTML：自定义背景的 src 是 dataURL，它的 MIME 段来自
     bg-url 拉取到的远端 Content-Type（外部可控），拼进 src="${...}" 属性里
     理论上能靠一个引号逃出属性。与 renderList() 用 textContent 放推文同一个道理。 */
  const img = document.createElement("img");
  img.src = src;                 // 反射属性，getAttribute("src") 仍拿到原始字符串，setBg() 的比对不受影响
  img.alt = name;
  // lazy + async：152 张缩略图一次性解码会卡住主线程，且折叠区的图根本不该占带宽
  img.loading = "lazy";
  img.decoding = "async";
  const label = document.createElement("span");
  label.className = "bg-name";
  label.textContent = name;
  btn.append(img, label);
  btn.onclick = () => setBg(src);
  return btn;
}

/* 幂等全量重渲染：搜索、展开、上传都只改 state 再调它。
   注意这里不再兼「设默认背景」的副作用——那件事在 init() 里做一次，
   否则每次搜索/展开都会把用户选的背景重置掉。 */
function renderBackgroundGrid() {
  const grid = $("bg-grid");
  const list = filteredBackgrounds();
  /* 自定义图排在最前，并和内置图共用同一份格子预算。不共用的话上传一张，
     首屏就变 41 格、第 9 行冒出一个孤格，破坏「5 列 × 8 行」。 */
  const custom = state.customBgs.length;

  /* 选中项必须落在可见范围内：折叠一重置（搜索、换词、清空）就会把靠后的选中项藏起来，
     用户随即失去「我现在用的是哪张」的锚点。展开到覆盖它的那一页，
     并写回 state——只在局部变量里放大的话，下次点「查看更多」会从 40 起算反而变少。
     选中的是自定义图时 idx 为 -1，无需展开：它永远排在最前。 */
  const idx = list.findIndex((b) => "backgrounds/" + b.file === state.bg);
  if (idx >= 0 && idx + custom >= state.bgVisible) {
    state.bgVisible = Math.ceil((idx + custom + 1) / BG_PAGE) * BG_PAGE;
  }

  const shown = list.slice(0, Math.max(0, state.bgVisible - custom));

  grid.textContent = "";
  state.customBgs.forEach((src, i) => grid.appendChild(bgThumb(src, `自定义 ${i + 1}`)));
  shown.forEach((item) => grid.appendChild(bgThumb("backgrounds/" + item.file, item.name)));

  // 分母含自定义图，否则文案与网格里实际的格子数对不上
  $("bg-count").textContent = `当前显示 ${custom + shown.length} / ${custom + list.length} 张`;
  const more = $("bg-more");
  const rest = list.length - shown.length;
  more.hidden = rest <= 0;
  more.textContent = `查看更多背景（还有 ${rest} 张）`;
}

function setBg(src) {
  state.bg = src;
  $("stage-bg").src = src;
  // active 由 state.bg 驱动、渲染时比对 src：靠传进来的 DOM 元素打标记的话，
  // 一次重渲染元素就被销毁了，选中态跟着丢。
  document.querySelectorAll(".bg-thumb").forEach((b) => {
    const img = b.querySelector("img");
    b.classList.toggle("active", !!img && img.getAttribute("src") === src);
  });
}

function addCustomThumb(dataUrl) {
  state.customBgs.push(dataUrl);
  // 先 setBg 再重渲染：state.bg 已是新值，网格建元素时一次就把 active 打对，
  // 不用渲染完再回头改一遍 DOM
  setBg(dataUrl);
  renderBackgroundGrid();
}

/* ---------- 移动端适配与成品交付 ---------- */

/* stage 用 zoom 等比缩放适配窄屏：zoom 改变布局尺寸（不像 transform 会残留 540px 布局导致溢出错位）。导出前会临时还原。 */
function fitStageScale() {
  const wrap = document.querySelector(".stage-wrap");
  const stage = $("stage");
  stage.style.zoom = Math.min(1, (wrap.clientWidth - 24) / (state.mode === "card" ? stage.clientWidth : 540));
}

function isMobileLike() {
  return /iPad|iPhone|iPod|Android/i.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

/* 桌面直接下载；移动端弹预览面板走系统分享（按钮点击是新的用户手势，不会像异步 a.click 那样被 iOS 拦截） */
function deliverFile(blob, filename, hint) {
  if (isMobileLike()) { showExportSheet(blob, filename, hint); return; }
  const a = document.createElement("a");
  a.download = filename;
  a.href = URL.createObjectURL(blob);
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 10000);
}

function showExportSheet(blob, filename, hint) {
  const url = URL.createObjectURL(blob);
  const isVideo = blob.type.startsWith("video/");
  const sheet = document.createElement("div");
  sheet.className = "export-sheet";
  sheet.innerHTML = `
    <div class="es-panel">
      <div class="es-preview">${isVideo ? `<video src="${url}" autoplay muted loop playsinline></video>` : `<img src="${url}" alt="导出结果" />`}</div>
      <p class="es-hint">${hint}</p>
      <div class="es-actions">
        <button class="primary-btn es-share">保存 / 分享</button>
        <button class="ghost-btn es-close">关闭</button>
      </div>
    </div>`;
  document.body.appendChild(sheet);
  sheet.querySelector(".es-share").onclick = async () => {
    const file = new File([blob], filename, { type: blob.type });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file] }); } catch { /* 用户取消 */ }
    } else {
      const a = document.createElement("a");
      a.download = filename; a.href = url; a.click();
    }
  };
  sheet.querySelector(".es-close").onclick = () => { sheet.remove(); setTimeout(() => URL.revokeObjectURL(url), 1000); };
}

/* ---------- 导出 ---------- */

/* 配图没加载完就光栅化会得到一张空白图，导出前必须等它 */
function mediaReady() {
  const el = $("tc-media");
  if (el.classList.contains("hidden") || !el.getAttribute("src") || el.complete) return Promise.resolve();
  return new Promise((res) => {
    el.addEventListener("load", res, { once: true });
    el.addEventListener("error", res, { once: true });
  });
}

/* 卡片单独光栅化：临时摘掉浮动定位与 transform（作为根节点捕获时这些样式会被克隆进画布导致位移裁切） */
async function captureCardCanvas(pixelRatio) {
  const card = $("tweet-card");
  const hadFloating = card.classList.contains("floating");
  await mediaReady();
  measureFitScale();
  const prevTransform = card.style.transform;
  card.classList.remove("floating");
  card.style.transform = "none";
  try {
    return await htmlToImage.toCanvas(card, { pixelRatio });
  } finally {
    if (hadFloating) card.classList.add("floating");
    card.style.transform = prevTransform;
  }
}

/* 竖图成品：canvas 手动合成——背景直接 drawImage，不经 foreignObject
   （iOS Safari 对 foreignObject 里的 <img> 渲染不可靠，会导致背景整片变黑）。与 Live 视频同一条管线。 */
async function composePoster() {
  const stage = $("stage");
  const prevZoom = stage.style.zoom;
  stage.style.zoom = "1"; // 还原 1:1 布局再测量与捕获，避免移动端缩放影响尺寸计算
  try {
    const W = 1080, H = state.mode === "tall" ? 1920 : 1440;
    const card = $("tweet-card");
    const cardCanvas = await captureCardCanvas(2);
    const s = (state.fitScale * state.cardScale) / 100;
    const cw = card.offsetWidth * 2 * s, ch = card.offsetHeight * 2 * s;
    const cx = W / 2 + state.cardX * 2, cy = H / 2 + effectiveCardY() * 2;
    const bg = new Image();
    await new Promise((res, rej) => { bg.onload = res; bg.onerror = rej; bg.src = state.bg; });
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");
    drawCover(ctx, bg, W, H, 1);
    drawDim(ctx, W, H);
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,0.35)";
    ctx.shadowBlur = 40;
    ctx.shadowOffsetY = 10;
    ctx.drawImage(cardCanvas, cx - cw / 2, cy - ch / 2, cw, ch);
    ctx.restore();
    return cv;
  } finally {
    stage.style.zoom = prevZoom;
  }
}

async function exportPng() {
  const btn = $("export-btn");
  btn.disabled = true;
  btn.textContent = "生成中…";
  try {
    let blob;
    if (state.mode === "card") {
      // 纯卡片：透明背景，直接光栅化卡片
      const cardCanvas = await capturePureCardCanvas();
      blob = await new Promise((res) => cardCanvas.toBlob(res, "image/png"));
    } else {
      const cv = await composePoster();
      blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    }
    const tag = fromLibrary() ? state.selected.id : "custom";
    const name = `${state.profile.handle}-card-${currentDate().replaceAll("-", "")}-${tag}.png`;
    deliverFile(blob, name, "点「保存 / 分享」存到相册，或长按图片保存");
  } catch (err) {
    alert("导出失败：" + err.message + "\n如果用了网络图片背景，可能是跨域限制，请下载后用「上传图片」。");
  } finally {
    btn.disabled = false;
    btn.textContent = "下载 PNG";
  }
}

/* ---------- BYOK：用用户自己的 X API Key 同步推文 ----------
   Key 只存 localStorage；浏览器无法直连 api.x.com（无 CORS 头），
   请求经 tools.upthos.com 的无状态转发（Pages Function，不记录不存储）。 */

const X_PROXY = "https://tools.upthos.com/api/x/";
const XKEY_KEY = "tcs-xkey";
const XSYNC_KEY = "tcs-xsync"; // { handle, newestId }

async function xApi(path, params, token) {
  const qs = new URLSearchParams(params).toString();
  const r = await fetch(X_PROXY + path + (qs ? "?" + qs : ""), {
    headers: { Authorization: "Bearer " + token },
  });
  if (r.status === 401) throw new Error("Key 无效或无权限（401）");
  if (r.status === 403) throw new Error("你的套餐无此端点权限（403）");
  if (r.status === 429) throw new Error("RATE_LIMIT");
  if (!r.ok) throw new Error("X API 错误 " + r.status);
  return r.json();
}

/* 清洗 API 返回：长推取全文，t.co 换成可读链接，媒体链接删除（与 build_posts.py 同逻辑） */
function cleanApiText(p) {
  const note = p.note_tweet || {};
  let text = note.text || p.text || "";
  const urls = [...((p.entities || {}).urls || []), ...((note.entities || {}).urls || [])];
  for (const u of urls) {
    if (!u.url) continue;
    const expanded = u.expanded_url || "", display = u.display_url || "";
    if (expanded.includes("/photo/") || expanded.includes("/video/") || display.startsWith("pic.x.com") || display.startsWith("pic.twitter.com")) {
      text = text.replaceAll(u.url, "");
    } else {
      text = text.replaceAll(u.url, display);
    }
  }
  text = text.replace(/https:\/\/t\.co\/\w+/g, "");
  return text.split("\n").map((l) => l.replace(/\s+$/, "")).join("\n").trim();
}

function apiToPost(p, handle) {
  const d = new Date(p.created_at);
  const pm = p.public_metrics || {};
  return {
    id: p.id,
    date: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`,
    datetime: "",
    text: cleanApiText(p),
    long: !!p.note_tweet,
    sourceUrl: `https://x.com/${handle}/status/${p.id}`,
    topic: "未分类",
    metrics: {
      likes: pm.like_count || 0,
      replies: pm.reply_count || 0,
      retweets: pm.retweet_count || 0,
      quotes: pm.quote_count || 0,
      bookmarks: pm.bookmark_count || 0,
      views: pm.impression_count || 0,
      score: metricScore({ likes: pm.like_count || 0, retweets: pm.retweet_count || 0, replies: pm.reply_count || 0, bookmarks: pm.bookmark_count || 0, views: pm.impression_count || 0 }),
    },
  };
}

async function xSync() {
  const btn = $("x-sync"), status = $("x-status");
  const token = $("x-token").value.trim();
  const handle = $("x-handle").value.trim().replace(/^@+/, "");
  const limit = Number($("x-limit").value);
  if (!token) { status.textContent = "请先填 Bearer Token"; return; }
  if (!token.startsWith("AA") || token.length < 60) {
    status.textContent = "这不像 Bearer Token（应为 AAAA 开头的 100+ 位长字符串）。API Key / Secret 不能用，请到 Keys and tokens 页复制 Bearer Token";
    return;
  }
  if (!handle) { status.textContent = "请填用户名"; return; }

  btn.disabled = true;
  const collected = [];
  try {
    localStorage.setItem(XKEY_KEY, token);

    status.textContent = "查询用户…";
    const ur = await xApi("2/users/by/username/" + handle, { "user.fields": "profile_image_url,verified,verified_type" }, token);
    if (!ur.data) throw new Error("找不到用户 @" + handle);
    const user = ur.data;

    let sync = null;
    try { sync = JSON.parse(localStorage.getItem(XSYNC_KEY) || "null"); } catch { /* 忽略 */ }
    const incremental = sync && sync.handle === handle && sync.newestId;

    const base = {
      max_results: "100",
      exclude: "replies,retweets",
      "tweet.fields": "created_at,public_metrics,note_tweet,entities",
    };
    if (incremental) base.since_id = sync.newestId;

    let nextToken = null, rateLimited = false;
    while (collected.length < limit) {
      status.textContent = `拉取中… 已 ${collected.length} 条`;
      const params = { ...base };
      if (nextToken) params.pagination_token = nextToken;
      let page;
      try {
        page = await xApi(`2/users/${user.id}/tweets`, params, token);
      } catch (e) {
        if (e.message === "RATE_LIMIT" && collected.length) { rateLimited = true; break; }
        throw e;
      }
      (page.data || []).forEach((p) => collected.push(apiToPost(p, handle)));
      nextToken = page.meta && page.meta.next_token;
      if (!nextToken) break;
    }

    const merged = new Map();
    if (incremental) state.posts.forEach((p) => merged.set(p.id, p));
    collected.forEach((p) => { if (p.text) merged.set(p.id, p); });
    if (!merged.size) throw new Error(incremental ? "没有新推文" : "没拉到任何推文");
    state.posts = [...merged.values()].sort((a, b) => (BigInt(b.id) > BigInt(a.id) ? 1 : -1));

    localStorage.setItem(XSYNC_KEY, JSON.stringify({ handle, newestId: state.posts[0].id }));
    try { localStorage.setItem(POSTS_KEY, JSON.stringify(state.posts)); }
    catch { alert("推文库太大无法保存到本机，仅本次会话有效。可让 Claude 把它写入 posts.json 持久化。"); }

    saveProfileOverride({ name: user.name, handle: user.username, verified: !!user.verified || ["blue", "business"].includes(user.verified_type), badge: user.verified_type === "business" ? "gold" : "blue" });
    try {
      const av = await fetch(user.profile_image_url.replace("_normal", "_400x400"));
      if (av.ok) {
        const blob = await av.blob();
        const dataUrl = await new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
        saveProfileOverride({ avatarData: dataUrl });
      }
    } catch { /* 头像拉不到就让用户手动传 */ }

    state.chip = { kind: "all", v: "" };
    state.month = "";
    refreshLibrary();
    $("tab-library").click();
    selectPost(state.posts[0]);
    status.textContent = rateLimited
      ? `已同步 ${collected.length} 条后触发频控，15 分钟后可再拉`
      : `完成：新增 ${collected.length} 条，库内共 ${state.posts.length} 条`;
  } catch (err) {
    status.textContent = err.message === "RATE_LIMIT" ? "触发 X API 频控（429），请 15 分钟后再试" : "失败：" + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 在线抓取：单条推文链接 → 推文库 ----------
   请求走同源的 /api/importer（Cloudflare Pages Function）转发，
   因为抓取服务尚未允许本站来源跨域直连。
   令牌只存本机 localStorage，不进代码库也不进部署产物。 */

const DEFAULT_IMPORTER_URL = "https://x-api.opc.tools/import/twitter";

function normalizeImporterUrl(raw) {
  const url = new URL(String(raw || DEFAULT_IMPORTER_URL).trim());
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("接口地址需使用不含账号密码的 HTTPS 地址");
  }
  if (url.search || url.hash) throw new Error("接口地址不能包含查询参数或片段");
  if (url.pathname === "/" || url.pathname.replace(/\/+$/, "") === "/import/twitter") {
    url.pathname = "/import/twitter";
  } else {
    throw new Error("请填写 API 根域名或以 /import/twitter 结尾的完整地址");
  }
  return url.toString();
}

function loadImporterCfg() {
  try {
    const raw = JSON.parse(localStorage.getItem(IMPORTER_KEY) || "null");
    if (raw && typeof raw === "object") {
      const url = !raw.url || /^https:\/\/importer-x\.hitu\.me(?:\/import\/twitter)?\/?$/.test(raw.url)
        ? DEFAULT_IMPORTER_URL : raw.url;
      return { url, token: raw.token || "", admin: raw.admin || "" };
    }
  } catch { /* 忽略损坏的本机数据 */ }
  return { url: DEFAULT_IMPORTER_URL, token: "", admin: "" };
}

function applyImporterCfgToInputs() {
  const cfg = loadImporterCfg();
  $("importer-url").value = cfg.url;
  $("importer-token").value = cfg.token;
  $("importer-admin").value = cfg.admin;
}

/* 新接口的互动字段直接保留原名，正文和首图始终来自同一条主推文。
   媒体只取主推文自己的（thread.tweets[0].images/videos）——顶层 media[] 含整条 thread 的媒体。 */
function mapImportedPost(d) {
  const src = d.source || {};
  const tweets = d.thread?.tweets || [];
  const first = tweets.find((tweet) => String(tweet.id) === String(src.tweetId)) || tweets[0] || {};
  const text = String(first.text ?? d.text ?? d.promptText ?? "");
  const publishedAt = first.publishedAt || d.publishedAt || d.createdAtRaw || d.date || "";
  const image = (first.images || [])[0] || "";
  const video = (first.videos || [])[0] || "";
  const post = {
    id: "x-" + (src.tweetId || String(Date.now())),
    date: /^\d{4}-\d{2}-\d{2}/.test(publishedAt) ? publishedAt.slice(0, 10) : todayISO(),
    datetime: publishedAt,
    text,
    long: text.length > 300,
    sourceUrl: src.url || "",
    topic: "在线抓取",
    metrics: normalizeMetrics(d.metrics || first),
    metricsAvailable: !!d.metrics || METRIC_KEYS.some((key) => Object.hasOwn(first, key)),
  };
  // 视频不进卡片（只记录来源），卡片上用的是封面图
  if (image || video) post.media = { image, video };
  return post;
}

async function fetchTweetByUrl() {
  const btn = $("fetch-go");
  const status = $("fetch-status");
  const url = $("fetch-url").value.trim();

  if (!/^https?:\/\/(?:www\.)?(?:x|twitter)\.com\/[^/]+\/status\/\d+/i.test(url)) {
    status.textContent = "请填一条形如 https://x.com/用户名/status/数字ID 的链接";
    return;
  }
  const cfg = loadImporterCfg();
  if (!cfg.token) {
    $("importer-settings").classList.remove("hidden");
    status.textContent = "还没填访问令牌，先在下面的设置里保存";
    return;
  }

  btn.disabled = true;
  status.textContent = "抓取中…最长约 90 秒";
  try {
    const endpoint = normalizeImporterUrl(cfg.url);
    const res = await fetch("/api/importer", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Importer-Token": cfg.token,
        "X-Importer-Url": endpoint,
        "X-Admin-Password": cfg.admin,
      },
      body: JSON.stringify({ url }),
    });

    // 404 = 没有这个路由；501 = python 的 http.server 对 POST 的固定回应（Unsupported method）
    if (res.status === 404 || res.status === 501) {
      throw new Error("当前服务没有抓取接口。本地请用 npx wrangler pages dev . 启动（python -m http.server 不支持），或直接用线上站点");
    }
    let data = {};
    try { data = await res.json(); } catch { /* 上游可能返回非 JSON */ }
    if (!res.ok) {
      const msg = data.error || data.detail || "";
      throw new Error(
        res.status === 400 ? (msg || "链接无效，或不是支持的 X/Twitter 推文") :
        res.status === 401 ? "访问令牌不对或已失效，去设置里检查" :
        res.status === 504 ? "抓取超时，稍后再试" :
        res.status === 502 ? "抓取失败（X 页面结构变化或服务端 cookie 失效）" :
        msg || `抓取失败（HTTP ${res.status}）`
      );
    }

    if (data.ok === false) throw new Error(data.error || "抓取服务未返回有效推文");

    const post = mapImportedPost(data);
    if (!post.text) throw new Error("抓到了但正文是空的，可能是这条推文只有图片");

    /* 入库门禁：密码由服务端比对后回 _canSave。不通过就只上卡、不落库，
       抓到的内容仍能编辑导出，只是不进推文库。 */
    let note = "";
    if (data._canSave) {
      // 同一条链接重复抓取时替换旧记录，不堆重复条目
      const key = post.sourceUrl || post.id;
      const idx = state.posts.findIndex((p) => (p.sourceUrl || p.id) === key);
      if (idx >= 0) state.posts[idx] = post; else state.posts.unshift(post);

      try { localStorage.setItem(POSTS_KEY, JSON.stringify(state.posts)); }
      catch { alert("推文库太大无法保存到本机，本条仅本次会话有效。"); }

      state.chip = { kind: "all", v: "" };
      state.month = "";
      state.search = "";
      $("search").value = "";
      refreshLibrary();
      note = idx >= 0 ? "已更新：" : "已抓取：";
    } else {
      note = "已抓取（未入库，管理密码不对）：";
    }

    selectPost(post);
    primeCustomText(true);   // 抓完直接可编辑，省掉一次手动复制
    $("tab-custom").click();
    status.textContent = note + post.date + " · " + post.text.length + " 字" + (post.media && post.media.image ? " · 含配图" : "");
  } catch (err) {
    status.textContent = "失败：" + err.message;
  } finally {
    btn.disabled = false;
  }
}

/* ---------- 导出 Live 图（3 秒动效 MP4，WebCodecs 编码） ----------
   卡片完全静止，只有背景缓慢推近（Ken Burns）。
   手机端用 intoLive / 快捷指令把 MP4 转成实况照片后即可按 Live 图发布。 */

function drawCover(ctx, img, W, H, zoom) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const ir = iw / ih, r = W / H;
  let dw, dh;
  if (ir > r) { dh = H * zoom; dw = dh * ir; } else { dw = W * zoom; dh = dw / ir; }
  ctx.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
}

/* 背景压暗：必须在 ctx.save() 设阴影之前调用，否则这层黑幕自己也会投影。
   alpha 与预览侧 #stage-dim 的 opacity 取同一个值，两边是同一套 source-over 混合。 */
function drawDim(ctx, W, H) {
  if (!state.bgDim) return;
  ctx.save();
  ctx.fillStyle = `rgba(0,0,0,${state.bgDim / 100})`;
  ctx.fillRect(0, 0, W, H);
  ctx.restore();
}

async function exportLive() {
  if (state.mode === "card") return;
  if (!("VideoEncoder" in window)) {
    alert("当前浏览器不支持视频编码（WebCodecs）。请使用新版 Chrome / Edge / Safari。");
    return;
  }
  const btn = $("live-btn");
  btn.disabled = true;
  try {
    const W = 1080, H = state.mode === "tall" ? 1920 : 1440;
    const FPS = 30, DUR = 3, TOTAL = FPS * DUR;

    const codec = { codec: "avc1.640028", width: W, height: H, bitrate: 8_000_000, framerate: FPS };
    const support = await VideoEncoder.isConfigSupported(codec);
    if (!support.supported) throw new Error("此设备不支持 H.264 1080p 编码");

    // 卡片只光栅化一次，逐帧只做画布合成
    btn.textContent = "准备卡片…";
    const card = $("tweet-card");
    const cardCanvas = await captureCardCanvas(2);
    const s = (state.fitScale * state.cardScale) / 100;
    const cw = card.offsetWidth * 2 * s, ch = card.offsetHeight * 2 * s;
    const cx = W / 2 + state.cardX * 2, cy = H / 2 + effectiveCardY() * 2;

    const bg = new Image();
    await new Promise((res, rej) => { bg.onload = res; bg.onerror = rej; bg.src = state.bg; });

    const muxer = new Mp4Muxer.Muxer({
      target: new Mp4Muxer.ArrayBufferTarget(),
      video: { codec: "avc", width: W, height: H },
      fastStart: "in-memory",
    });
    const encoder = new VideoEncoder({
      output: (chunk, meta) => muxer.addVideoChunk(chunk, meta),
      error: (e) => console.error(e),
    });
    encoder.configure(codec);

    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const ctx = cv.getContext("2d");

    for (let f = 0; f < TOTAL; f++) {
      const t = f / (TOTAL - 1);
      drawCover(ctx, bg, W, H, 1 + 0.07 * t); // 只动背景：缓慢推近
      drawDim(ctx, W, H);
      ctx.save();
      ctx.shadowColor = "rgba(0,0,0,0.35)";
      ctx.shadowBlur = 40;
      ctx.shadowOffsetY = 10;
      ctx.drawImage(cardCanvas, cx - cw / 2, cy - ch / 2, cw, ch); // 卡片完全静止
      ctx.restore();
      const frame = new VideoFrame(cv, { timestamp: (f * 1e6) / FPS, duration: 1e6 / FPS });
      encoder.encode(frame, { keyFrame: f % FPS === 0 });
      frame.close();
      if (f % 6 === 0) {
        btn.textContent = `渲染 ${Math.round((f / TOTAL) * 100)}%`;
        await new Promise((r) => setTimeout(r));
      }
    }
    btn.textContent = "编码中…";
    await encoder.flush();
    muxer.finalize();

    const blob = new Blob([muxer.target.buffer], { type: "video/mp4" });
    const tag = fromLibrary() ? state.selected.id : "custom";
    const name = `${state.profile.handle}-live-${todayISO().replaceAll("-", "")}-${tag}.mp4`;
    deliverFile(blob, name, "保存到相册后，用 intoLive / 快捷指令转成实况照片再发布");

    if (!isMobileLike() && !localStorage.getItem("tcs-live-hint")) {
      localStorage.setItem("tcs-live-hint", "1");
      alert("已导出 3 秒动效 MP4。\n\n发布为 Live 图：把视频传到手机，用 intoLive（免费 App）或快捷指令转成实况照片，抖音/小红书发布时从相册选择即可带「实况」标识。");
    }
  } catch (err) {
    alert("Live 图导出失败：" + err.message);
  } finally {
    btn.disabled = false;
    btn.textContent = "导出 Live 图";
  }
}

/* ---------- 事件绑定 ---------- */

function bindSegmented(pairs, onChange) {
  // pairs: [[element, value], ...]
  pairs.forEach(([el, value]) => {
    el.onclick = () => {
      pairs.forEach(([e]) => e.classList.remove("active"));
      el.classList.add("active");
      onChange(value);
    };
  });
}

function bind() {
  bindSegmented([[$("tab-library"), "library"], [$("tab-fetch"), "fetch"], [$("tab-custom"), "custom"]], (v) => {
    if (v === "custom") primeCustomText(false);
    state.tab = v;
    $("library-section").classList.toggle("hidden", v !== "library");
    $("fetch-section").classList.toggle("hidden", v !== "fetch");
    $("custom-section").classList.toggle("hidden", v !== "custom");
    if (v === "custom") $("custom-date").value = currentDate();
    renderCard();
  });

  $("custom-reseed").onclick = () => {
    primeCustomText(true);
    $("custom-date").value = currentDate();
    renderCard();
  };

  $("library-toggle").onclick = () => {
    const open = $("library-settings").classList.toggle("hidden") === false;
    $("library-browser").classList.toggle("hidden", open);
    $("library-toggle").setAttribute("aria-expanded", String(open));
  };
  const libraryTabs = ["import", "export", "default"];
  bindSegmented(libraryTabs.map((tab) => [$("library-tab-" + tab), tab]), (selected) => {
    libraryTabs.forEach((tab) => {
      const active = tab === selected;
      $("library-panel-" + tab).classList.toggle("hidden", !active);
      $("library-tab-" + tab).setAttribute("aria-selected", String(active));
      $("library-tab-" + tab).tabIndex = active ? 0 : -1;
    });
    $("library-status").textContent = "";
  });
  libraryTabs.forEach((tab, index) => {
    $("library-tab-" + tab).onkeydown = (e) => {
      const next = { ArrowRight: (index + 1) % 3, ArrowLeft: (index + 2) % 3, Home: 0, End: 2 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      $("library-tab-" + libraryTabs[next]).focus();
      $("library-tab-" + libraryTabs[next]).click();
    };
  });

  $("fetch-go").onclick = fetchTweetByUrl;
  $("fetch-url").onkeydown = (e) => { if (e.key === "Enter") fetchTweetByUrl(); };
  $("importer-toggle").onclick = () => $("importer-settings").classList.toggle("hidden");
  $("importer-save").onclick = () => {
    try {
      const url = normalizeImporterUrl($("importer-url").value);
      const token = $("importer-token").value.trim();
      const admin = $("importer-admin").value.trim();
      localStorage.setItem(IMPORTER_KEY, JSON.stringify({ url, token, admin }));
      $("importer-url").value = url;
      $("fetch-status").textContent = token ? "设置已保存到本机" : "已保存（令牌为空）";
    } catch (err) {
      $("importer-status").textContent = "保存失败：" + err.message;
      return;
    }
    $("importer-status").textContent = "";
    $("importer-settings").classList.add("hidden");   // 保存即收起，再点齿轮展开
    setTimeout(() => { if ($("fetch-status").textContent.startsWith("设置已保存") || $("fetch-status").textContent.startsWith("已保存")) $("fetch-status").textContent = ""; }, 2500);
  };
  $("importer-clear").onclick = () => {
    localStorage.removeItem(IMPORTER_KEY);
    applyImporterCfgToInputs();
    $("importer-status").textContent = "已清除本机保存的配置";
  };

  bindSegmented([[$("mode-poster"), "poster"], [$("mode-tall"), "tall"], [$("mode-card"), "card"]], (v) => {
    const leavingPureCard = state.mode === "card" && v !== "card";
    state.mode = v;
    renderCard();
    if (leavingPureCard) fitStageScale();
  });
  bindSegmented([[$("card-ratio-auto"), "auto"], [$("card-ratio-poster"), "3:4"], [$("card-ratio-tall"), "9:16"]], (v) => { state.cardRatio = v; renderCard(); });
  bindSegmented([[$("theme-light"), "light"], [$("theme-dark"), "dark"]], (v) => { state.theme = v; renderCard(); });
  bindSegmented([[$("metrics-on"), true], [$("metrics-off"), false]], (v) => { state.metricsOn = v; renderCard(); });
  bindSegmented([[$("media-on"), true], [$("media-off"), false]], (v) => { state.mediaOn = v; renderCard(); });
  bindSegmented([[$("guides-on"), true], [$("guides-off"), false]], (v) => { state.guidesOn = v; renderCard(); });
  // 图片决定卡片高度，加载完必须重测一次，否则 fitScale 用的是没图时的高度
  $("tc-media").onload = measureFitScale;

  document.querySelectorAll(".sort-chip").forEach((chip) => {
    chip.onclick = () => {
      document.querySelectorAll(".sort-chip").forEach((c) => c.classList.remove("active"));
      chip.classList.add("active");
      state.sort = chip.dataset.sort;
      applyFilter();
    };
  });

  $("search").oninput = (e) => { state.search = e.target.value; applyFilter(); };
  $("month-filter").onchange = (e) => { state.month = e.target.value; applyFilter(); };
  $("random-btn").onclick = randomPost;
  $("custom-text").oninput = (e) => {
    state.customText = e.target.value;
    renderCard();
  };
  $("custom-date").oninput = (e) => {
    // 日期分段输入时可能暂时为空，保持已选日期，等输入完整再更新预览。
    if (!isISODate(e.target.value)) return;
    state.customDate = e.target.value;
    state.customDateEdited = true;
    state.dateOverride = "";
    renderCard();
  };
  $("custom-date").onblur = (e) => {
    if (!isISODate(e.target.value)) e.target.value = currentDate();
  };
  $("card-scale").oninput = (e) => { paintRange(e.target); state.cardScale = Number(e.target.value); $("scale-val").textContent = state.cardScale + "%"; measureFitScale(); refreshAgentPrompt(); };
  $("card-opacity").oninput = (e) => { paintRange(e.target); state.cardOpacity = Number(e.target.value); renderCard(); };
  // 字号会改变卡片高度，必须走全量渲染让 fitScale 重算；压暗只改一层 opacity，走轻量路径
  $("body-size").oninput = (e) => { paintRange(e.target); state.bodySize = Number(e.target.value); renderCard(); };
  $("bg-dim").oninput = (e) => {
    paintRange(e.target);
    state.bgDim = Number(e.target.value);
    $("stage-dim").style.opacity = state.bgDim / 100;
    $("dim-val").textContent = state.bgDim + "%";
    refreshAgentPrompt();
  };

  $("bg-search").oninput = (e) => {
    state.bgQuery = e.target.value;
    state.bgVisible = BG_INITIAL;   // 换搜索词就收回折叠，否则搜完还是一屏几百张
    renderBackgroundGrid();
  };

  $("bg-more").onclick = () => {
    state.bgVisible += BG_PAGE;
    renderBackgroundGrid();
  };

  $("bg-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => addCustomThumb(reader.result);
    reader.readAsDataURL(file);
  };

  $("bg-url").onkeydown = async (e) => {
    if (e.key !== "Enter") return;
    const url = e.target.value.trim();
    if (!url) return;
    try {
      const blob = await fetch(url).then((r) => { if (!r.ok) throw new Error(r.status); return r.blob(); });
      const reader = new FileReader();
      reader.onload = () => addCustomThumb(reader.result);
      reader.readAsDataURL(blob);
    } catch {
      alert("拉取失败（多半是跨域限制）。请把图片下载到本地后用「上传图片」。");
    }
  };

  $("copy-text").onclick = async () => {
    const text = effectiveContent().text;   // 与卡片一致：图片链接已被摘成配图
    await navigator.clipboard.writeText(text);
    $("copy-text").textContent = "已复制 ✓";
    setTimeout(() => ($("copy-text").textContent = "复制文案"), 1200);
  };

  // 有真实数据时点它就是主动换成随机——用于「数据不好看想美化」的场景
  $("shuffle-metrics").onclick = () => { rollMetrics(); renderCard(); };

  $("copy-link").onclick = async () => {
    await navigator.clipboard.writeText(buildShareUrl(false));
    $("copy-link").textContent = "已复制 ✓";
    setTimeout(() => ($("copy-link").textContent = "复制链接"), 1200);
  };

  $("copy-agent").onclick = async () => {
    await navigator.clipboard.writeText($("agent-prompt").value);
    $("copy-agent").textContent = "已复制 ✓";
    setTimeout(() => ($("copy-agent").textContent = "复制这段指令"), 1400);
  };

  $("export-btn").onclick = exportPng;
  $("live-btn").onclick = exportLive;

  /* ---- 账号信息 ---- */
  $("profile-name").oninput = (e) => { saveProfileOverride({ name: e.target.value || DEFAULT_PROFILE.name }); renderCard(); };
  $("profile-handle").oninput = (e) => { saveProfileOverride({ handle: e.target.value.replace(/^@+/, "") || DEFAULT_PROFILE.handle }); renderCard(); };
  $("badge-on").onclick = () => { saveProfileOverride({ verified: true, badge: "blue" }); refreshAgentPrompt(); };
  $("badge-gold").onclick = () => { saveProfileOverride({ verified: true, badge: "gold" }); refreshAgentPrompt(); };
  $("badge-off").onclick = () => { saveProfileOverride({ verified: false, badge: "none" }); refreshAgentPrompt(); };

  $("avatar-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => { saveProfileOverride({ avatarData: reader.result }); refreshAgentPrompt(); };
    reader.readAsDataURL(file);
  };

  $("profile-reset").onclick = async () => {
    localStorage.removeItem(PROFILE_KEY);
    state.profile = { ...DEFAULT_PROFILE };
    $("avatar-upload").value = "";
    await loadProfile(false);
    renderCard();
  };

  $("posts-upload").onchange = (e) => {
    const file = e.target.files[0];
    if (!file) return;
    e.target.value = "";
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const arr = JSON.parse(reader.result);
        if (!Array.isArray(arr)) throw new Error("需要一个 JSON 数组");
        const posts = normalizePosts(arr);
        if (!posts.length) throw new Error("没有找到带 text 字段的条目");
        state.posts = posts;
        localStorage.removeItem(XSYNC_KEY);
        try {
          localStorage.setItem(POSTS_KEY, JSON.stringify(posts));
          $("library-status").textContent = `已导入 ${posts.length} 条，已保存到当前浏览器。`;
        } catch {
          $("library-status").textContent = "浏览器空间不足，导入仅本次会话有效，请导出 JSON 备份。";
        }
        state.search = "";
        $("search").value = "";
        state.chip = { kind: "all", v: "" };
        state.month = "";
        refreshLibrary();
        selectPost(state.posts[0]);
      } catch (err) {
        $("library-status").textContent = "导入失败：" + err.message;
      }
    };
    reader.onerror = () => { $("library-status").textContent = "文件读取失败，请重新选择 JSON 文件。"; };
    reader.readAsText(file);
  };

  /* 导出完整本机推文库为文件备份，不发送网络请求。 */
  $("posts-export").onclick = () => {
    const blob = new Blob([JSON.stringify(state.posts, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "posts.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  };

  $("posts-reset").onclick = () => {
    localStorage.removeItem(POSTS_KEY);
    localStorage.removeItem(XSYNC_KEY);
    location.reload();
  };

  /* ---- X API 同步（BYOK） ---- */
  $("x-token").value = localStorage.getItem(XKEY_KEY) || "";
  if (state.profile.handle && state.profile.handle !== DEFAULT_PROFILE.handle) $("x-handle").value = state.profile.handle;
  $("x-sync").onclick = xSync;
  $("x-clear").onclick = () => {
    localStorage.removeItem(XKEY_KEY);
    $("x-token").value = "";
    $("x-status").textContent = "已清除本机保存的 Key";
  };
}

/* ---------- 启动 ---------- */

async function loadPosts() {
  // 优先级：本机导入的库 → posts.json → posts.sample.json（示例数据）
  try {
    const saved = JSON.parse(localStorage.getItem(POSTS_KEY) || "null");
    if (Array.isArray(saved) && saved.length) return normalizePosts(saved);
  } catch { /* 忽略损坏的本机数据 */ }
  for (const src of ["posts.json", "posts.sample.json"]) {
    try {
      const r = await fetch(src);
      if (r.ok) return normalizePosts(await r.json());
    } catch { /* 继续尝试下一个来源 */ }
  }
  return [];
}

/* ---------- URL 参数 / Agent 接口 ----------
   任何带浏览器能力的 Agent 都可以：打开 ?embed=1&text=...，等待
   document.documentElement.dataset.ready === "1"，再读 window.__cardDataUrl。 */

const clampNum = (v, lo, hi, dflt) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(lo, Math.min(hi, n)) : dflt;
};

/* 把 state 回写到分段按钮。和滑块同理：URL 参数只改了 state，
   按钮高亮还停在 HTML 里的初始值，会出现「参数生效了但按钮显示相反」的错位。 */
function syncToggleButtons() {
  const pick = (onId, offId, on) => {
    $(onId).classList.toggle("active", !!on);
    $(offId).classList.toggle("active", !on);
  };
  pick("metrics-on", "metrics-off", state.metricsOn);
  pick("media-on", "media-off", state.mediaOn);
  pick("guides-on", "guides-off", state.guidesOn);
  pick("theme-light", "theme-dark", state.theme === "light");
  ["poster", "tall", "card"].forEach((m) => $("mode-" + m).classList.toggle("active", state.mode === m));
  [["auto", "auto"], ["poster", "3:4"], ["tall", "9:16"]].forEach(([id, ratio]) => $("card-ratio-" + id).classList.toggle("active", state.cardRatio === ratio));
}

/* 把滑块已选比例写进 --fill，供 CSS 画填充色。
   Chrome 没有「已填充轨道」的伪元素，只能用渐变模拟，所以取值一变就得刷。 */
function paintRange(el) {
  const min = Number(el.min || 0), max = Number(el.max || 100);
  const pct = max > min ? ((Number(el.value) - min) / (max - min)) * 100 : 0;
  el.style.setProperty("--fill", pct + "%");
}

/* 把 state 回写到滑块。URL 参数进来时只改了 state，拇指还停在 HTML 里的初始 value，
   会出现"标签写 120%、卡片也是 120%，拇指却在 95"的错位。 */
function syncSliderInputs() {
  $("card-scale").value = state.cardScale;
  $("card-opacity").value = state.cardOpacity;
  $("body-size").value = state.bodySize;
  $("bg-dim").value = state.bgDim;
  ["card-scale", "card-opacity", "body-size", "bg-dim"].forEach((id) => paintRange($(id)));
}

function blobToDataUrl(blob) {
  return new Promise((res) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.readAsDataURL(blob); });
}

/* 外部图片先取回转 dataURL，避免 canvas 被跨域污染导致导出失败 */
async function fetchAsDataUrl(url) {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await blobToDataUrl(await r.blob());
  } catch { return null; }
}

/* 背景库编号化（photo-xxx → bj_n-xxx）之前发出去的分享链接带的是老 slug，
   剥掉两种前缀再比一次就能救回来，比维护一张映射表便宜得多。 */
const bgSlug = (s) => s.replace(/\.(jpg|jpeg|png|svg)$/i, "").replace(/^(photo-|bj_\d+-)/, "");

async function resolveBgParam(v) {
  if (!v) return null;
  if (/^https?:\/\//i.test(v)) return await fetchAsDataUrl(v);
  const hit = state.backgrounds.find(
    (b) => b.file === v || b.file.replace(/\.(jpg|jpeg|png|svg)$/, "") === v || b.name === v || bgSlug(b.file) === bgSlug(v)
  );
  return hit ? "backgrounds/" + hit.file : null;
}

async function applyUrlParams() {
  const q = new URLSearchParams(location.search);
  if (![...q.keys()].length) return false;

  if (q.get("name")) state.profile.name = q.get("name");
  if (q.get("handle")) state.profile.handle = q.get("handle").replace(/^@+/, "");
  if (q.has("verified")) {
    state.profile.verified = q.get("verified") !== "0";
    state.profile.badge = q.get("verified") === "gold" ? "gold" : "blue";
  }
  if (q.get("avatar")) {
    const data = await fetchAsDataUrl(q.get("avatar"));
    if (data) state.profile.avatarData = data;
  }
  applyProfile();

  if (q.get("text")) { state.tab = "custom"; state.customText = q.get("text"); }
  if (isISODate(q.get("date"))) {
    if (state.tab === "custom") {
      state.customDate = q.get("date");
      state.customDateEdited = true;
    } else {
      state.dateOverride = q.get("date");
    }
  }

  const mode = q.get("mode");
  if (["poster", "tall", "card"].includes(mode)) state.mode = mode;
  if (["auto", "3:4", "9:16"].includes(q.get("ratio"))) state.cardRatio = q.get("ratio");
  if (q.get("theme") === "dark") state.theme = "dark";
  if (q.has("scale")) state.cardScale = clampNum(q.get("scale"), 50, 140, state.cardScale);
  if (q.has("opacity")) state.cardOpacity = clampNum(q.get("opacity"), 30, 100, state.cardOpacity);
  if (q.has("fontsize")) state.bodySize = clampNum(q.get("fontsize"), 14, 22, state.bodySize);
  if (q.has("dim")) state.bgDim = clampNum(q.get("dim"), 0, 55, state.bgDim);
  if (q.get("img")) state.mediaUrl = q.get("img");
  if (q.get("media") === "off") state.mediaOn = false;
  if (q.has("x")) state.cardX = clampNum(q.get("x"), -400, 400, 0);
  if (q.has("y")) { state.cardY = clampNum(q.get("y"), -600, 600, 0); state.cardDragged = true; }
  if (q.get("guides") === "0") state.guidesOn = false;

  if (q.get("metrics") === "off") state.metricsOn = false;
  if (METRIC_KEYS.some((k) => q.has(k)) || q.has("reposts")) {
    state.fakeMetrics = normalizeMetrics(Object.fromEntries(q));
    state.metricsIsReal = true;
  }

  const bg = await resolveBgParam(q.get("bg"));
  // 走 setBg 而不是自己赋 state.bg + 改 src：那是它的两行内联复制。
  // 此刻网格还没渲染，setBg 里的 active 遍历是空操作，无副作用。
  if (bg) setBg(bg);

  return q.get("embed") === "1";
}

/* embed 模式：隐藏界面，只输出成品，把 base64 PNG 挂到 window.__cardDataUrl */
async function runEmbed() {
  document.body.style.opacity = "0"; // 保留布局（卡片才有尺寸可捕获）
  try {
    await document.fonts.ready.catch(() => {});
    renderCard();
    // 配图会改变卡片高度，等它加载完再测量，否则 fitScale 按无图高度算，成品位置会偏
    await mediaReady();
    measureFitScale();
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const cv = state.mode === "card" ? await capturePureCardCanvas() : await composePoster();
    const dataUrl = cv.toDataURL("image/png");
    window.__cardDataUrl = dataUrl;
    window.__cardSize = { width: cv.width, height: cv.height };

    document.body.classList.add("embed");
    document.body.style.opacity = "";
    const view = document.createElement("div");
    view.id = "embed-view";
    view.innerHTML = '<img id="embed-img" alt="tweet card" />';
    document.body.appendChild(view);
    $("embed-img").src = dataUrl;
    document.documentElement.dataset.ready = "1";
  } catch (err) {
    document.body.style.opacity = "";
    window.__cardError = String(err && err.message ? err.message : err);
    document.documentElement.dataset.ready = "error";
  }
}

/* 指令框里嵌着分享链接，任何改动 URL 参数的交互都要刷新它——包括不走 renderCard() 的轻量路径 */
function refreshAgentPrompt() {
  const box = $("agent-prompt");
  if (box) box.value = buildAgentPrompt();
}

/* 生成一段可以整个发给 AI Agent 的指令 */
function buildAgentPrompt() {
  const notes = [];
  if (state.profile.avatarData) notes.push("当前使用本机头像，链接未包含该图片；需要同样头像时，请另附文件或提供可跨域访问的图片 URL，填入 avatar 参数。");
  if (state.mode !== "card" && state.bg && !state.bg.startsWith("backgrounds/")) notes.push("当前自定义背景未包含在链接中；请另附背景文件或提供可跨域访问的图片 URL，填入 bg 参数。未补充时使用站点默认背景。");
  if (["localhost", "127.0.0.1", "[::1]"].includes(location.hostname)) notes.push("这是本地地址，仅同一台电脑上的 Agent 能直接访问。远程 Agent 可将链接和文档的站点地址改为 https://tcs.opc.tools，需确保线上版本已更新。");
  return [
    "帮我用这个网页工具生成一张推文卡片图片，步骤：",
    "",
    "1. 用浏览器打开下面这个链接（包含正文、账号文字、徽章、样式及互动数据）：",
    buildShareUrl(true),
    "",
    '2. 等待 document.documentElement.dataset.ready 变成 "1" 或 "error"。',
    '   如果是 "error"，读取 window.__cardError 并报告失败，不要继续保存图片。',
    "",
    "3. 读取 window.__cardDataUrl，它是 data:image/png;base64,... 格式，",
    "   把逗号后面的 base64 解码保存为 PNG 文件即可。尺寸见 window.__cardSize。",
    ...notes.flatMap((note) => ["", note]),
    "",
    "要换文案或样式，改链接里的参数就行，完整参数说明：" + location.origin + "/llms.txt",
  ].join("\n");
}

function buildShareUrl(embed) {
  const q = new URLSearchParams();
  const content = effectiveContent();
  if (content.text) q.set("text", content.text);
  if (content.image) q.set("img", content.image);
  // 始终固定日期和账号文字，避免跨天打开或接收方本机配置改变分享结果。
  const date = currentDate();
  if (date) q.set("date", date);
  q.set("name", state.profile.name);
  q.set("handle", state.profile.handle);
  q.set("verified", !state.profile.verified ? "0" : state.profile.badge === "gold" ? "gold" : "1");
  if (state.mode !== "poster") q.set("mode", state.mode);
  if (state.mode === "card") q.set("ratio", state.cardRatio);
  if (state.theme !== "light") q.set("theme", state.theme);
  // 与初始默认值一致的项不写进链接，保持简短（省略时页面会用同样的默认值）
  if (state.cardScale !== 95) q.set("scale", state.cardScale);
  if (state.cardOpacity !== 90) q.set("opacity", state.cardOpacity);
  if (state.bodySize !== 17) q.set("fontsize", state.bodySize);
  if (state.bgDim !== 10) q.set("dim", state.bgDim);
  if (!state.mediaOn) q.set("media", "off");
  if (Math.round(state.cardX) !== DEFAULT_CARD_X) q.set("x", Math.round(state.cardX));
  if (Math.round(state.cardY) !== DEFAULT_CARD_Y) q.set("y", Math.round(state.cardY));
  if (!state.metricsOn) q.set("metrics", "off");
  if (state.fakeMetrics) METRIC_KEYS.forEach((key) => q.set(key, state.fakeMetrics[key]));
  if (!state.guidesOn) q.set("guides", "0");
  if (state.bg && state.bg.startsWith("backgrounds/")) q.set("bg", state.bg.replace("backgrounds/", "").replace(/\.(jpg|jpeg|png|svg)$/, ""));
  if (embed) q.set("embed", "1");
  return location.origin + location.pathname + "?" + q.toString();
}

async function init() {
  const q = new URLSearchParams(location.search);
  const embedRequested = q.get("embed") === "1";
  if (embedRequested && !q.get("text")?.trim()) throw new Error("embed 渲染需要非空 text 参数");
  // embed 模式忽略本机 localStorage（保留 profile.json 默认身份），
  // 保证同一条链接在任何设备上结果一致
  await loadProfile(q.get("embed") !== "1");

  state.posts = embedRequested ? [] : await loadPosts();
  try { state.backgrounds = await fetch("backgrounds/manifest.json").then((r) => r.json()); } catch { state.backgrounds = []; }
  rollMetrics();

  const embed = await applyUrlParams();

  // 默认背景取清单第一条。URL 参数已指定时不覆盖。
  // 这件事以前藏在 renderBackgroundGrid() 里，网格改成会反复重渲染后必须挪出来。
  if (!state.bg && state.backgrounds.length) setBg("backgrounds/" + state.backgrounds[0].file);

  if (embed) {
    await runEmbed();
    return;
  }

  refreshLibrary();
  bind();
  syncSliderInputs();
  syncToggleButtons();
  applyImporterCfgToInputs();
  initDrag();
  renderBackgroundGrid();
  fitStageScale();
  window.addEventListener("resize", fitStageScale);
  if (state.tab === "custom") { $("custom-text").value = state.customText; $("tab-custom").click(); }
  else if (state.filtered.length || state.posts.length) selectPost(state.filtered[0] || state.posts[0]);

}

init().catch((err) => {
  if (new URLSearchParams(location.search).get("embed") === "1") {
    window.__cardError = String(err && err.message ? err.message : err);
    document.documentElement.dataset.ready = "error";
  } else {
    console.error("页面初始化失败：", err);
  }
});
