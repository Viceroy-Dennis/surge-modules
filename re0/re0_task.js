// RE0 (re0.me) 每日自动签到 (Surge Cron / Generic 兼容)
// 专为穿透 Cloudflare 盾墙与 Next.js Server Action 体系设计：
// 1. 直接回放动作 POST，避开触发 CF 挑战的首页与 JS 扫描
// 2. 携带 Safari 真实 UA 与 cf_clearance，严格对齐浏览器指纹
// 3. 严格按需刷新令牌：仅在 428/409 时换令牌重试，绝不在 200 参数错误时无谓重试
// 4. 严谨的结果解析：精确提取具体积分点数，坚决杜绝页面壳假成功
// 5. 快速容灾轮询：单次流程控制在 2 秒内，遇参数错误秒切候选 ID，杜绝 Surge 5s 超时

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

function extractPoints(text) {
  const m1 = text.match(/(?:获得|奖励|增加|\+)\s*(\d+)\s*(?:点数|积分|点|分)/i);
  if (m1) return `+${m1[1]} 积分`;
  const m2 = text.match(/"(?:points|reward|score|integral|coin|gain)"\s*:\s*"?(\d+)/i);
  if (m2) return `+${m2[1]} 积分`;
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

  // 严格的签到动作成功判断（必须出现签到相关的核心业务词，坚决排除“完成”等泛词）
  const ok = /(?:签到成功|已签到|重复签到|明日再来|今日已签|已经签到|签到过了)/.test(text) ||
    (/"success"\s*:\s*true/.test(text) && !/^\s*\d+:"\$/.test(text)) ||
    /"alreadyCheckedIn"\s*:\s*true/.test(text);

  let idExpired = false;
  for (const k in headers || {}) {
    if (String(k).toLowerCase() === "x-nextjs-action-not-found") idExpired = true;
  }
  if (Number(status) === 404 && !ok) idExpired = true;

  // 页面 flight 壳识别：如果返回 $Sreact.fragment 且没有真正的签到成功标志
  let pageFlight = false;
  if (!ok && (text.includes("$Sreact.fragment") || /^\s*\d+:"\$/.test(text))) {
    pageFlight = true;
    if (!msg) msg = "返回页面渲染而非接口结果（Action ID 未生效）";
  }

  const points = extractPoints(text);
  if (points && ok) {
    if (!msg.includes(points)) {
      msg = msg ? `${msg} (${points})` : `签到成功 (${points})`;
    }
  }

  return { ok, status, code, msg, raw: text, headers: headers || {}, pageFlight, idExpired, points };
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
  h["x-surge-task"] = "1"; // 防回环
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
          idExpired: false,
          points: ""
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
  console.log(`[${NAME}] POST (act=${actId.slice(0, 8)}..., body=${bodyPayload}): HTTP ${res.status}, ok=${res.ok}, msg=${res.msg || (res.raw ? res.raw.slice(0, 60).replace(/[\r\n]+/g, " ") : "空")}`);

  // 2. 检查 Cloudflare 盾墙拦截
  const cf = checkCfChallenge(res.status, res.headers, res.raw);
  if (cf) {
    res.cfBlocked = true;
    res.cfReason = cf;
    return res;
  }

  // 3. 严格按需令牌刷新：仅在 428 / 409 / 安全验证拦截时重发，绝不在普通的 200 参数错误时盲目重发！
  const newToken = extractHdhToken(res.headers);
  if (newToken) {
    const freshCookie = putCookie(cookie, "hdh_sa_token", newToken);
    $persistentStore.write(freshCookie, K_COOKIE);
    headers.cookie = freshCookie;

    const needResend = (
      res.status === 428 ||
      res.status === 409 ||
      res.code === "action_token_required" ||
      res.code === "action_token_invalid" ||
      /安全验证|token_required|token_invalid/i.test(res.msg || "")
    );

    if (needResend) {
      console.log(`[${NAME}] 检测到安全验证拦截 (HTTP ${res.status})，自动换令牌重发...`);
      res = await rawSend(url, headers, bodyPayload);
      console.log(`[${NAME}] 换令牌重试结果: HTTP ${res.status}, ok=${res.ok}, msg=${res.msg || "完成"}`);
    }
  }

  return res;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const cookie = $persistentStore.read(K_COOKIE) || "";
  const primaryAct = $persistentStore.read(K_ACT) || "";
  const capturedUrl = $persistentStore.read(K_URL) || DEFAULT_HOME;
  const capturedBody = $persistentStore.read(K_BODY) || "";

  if (!cookie) {
    const msg = "未找到 Cookie，请用 Safari 登录 re0.me 并点一次签到";
    $notification.post(NAME, "缺少登录凭据", msg);
    $done({ summary: msg });
    return;
  }

  // 收集候选 Action ID 列表（严格去除前后空格与重复）
  let storedCandidates = [];
  try { storedCandidates = JSON.parse($persistentStore.read(K_CANDIDATES) || "[]"); } catch (e) {}

  const defaults = [
    "607756f296316ef5449089aa14bc8b832b4b455b",
    "4080a19f61b033d52674e2d36d814ec9786a3473",
    "40f972f3a8cf85e02707086ff7d726851fec314e39"
  ];

  const candidateIds = [
    primaryAct,
    ...storedCandidates,
    ...defaults
  ].map(x => String(x || '').trim().toLowerCase())
   .filter((id, idx, arr) => id && id.length >= 20 && arr.indexOf(id) === idx);

  if (!candidateIds.length) {
    const msg = "未找到 Action ID，请用 Safari 打开 re0.me 并在页面内手动点一次签到";
    $notification.post(NAME, "缺少 Action ID", msg);
    $done({ summary: msg });
    return;
  }

  console.log(`[${NAME}] 候选 Action ID 池: ${candidateIds.map(x => x.slice(0, 8)).join(", ")}`);

  // 确定请求参数策略
  let bodiesToTry = ["[false]", "[]"];
  if (capturedBody && (capturedBody.startsWith("[") || capturedBody.startsWith("{"))) {
    bodiesToTry = [capturedBody, "[false]", "[]"].filter((b, idx, arr) => arr.indexOf(b) === idx);
  }

  let finalRes = null;
  let successAct = "";

  for (let i = 0; i < candidateIds.length; i++) {
    const act = candidateIds[i];
    console.log(`[${NAME}] 尝试第 ${i + 1}/${candidateIds.length} 个 Action ID (${act.slice(0, 8)}...)...`);

    for (const bodyStr of bodiesToTry) {
      const res = await sendAction(capturedUrl, act, bodyStr);

      if (res.cfBlocked) {
        const cfMsg = "❌ Cloudflare 盾墙拦截 (cf_clearance 过期)\n💡 请用 Safari 打开一次 re0.me 刷新人机验证，再运行任务！";
        $notification.post(NAME, "盾墙拦截 (需过 CF 验证)", cfMsg);
        $done({ summary: cfMsg });
        return;
      }

      if (res.ok) {
        finalRes = res;
        successAct = act;
        $persistentStore.write(act, K_ACT); // 锁存成功 Action ID
        console.log(`[${NAME}] 🎉 签到成功！锁存 Action ID: ${act} (body=${bodyStr})`);
        break;
      }

      finalRes = res;
      // 如果报参数错误，继续用下一个 bodyStr 尝试同一个 action；如果报别的错误直接切下一个 action
      if (!res.msg.includes("请求参数错误")) break;
    }

    if (finalRes && finalRes.ok) break;
    if (i < candidateIds.length - 1) await sleep(150);
  }

  // 最终结论呈现
  let notifyTitle = "";
  let notifyBody = "";

  if (finalRes && finalRes.ok) {
    notifyTitle = "签到完成";
    notifyBody = `每日签到: ${finalRes.msg || "签到成功"}\n(Action ID: ${successAct.slice(0, 8)}...)`;
  } else {
    notifyTitle = "签到未达成";
    const serverEcho = finalRes ? (finalRes.msg || (finalRes.raw ? finalRes.raw.slice(0, 80).replace(/[\r\n]+/g, " ") : `HTTP ${finalRes.status}`)) : "无响应";
    notifyBody = `状态: ${serverEcho}\n💡 所有候选 Action ID 均未生效，请在 Safari 打开 re0.me 并在页面内手动点一次【签到】刷新 Action ID！`;
  }

  console.log(`[${NAME}] 最终结论 -> ${notifyTitle}: ${notifyBody}`);
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
