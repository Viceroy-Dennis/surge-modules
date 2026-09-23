// RE0 (re0.me) 每日自动签到 (Surge Cron / Generic 兼容)
// 专为穿透 Cloudflare 盾墙与 Next.js Server Action 体系设计：
// 1. 直接回放动作 POST，避开触发 CF 挑战的首页与 JS 扫描
// 2. 携带 Safari 真实 UA 与 cf_clearance，严格对齐指纹
// 3. 自动识别 428 / 409 安全令牌，自动刷新重发
// 4. 真实 RSC 智能解析：消除 Flight 壳误报，精准提取签到结果与奖励信息
// 5. 候选 Action ID 容灾：首选失败自动尝试备用 ID

const NAME = "RE0签到";
const K_COOKIE = "re0_cookie";
const K_HDR = "re0_headers";
const K_URL = "re0_url";
const K_BODY = "re0_body";
const K_ACT = "re0_action";
const K_UA = "re0_ua";
const K_CANDIDATES = "re0_candidate_actions";

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
    msg = String(j.message || j.msg || "");
  } catch (e) {}

  if (!msg) {
    const m = text.match(/"message"\s*:\s*"((?:[^"\\]|\\.)+)"/);
    if (m) msg = m[1];
  }

  // 成功或已有结果的标志匹配（涵盖各种成功/重复提示）
  const ok = /签到成功|已签到|重复签到|明日再来|今日已签|已经签到|签到过了|完成/.test(text) ||
    /"success"\s*:\s*true/.test(text) ||
    /"alreadyCheckedIn"\s*:\s*true/.test(text);

  let idExpired = false;
  for (const k in headers || {}) {
    if (String(k).toLowerCase() === "x-nextjs-action-not-found") idExpired = true;
  }
  if (Number(status) === 404 && !ok) idExpired = true;

  // 仅在明确未成功且没有任何业务提示时，整页渲染才视为空壳
  let pageFlight = false;
  if (!ok && !msg && !code && (text.includes("$Sreact.fragment") || /^\s*\d+:"\$/.test(text))) {
    pageFlight = true;
  }

  return { ok, status, code, msg, raw: text, headers: headers || {}, pageFlight, idExpired };
}

function buildHeaders(targetUrl, actId) {
  let saved = {};
  try {
    saved = JSON.parse($persistentStore.read(K_HDR) || "{}");
  } catch (e) {}

  const ua = $persistentStore.read(K_UA) || saved["user-agent"] || DEFAULT_UA;
  const cookie = $persistentStore.read(K_COOKIE) || saved.cookie || "";

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
  h["x-surge-task"] = "1"; // 防回环：通知抓包跳过本请求
  if (actId) h["next-action"] = actId;

  return { headers: h, ua, cookie };
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

async function sendAction(url, actId, bodyPayload) {
  const { headers, cookie } = buildHeaders(url, actId);

  // 1. 发起请求
  let res = await rawSend(url, headers, bodyPayload);
  console.log(`[${NAME}] POST (act=${actId.slice(0, 8)}...): HTTP ${res.status}, ok=${res.ok}, msg=${res.msg || (res.raw ? res.raw.slice(0, 80) : "空")}`);

  // 2. 检查 Cloudflare 盾墙拦截
  const cf = checkCfChallenge(res.status, res.headers, res.raw);
  if (cf) {
    res.cfBlocked = true;
    res.cfReason = cf;
    return res;
  }

  // 3. 检查安全令牌刷新 (428 / 409)
  const newToken = extractHdhToken(res.headers);
  if (newToken) {
    console.log(`[${NAME}] 检测到新的 hdh_sa_token，自动换令牌重发...`);
    const freshCookie = putCookie(cookie, "hdh_sa_token", newToken);
    $persistentStore.write(freshCookie, K_COOKIE);
    headers.cookie = freshCookie;
    res = await rawSend(url, headers, bodyPayload);
    console.log(`[${NAME}] 换令牌重试结果: HTTP ${res.status}, ok=${res.ok}, msg=${res.msg || "完成"}`);
  }

  return res;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const cookie = $persistentStore.read(K_COOKIE) || "";
  const primaryAct = $persistentStore.read(K_ACT) || "";
  const capturedBody = $persistentStore.read(K_BODY) || "[false]";
  const targetUrl = $persistentStore.read(K_URL) || DEFAULT_HOME;

  if (!cookie) {
    const msg = "未找到 Cookie，请用 Safari 登录 re0.me 并在页面内点一次签到";
    $notification.post(NAME, "缺少登录凭据", msg);
    $done({ summary: msg });
    return;
  }

  // 收集可用的 Action ID 列表（包含捕获的主 ID，以及历史已验证的候选 ID）
  const candidateIds = [
    primaryAct,
    "4080a19f61b033d52674e2d36d814ec9786a3473",
    "607756f296316ef5449089aa14bc8b832b4b455b",
    "40f972f3a8cf85e02707086ff7d726851fec314e39"
  ].filter((id, idx, arr) => id && id.length >= 20 && arr.indexOf(id) === idx);

  if (!candidateIds.length) {
    const msg = "未找到 Action ID，请用 Safari 打开 re0.me 并在页面内手动点一次签到";
    $notification.post(NAME, "缺少 Action ID", msg);
    $done({ summary: msg });
    return;
  }

  console.log(`[${NAME}] 准备执行签到，候选 Action ID: ${candidateIds.map(x => x.slice(0, 8)).join(", ")}`);

  let finalRes = null;
  let successAct = "";

  // 逐个尝试候选 Action ID 直到成功或全败
  for (let i = 0; i < candidateIds.length; i++) {
    const curAct = candidateIds[i];
    console.log(`[${NAME}] 尝试第 ${i + 1}/${candidateIds.length} 个 Action ID (${curAct.slice(0, 8)}...)...`);
    const res = await sendAction(targetUrl, curAct, capturedBody);

    if (res.cfBlocked) {
      const cfMsg = "❌ Cloudflare 盾墙拦截 (cf_clearance 过期)\n💡 请用 Safari 打开一次 re0.me 刷新人机验证，再运行任务！";
      $notification.post(NAME, "盾墙拦截 (需过 CF 验证)", cfMsg);
      $done({ summary: cfMsg });
      return;
    }

    if (res.ok) {
      finalRes = res;
      successAct = curAct;
      // 成功锁存最优 Action ID
      $persistentStore.write(curAct, K_ACT);
      break;
    }

    finalRes = res;
    if (i < candidateIds.length - 1) await sleep(800);
  }

  // 汇总结果
  let notifyTitle = "签到结果";
  let notifyBody = "";

  if (finalRes && finalRes.ok) {
    notifyTitle = "签到完成";
    notifyBody = `每日签到: ${finalRes.msg || "签到成功"}\n(Action ID: ${successAct.slice(0, 8)}...)`;
  } else {
    notifyTitle = "签到异常";
    const serverEcho = finalRes ? (finalRes.msg || (finalRes.raw ? finalRes.raw.slice(0, 120) : `HTTP ${finalRes.status}`)) : "无响应";
    notifyBody = `状态: ${serverEcho}\n💡 若提示过期，请在 Safari 页面内手动点一次签到更新 Action ID`;
  }

  console.log(`[${NAME}] 结果 -> ${notifyTitle}: ${notifyBody}`);
  $notification.post(NAME, notifyTitle, notifyBody);
  $done({ summary: notifyBody });
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
