/* 抓取推文的同源转发层（Cloudflare Pages Function → /api/importer）。
   存在的唯一理由：importer-x 服务不发 CORS 头（OPTIONS 预检直接 405），
   浏览器没法直连，必须由服务端中转。 */

const DEFAULT_UPSTREAM = "https://importer-x.hitu.me/import/twitter";
const DEFAULT_ALLOW_HOSTS = ["importer-x.hitu.me"];

/* 上游地址允许前端配置，所以必须白名单校验：否则这个 Function 就是一个
   开放代理，任何人都能借 Cloudflare 的出口去打任意地址（SSRF）。 */
function resolveUpstream(raw, env) {
  const allow = (env.IMPORTER_ALLOW_HOSTS || "")
    .split(",").map((s) => s.trim()).filter(Boolean);
  const hosts = allow.length ? allow : DEFAULT_ALLOW_HOSTS;
  let u;
  try {
    u = new URL(raw || env.X_IMPORTER_URL || DEFAULT_UPSTREAM);
  } catch {
    return { error: "接口地址不是合法的 URL" };
  }
  if (u.protocol !== "https:") return { error: "接口地址必须是 https" };
  if (!hosts.includes(u.hostname)) {
    return { error: `接口地址 ${u.hostname} 不在允许列表内（${hosts.join(", ")}）` };
  }
  return { url: u.toString() };
}

const json = (data, status) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });

export async function onRequestPost({ request, env }) {
  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, error: "请求体不是合法 JSON" }, 400);
  }

  const tweetUrl = (body && body.url ? String(body.url) : "").trim();
  if (!tweetUrl) return json({ ok: false, error: "缺少推文链接" }, 400);

  // token 走请求头而不是 body——body 更容易被各层日志留存
  const token = request.headers.get("x-importer-token") || env.X_IMPORTER_TOKEN || "";
  if (!token) {
    return json({ ok: false, error: "没有配置访问令牌，请在「在线抓取」的设置里填写" }, 401);
  }

  const upstream = resolveUpstream(request.headers.get("x-importer-url"), env);
  if (upstream.error) return json({ ok: false, error: upstream.error }, 400);

  // 文档允许 10–180 秒；取 90 留出余量，降低 Function 侧等待超时的概率
  const timeoutSeconds = Math.min(180, Math.max(10, Number(body.timeoutSeconds) || 90));

  try {
    const res = await fetch(upstream.url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ url: tweetUrl, includeRaw: false, timeoutSeconds }),
      signal: AbortSignal.timeout((timeoutSeconds + 15) * 1000),
    });

    const text = await res.text();
    // 原样透传状态码，前端按 401/502/504 给出对应提示
    return new Response(text, {
      status: res.status,
      headers: { "content-type": "application/json; charset=utf-8" },
    });
  } catch (err) {
    const timedOut = err && (err.name === "TimeoutError" || err.name === "AbortError");
    return json(
      { ok: false, error: timedOut ? "抓取超时，稍后再试" : "连接抓取服务失败：" + (err && err.message) },
      timedOut ? 504 : 502
    );
  }
}
