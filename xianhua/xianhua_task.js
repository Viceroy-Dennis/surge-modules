// 三国咸话 —— Surge 每日自动任务 (100% 复刻 QX 经典稳定版本 xianhua.qx.auto2.js)
// 包含：打开小程序任务 + 每日签到 + 浏览帖子 3 次 + 任务列表核验
// 干净纯粹，无多余逻辑，绝不超时

const NAME = "三国咸话";
const HEADER_KEY = "sgxh_headers";
const COOKIE_KEY = "sgxh_cookie";
const TOKEN_KEY = "sgxh_token";

const OPEN_URL = "https://wxforum.sanguosha.cn/api/openMiniApp";
const SIGN_URL = "https://wxforum.sanguosha.cn/api/user/signIn";
const PROGRESS_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/updateTaskProgress";
const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

const DROP = { host: 1, connection: 1, "keep-alive": 1, "proxy-connection": 1, "transfer-encoding": 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1 };

function savedHeaders() {
  let saved = {};
  try {
    saved = JSON.parse($persistentStore.read(HEADER_KEY) || "{}");
  } catch (e) {}
  const h = {};
  Object.keys(saved).forEach((key) => {
    const k = String(key).toLowerCase();
    if (!DROP[k] && saved[key] !== undefined && saved[key] !== null && saved[key] !== "") {
      h[k] = String(saved[key]);
    }
  });
  const cookie = $persistentStore.read(COOKIE_KEY);
  if (cookie) h.cookie = cookie;
  const token = $persistentStore.read(TOKEN_KEY);
  if (token && !h.authorization && !h.token && !h["x-token"] && !h["x-auth-token"]) {
    h.authorization = token;
  }
  return h;
}

function headersFor(url) {
  const h = savedHeaders();
  h["current-uri"] = String(url).replace(/^https?:\/\/[^/]+/i, "") || "/";
  h["content-type"] = "application/json";
  h.accept = h.accept || "application/json, text/plain, */*";
  h.origin = h.origin || "https://xianhua.sanguosha.cn";
  h.referer = h.referer || "https://xianhua.sanguosha.cn/";
  return h;
}

function hasCredential() {
  const h = savedHeaders();
  return Boolean(h.authorization || h.token || h["x-token"] || h["x-auth-token"] || h.cookie);
}

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

function messageOf(body) {
  const j = parseJSON(body);
  if (!j) return String(body || "").slice(0, 100) || "空响应";
  return j.message || j.msg || (j.data && (j.data.message || j.data.msg)) || (j.success === true ? "成功" : "请求完成");
}

function result(label, r) {
  if (r.error) return `${label}: 请求失败 (${r.error})`;
  if (r.status === 401 || r.status === 403) return `${label}: 登录凭据失效`;
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
  if (!hasCredential()) {
    const msg = "未检测到凭据，请在微信中打开一次「三国咸话」小程序自动保存";
    console.log(`[${NAME}] ${msg}`);
    $notification.post(NAME, "未检测到凭据", msg);
    $done({ summary: msg });
    return;
  }

  const rows = [];

  // 1. 打开小程序任务
  rows.push(result("打开任务", await postJson(OPEN_URL, { flag: 1 })));
  await sleep(600);

  // 2. 每日签到
  rows.push(result("每日签到", await postJson(SIGN_URL, {})));
  await sleep(600);

  // 3. 连续完成浏览帖子 3 次 (与 QX 完全一致)
  for (let i = 1; i <= 3; i++) {
    const progRes = await postJson(PROGRESS_URL, { operateType: 1 });
    rows.push(result(`浏览帖子 ${i}/3`, progRes));
    console.log(`[${NAME}] 浏览上报 #${i}: HTTP ${progRes.status} ${messageOf(progRes.body)}`);
    if (i < 3) await sleep(800);
  }

  // 4. 等待后端入库
  await sleep(1000);

  // 5. 任务状态核验
  const listRes = await getJson(LIST_URL);
  rows.push(result("任务查询", listRes));

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);

  const hasExpired = rows.some((x) => x.includes("凭据失效") || x.includes("401") || x.includes("403"));
  const title = hasExpired ? "登录凭据失效" : "每日任务执行完成";

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
