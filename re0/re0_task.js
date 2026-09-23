// RE0 (re0.me) 每日自动签到 (Surge Cron / Generic 兼容)
// 专门设计越过 Cloudflare 盾墙与 Next.js Server Action 校验体系：
// 1. 直接回放动作 POST，完全避开会触发 CF 挑战的首页与 JS 扫描
// 2. 严格匹配抓包时 Safari 的真实 User-Agent，与 cf_clearance 保持完全一致
// 3. 自动识别 428 / 409，从 Set-Cookie 中提取最新的 hdh_sa_token 并自动换令牌重试
// 4. 精确识别 Action ID 过期（Next.js 重新部署）并提示用户手动点一次签到刷新

const NAME = "RE0签到";
const K_COOKIE = "re0_cookie";
const K_HDR = "re0_headers";
const K_URL = "re0_url";
const K_BODY = "re0_body";
const K_ACT = "re0_action";
const K_UA = "re0_ua";

const DEFAULT_HOME = "https://re0.me/";
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const HOP = ["host", "connection", "content-length", "accept-encoding", "content-encoding", "transfer-encoding", "proxy-connection"];

function cookieMap(s) {
  const o = {};
  String(s || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

function cookieString(map) {
  return Object.keys(map).map((k) => `${k}=${map[k]}`).join("; ");
}

function putCookie(s, key, value) {
  const m = cookieMap(s);
  m[key] = value;
  return cookieString(m);
}

function removeCookie(s, key) {
  const m = cookieMap(s);
  delete m[key];
  return cookieString(m);
}

function extractHdhToken(headers) {
  let v = "";
  for (const k in headers || {}) {
    if (String(k).toLowerCase() === "set-cookie") {
      v = Array.isArray(headers[k]) ? headers[k].join(",") : String(headers[k]);
      break;
    }
  }
  const m = String(v || "").match(/(?:^|[,\s])hdh_sa_token=([^;,\s]+)/i);
  return m ? m[1] : "";
}

function checkCfChallenge(status, headers, body) {
  const h = headers || {};
  let cf = "";
  for (const k in h) {
    if (String(k).toLowerCase() === "cf-mitigated") cf = String(h[k]);
  }
  const str = String(body || "");
  if (/just a moment|challenge-platform|_cf_chl_opt/i.test(str) || (Number(status) === 403 && (cf || /cloudflare/i.test(str)))) {
    return cf || "challenge";
  }
  return "";
}

function parseResponse(status, headers, raw) {
  const text = String(raw || "");
  let code = "", msg = "";
  try {
    const j = JSON.parse(text);
    code = String(j.code || "");
    msg = String(j.message || "");
  } catch (e) {}

  if (!msg) {
    const m = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)+)"/);
    if (m) msg = m[1];
  }

  // 页面 flight 壳识别：返回页面而非接口结果 -> 动作没有被执行
  let pageFlight = false;
  if (!code && (/^\s*\d+:"\$/.test(text) || /\$Sreact\./.test(text))) {
    pageFlight = true;
    if (!msg) msg = "返回渲染页面而非接口结果（Action ID 可能已过期）";
  }

  // 识别站点重部署导致的 Action ID 过期
  let idExpired = false;
  for (const k in headers || {}) {
    if (String(k).toLowerCase() === "x-nextjs-action-not-found") idExpired = true;
  }
  if (Number(status) === 404) idExpired = true;

  const ok = /签到成功|已签到|重复签到|明日再来|今日已签/.test(text) || /"success"\s*:\s*true/.test(text);

  return { ok, status, code, msg, raw: text, headers: headers || {}, pageFlight, idExpired };
}

function buildHeaders(targetUrl, bodyPayload) {
  let saved = {};
  try {
    saved = JSON.parse($persistentStore.read(K_HDR) || "{}");
  } catch (e) {}

  const ua = $persistentStore.read(K_UA) || saved["user-agent"] || DEFAULT_UA;
  const cookie = $persistentStore.read(K_COOKIE) || saved.cookie || "";
  const actId = $persistentStore.read(K_ACT) || saved["next-action"] || "";

  const h = {};
  Object.keys(saved).forEach((k) => {
    const lk = String(k).toLowerCase();
    if (!HOP.includes(lk) && saved[k] !== undefined && saved[k] !== null && saved[k] !== "") {
      h[lk] = String(saved[k]);
    }
  });

  h["content-type"] = "text/plain;charset=UTF-8";
  h["accept"] = "text/x-component";
  h["origin"] = "https://re0.me";
  h["referer"] = targetUrl || DEFAULT_HOME;
  h["user-agent"] = ua;
  h["cookie"] = cookie;
  if (actId) h["next-action"] = actId;

  return { headers: h, ua, cookie, actId };
}

function rawSend(url, headers, body) {
  return new Promise((resolve) => {
    $httpClient.post({
      url: url,
      headers: headers,
      body: body
    }, (error, response, resBody) => {
      if (error) {
        resolve({
          ok: false,
          status: 0,
          code: "",
          msg: `网络请求失败 (${error})`,
          raw: "",
          headers: {},
          pageFlight: false,
          idExpired: false
        });
      } else {
        const status = Number(response && (response.status || response.statusCode)) || 0;
        const resHeaders = response && response.headers ? response.headers : {};
        resolve(parseResponse(status, resHeaders, resBody));
      }
    });
  });
}

async function sendAction(url, bodyPayload) {
  const { headers, cookie } = buildHeaders(url, bodyPayload);

  // 1. 尝试先剥离旧 hdh_sa_token 发送，或者直接发送
  let res = await rawSend(url, headers, bodyPayload);
  console.log(`[${NAME}] POST HTTP ${res.status}: ${res.msg || (res.raw ? res.raw.slice(0, 100) : "空响应")}`);

  // 2. 检查是否触发 Cloudflare 盾墙拦截
  const cf = checkCfChallenge(res.status, res.headers, res.raw);
  if (cf) {
    res.cfBlocked = true;
    res.cfReason = cf;
    return res;
  }

  // 3. 检查是否需要更新安全令牌 (428 / 409 / action_token_required)
  const newToken = extractHdhToken(res.headers);
  if (newToken) {
    console.log(`[${NAME}] 检测到新的 hdh_sa_token，自动换令牌重试...`);
    const freshCookie = putCookie(cookie, "hdh_sa_token", newToken);
    $persistentStore.write(freshCookie, K_COOKIE);
    headers.cookie = freshCookie;
    res = await rawSend(url, headers, bodyPayload);
    console.log(`[${NAME}] 换令牌重试后: HTTP ${res.status}: ${res.msg || (res.raw ? res.raw.slice(0, 100) : "完成")}`);
  }

  return res;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const cookie = $persistentStore.read(K_COOKIE) || "";
  const actId = $persistentStore.read(K_ACT) || "";
  const targetUrl = $persistentStore.read(K_URL) || DEFAULT_HOME;

  if (!cookie) {
    const msg = "未找到 Cookie，请用 Safari 登录 re0.me 并点一次签到";
    $notification.post(NAME, "缺少登录凭据", msg);
    $done({ summary: msg });
    return;
  }

  if (!actId) {
    const msg = "未找到 Action ID，请用 Safari 打开 re0.me 并在页面内手动点一次签到";
    $notification.post(NAME, "缺少 Action ID", msg);
    $done({ summary: msg });
    return;
  }

  // 读取模块参数 mode: daily (默认) / gamble (赌狗) / both (双签)
  const mode = (() => {
    try {
      const v = String(typeof $argument !== "undefined" ? $argument : "daily").toLowerCase().trim();
      return v === "gamble" || v === "both" ? v : "daily";
    } catch (e) {
      return "daily";
    }
  })();

  const results = [];

  // 执行每日签到
  if (mode === "daily" || mode === "both") {
    console.log(`[${NAME}] 正在执行每日签到 (body=[false])...`);
    const res = await sendAction(targetUrl, "[false]");

    if (res.cfBlocked) {
      const cfMsg = "❌ Cloudflare 盾墙拦截 (cf_clearance 过期)\n💡 请用 Safari 打开一次 re0.me 完成人机验证，再运行任务！";
      console.log(`[${NAME}] ${cfMsg}`);
      $notification.post(NAME, "盾墙拦截 (需过 CF 验证)", cfMsg);
      $done({ summary: cfMsg });
      return;
    }

    if (res.idExpired || res.pageFlight) {
      const expMsg = "⚠️ Action ID 已失效（站点已更新）\n💡 请用 Safari 打开 re0.me 在页面内手动点一次签到刷新 ID";
      console.log(`[${NAME}] ${expMsg}`);
      $notification.post(NAME, "Action ID 已过期", expMsg);
      $done({ summary: expMsg });
      return;
    }

    results.push(`每日签到: ${res.ok ? (res.msg || "签到成功") : (res.msg || `失败 (HTTP ${res.status})`)}`);
  }

  // 执行赌狗签到
  if (mode === "gamble" || mode === "both") {
    if (results.length > 0) await sleep(2000);
    console.log(`[${NAME}] 正在执行赌狗签到 (body=[true])...`);
    const res = await sendAction(targetUrl, "[true]");

    if (!res.cfBlocked && !res.idExpired && !res.pageFlight) {
      results.push(`赌狗签到: ${res.ok ? (res.msg || "签到成功") : (res.msg || `失败 (HTTP ${res.status})`)}`);
    } else {
      results.push(`赌狗签到: 未能完成`);
    }
  }

  const text = results.join("\n");
  console.log(`[${NAME}]\n${text}`);
  const allOk = results.every((r) => r.includes("成功") || r.includes("已签") || r.includes("重复"));
  $notification.post(NAME, allOk ? "签到完成" : "签到结果", text);
  $done({ summary: text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中执行此脚本" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 脚本异常: ${e}`);
    $notification.post(NAME, "脚本运行异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
