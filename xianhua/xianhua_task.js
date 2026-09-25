// 三国咸话 —— Surge 每日自动任务 (双通道独立凭据版本)
// 包含：打开小程序任务 + 每日签到 + 浏览帖子 3 次 + 任务进度核验
// 1. wxforum 签到通道：读取 sgxh_token_wx (HS256)
// 2. api-xh 社区通道：读取 sgxh_token_xh (RS256)
// 严防混用，绝不出现 Unsupported algorithm of HS256！

const NAME = "三国咸话";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const COOKIE_KEY = "sgxh_cookie";

// 兼容旧键
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";

const OPEN_URL = "https://wxforum.sanguosha.cn/api/openMiniApp";
const SIGN_URL = "https://wxforum.sanguosha.cn/api/user/signIn";
const PROGRESS_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/updateTaskProgress";
const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

const DROP = { host: 1, connection: 1, "keep-alive": 1, "proxy-connection": 1, "transfer-encoding": 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1 };

function isHs256Jwt(tok) {
  return String(tok || "").includes("eyJhbGciOiJIUzI1Ni");
}

function savedHeaders(url) {
  const isXh = url.includes("api-xh") || url.includes("xh.sanguosha.cn") || url.includes("api-forum-act");
  const isWx = url.includes("wxforum");

  let hdrRaw = "";
  let tokRaw = "";

  if (isXh) {
    hdrRaw = $persistentStore.read(HDR_XH_KEY) || "";
    tokRaw = $persistentStore.read(TOKEN_XH_KEY) || "";

    // 只有当通用键不是 HS256 时，才允许兜底给 api-xh
    if (!tokRaw) {
      const fallbackTok = $persistentStore.read(TOKEN_KEY) || "";
      if (fallbackTok && !isHs256Jwt(fallbackTok)) {
        tokRaw = fallbackTok;
        hdrRaw = $persistentStore.read(HEADER_KEY) || "{}";
      }
    }
  } else if (isWx) {
    hdrRaw = $persistentStore.read(HDR_WX_KEY) || $persistentStore.read(HEADER_KEY) || "{}";
    tokRaw = $persistentStore.read(TOKEN_WX_KEY) || $persistentStore.read(TOKEN_KEY) || "";
  } else {
    hdrRaw = $persistentStore.read(HEADER_KEY) || "{}";
    tokRaw = $persistentStore.read(TOKEN_KEY) || "";
  }

  let saved = {};
  try { saved = JSON.parse(hdrRaw || "{}"); } catch (e) {}

  const h = {};
  for (const key in saved) {
    const k = String(key).toLowerCase();
    if (DROP[k]) continue;
    if (saved[key] === undefined || saved[key] === null || saved[key] === "") continue;
    h[k] = String(saved[key]);
  }

  if (tokRaw && !h.authorization && !h.token && !h["x-token"]) {
    h.authorization = tokRaw;
  }

  const cookie = $persistentStore.read(COOKIE_KEY);
  if (cookie && !h.cookie) {
    h.cookie = cookie;
  }

  return { headers: h, token: tokRaw };
}

function headersFor(url) {
  const { headers } = savedHeaders(url);
  const route = String(url).replace(/^https?:\/\/[^/]+/i, "") || "/";
  headers["current-uri"] = route;
  headers["content-type"] = "application/json";
  headers.accept = headers.accept || "application/json, text/plain, */*";
  headers.origin = headers.origin || "https://xianhua.sanguosha.cn";
  headers.referer = headers.referer || "https://xianhua.sanguosha.cn/";
  return headers;
}

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

function messageOf(body) {
  const j = parseJSON(body);
  if (!j) return String(body || "").slice(0, 100) || "空响应";
  return j.message || j.msg || (j.data && (j.data.message || j.data.msg)) || (j.success === true ? "成功" : "请求完成");
}

function isAuthError(r) {
  if (r.status === 401 || r.status === 403) return true;
  const str = String(r.body || "");
  if (str.indexOf("未登录") !== -1 || str.indexOf("token已经过期") !== -1 || str.indexOf("token过期") !== -1 || str.indexOf("token失效") !== -1 || str.indexOf("Unsupported algorithm") !== -1) {
    return true;
  }
  return false;
}

function result(label, r) {
  if (r.error) return `${label}: 请求失败 (${r.error})`;
  if (isAuthError(r)) return `${label}: 凭据失效 (${messageOf(r.body)})`;
  if (r.status >= 200 && r.status < 300) return `${label}: ${messageOf(r.body)}`;
  return `${label}: HTTP ${r.status} ${messageOf(r.body)}`;
}

function postJson(url, payload) {
  return new Promise((resolve) => {
    $httpClient.post({
      url: url,
      headers: headersFor(url),
      body: JSON.stringify(payload || {})
    }, (error, response, body) => {
      if (error) {
        resolve({ url, status: 0, error: String(error), body: "" });
      } else {
        resolve({
          url,
          status: Number(response && (response.status || response.statusCode)) || 0,
          error: "",
          body: String(body || "")
        });
      }
    });
  });
}

function getJson(url) {
  return new Promise((resolve) => {
    $httpClient.get({
      url: url,
      headers: headersFor(url)
    }, (error, response, body) => {
      if (error) {
        resolve({ url, status: 0, error: String(error), body: "" });
      } else {
        resolve({
          url,
          status: Number(response && (response.status || response.statusCode)) || 0,
          error: "",
          body: String(body || "")
        });
      }
    });
  });
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const wxCred = savedHeaders(OPEN_URL);
  const xhCred = savedHeaders(PROGRESS_URL);

  if (!wxCred.token && !xhCred.token) {
    const msg = "未检测到凭据，请在微信中打开一次「三国咸话」小程序自动保存";
    console.log(`[${NAME}] ${msg}`);
    $notification.post(NAME, "未检测到凭据", msg);
    $done({ summary: msg });
    return;
  }

  const rows = [];

  // 1. 打开小程序任务
  rows.push(result("打开任务", await postJson(OPEN_URL, { flag: 1 })));
  await sleep(400);

  // 2. 每日签到
  rows.push(result("每日签到", await postJson(SIGN_URL, {})));
  await sleep(400);

  // 3. 浏览任务 (必须使用 api-xh 社区 Token)
  if (!xhCred.token) {
    rows.push("浏览任务: ⚠️ 缺少社区专属 Token (请在微信咸话点击【任务】或【社区】页面抓取)");
    rows.push("任务查询: ⚠️ 缺少社区专属 Token");
  } else {
    for (let i = 1; i <= 3; i++) {
      const progRes = await postJson(PROGRESS_URL, { operateType: 1 });
      rows.push(result(`浏览帖子 ${i}/3`, progRes));
      console.log(`[${NAME}] 浏览上报 #${i}: HTTP ${progRes.status} ${messageOf(progRes.body)}`);
      if (i < 3) await sleep(600);
    }

    await sleep(800);

    // 4. 任务状态查询
    const listRes = await getJson(LIST_URL);
    rows.push(result("任务查询", listRes));
  }

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);

  const hasExpired = rows.some((x) => x.includes("凭据失效") || x.includes("401") || x.includes("403"));
  const title = hasExpired ? "每日任务 (部分通道失效)" : "每日任务执行完成";

  $notification.post(NAME, title, text);
  $done({ summary: text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中执行此脚本" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "脚本运行异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
