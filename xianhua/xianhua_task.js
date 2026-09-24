// 三国咸话每日自动任务 (Surge Cron / Generic 兼容)
// 包含：打开小程序任务 + 每日签到 + 浏览帖子3次 + 自动领取今日任务奖励
// 核心优化：彻底隔离 wxforum (签到) 与 api-xh (社区/浏览/领奖) 双通道凭据，防止 HS256 算法错配
// 极速防超时：全套流程 2 秒完成，支持真实领奖端点自动回放

const NAME = "三国咸话";
const HEADER_KEY = "sgxh_headers";
const TOKEN_KEY = "sgxh_token";
const XH_HDR_KEY = "sgxh_xh_headers";
const XH_TOK_KEY = "sgxh_xh_token";
const WX_HDR_KEY = "sgxh_wx_headers";
const WX_TOK_KEY = "sgxh_wx_token";
const COOKIE_KEY = "sgxh_cookie";
const REWARD_URL_KEY = "sgxh_confirmed_reward_url";

const OPEN_URL = "https://wxforum.sanguosha.cn/api/openMiniApp";
const SIGN_URL = "https://wxforum.sanguosha.cn/api/user/signIn";
const PROGRESS_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/updateTaskProgress";
const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

const CANDIDATE_REWARD_URLS = [
  "https://api-xh.sanguosha.cn/task/sgxh-task/receiveReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/getReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/receive",
  "https://api-xh.sanguosha.cn/task/sgxh-task/drawReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/claimReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/receiveTaskReward"
];

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
    hdrRaw = $persistentStore.read(XH_HDR_KEY) || "{}";
    tokRaw = $persistentStore.read(XH_TOK_KEY) || "";

    // 严禁将 wxforum 的 HS256 Token 发给 api-xh
    if (!tokRaw) {
      const fallbackTok = $persistentStore.read(TOKEN_KEY) || "";
      if (fallbackTok && !isHs256Jwt(fallbackTok)) {
        tokRaw = fallbackTok;
        hdrRaw = $persistentStore.read(HEADER_KEY) || "{}";
      }
    }
  } else if (isWx) {
    hdrRaw = $persistentStore.read(WX_HDR_KEY) || $persistentStore.read(HEADER_KEY) || "{}";
    tokRaw = $persistentStore.read(WX_TOK_KEY) || $persistentStore.read(TOKEN_KEY) || "";
  } else {
    hdrRaw = $persistentStore.read(HEADER_KEY) || "{}";
    tokRaw = $persistentStore.read(TOKEN_KEY) || "";
  }

  let saved = {};
  try { saved = JSON.parse(hdrRaw); } catch (e) {}

  const h = {};
  for (const key in saved) {
    const k = String(key).toLowerCase();
    if (!DROP[k]) continue;
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

const ID_FIELDS = ["taskId", "taskID", "task_id", "id", "userTaskId", "userTaskID", "taskCode"];
const RECEIVED_FIELDS = ["isReceive", "isReceived", "received", "hasReceive", "hasReceived", "isGetReward", "isGet", "receiveFlag", "rewardFlag", "claimed"];
const NAME_FIELDS = ["taskName", "name", "title", "taskTitle", "taskDesc", "task_name", "description"];

function pick(obj, fields) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (obj[f] !== undefined && obj[f] !== null) return { field: f, value: obj[f] };
  }
  return null;
}

function truthy(v) { return v === true || v === 1 || v === "1" || v === "true"; }

function collectTasks(node, out, seen = {}) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectTasks(item, out, seen));
    return;
  }
  const id = pick(node, ID_FIELDS);
  const name = pick(node, NAME_FIELDS);
  if (id && (name || pick(node, ["status", "progressStatus", "taskStatus"]) || pick(node, RECEIVED_FIELDS))) {
    const key = String(id.value);
    if (!seen[key]) {
      seen[key] = 1;
      out.push(node);
    }
  }
  Object.keys(node).forEach((k) => collectTasks(node[k], out, seen));
}

function taskIdOf(t) {
  const id = pick(t, ID_FIELDS);
  return id ? id.value : undefined;
}

function taskLabel(t) {
  const n = pick(t, NAME_FIELDS);
  return String((n && n.value) || taskIdOf(t) || "未知任务");
}

function alreadyClaimed(t) {
  const r = pick(t, RECEIVED_FIELDS);
  if (r && truthy(r.value)) return true;
  const s = pick(t, ["receiveStatus", "userTaskStatus"]);
  if (s && (s.value === 1 || s.value === "1" || s.value === 2 || s.value === "2")) return true;
  return false;
}

function isTargetDailyTask(t) {
  const label = taskLabel(t);
  if (/累计/i.test(label) || /100次|500次|600次|1000次/i.test(label)) return false;
  return /今日.*浏览|浏览.*3次|浏览.*帖子|每日签到|打开小程序/i.test(label);
}

function claimable(t) {
  if (alreadyClaimed(t)) return false;
  if (!isTargetDailyTask(t)) return false;
  return true;
}

async function claimReward(t) {
  const id = taskIdOf(t);
  const confirmedUrl = $persistentStore.read(REWARD_URL_KEY) || "";

  if (confirmedUrl) {
    console.log(`[${NAME}] 使用已确认的领奖接口: ${confirmedUrl}`);
    const r = await postJson(confirmedUrl, { taskId: id });
    return r;
  }

  const urlsToTry = CANDIDATE_REWARD_URLS;
  let first = null;

  for (let i = 0; i < urlsToTry.length; i++) {
    const curUrl = urlsToTry[i];
    const r = await postJson(curUrl, { taskId: id });
    const j = parseJSON(r.body);
    const code = j ? (j.code !== undefined ? String(j.code) : "") : "";
    const isOk = r.status >= 200 && r.status < 300 && (
      (j && (j.success === true || code === "0" || code === "200" || code === "1000")) ||
      /成功|已领取|获得/.test(r.body)
    );

    console.log(`[${NAME}] 试探领奖端点 (${curUrl.replace(/^https?:\/\/[^/]+/i, "")}): HTTP ${r.status} ${messageOf(r.body)}`);

    if (isOk) {
      $persistentStore.write(curUrl, REWARD_URL_KEY);
      console.log(`[${NAME}] 🎯 成功锁定领奖接口: ${curUrl}`);
      return r;
    }

    if (!first) first = r;
    if (r.status === 401 || r.status === 403) break;
  }

  return first;
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
  const openRes = await postJson(OPEN_URL, { flag: 1 });
  rows.push(result("打开任务", openRes));
  console.log(`[${NAME}] 打开小程序: HTTP ${openRes.status} ${messageOf(openRes.body)}`);
  await sleep(150);

  // 2. 每日签到
  const signRes = await postJson(SIGN_URL, {});
  rows.push(result("每日签到", signRes));
  console.log(`[${NAME}] 每日签到: HTTP ${signRes.status} ${messageOf(signRes.body)}`);
  await sleep(150);

  // 3. 浏览任务 (需要 api-xh 社区凭据)
  if (!xhCred.token) {
    rows.push("浏览任务: 缺少社区专属凭据 (请在小程序点进任意【帖子】抓取)");
    rows.push("任务列表: 缺少社区专属凭据");
  } else {
    for (let i = 1; i <= 3; i++) {
      const progRes = await postJson(PROGRESS_URL, { operateType: 1 });
      rows.push(result(`浏览进度 ${i}/3`, progRes));
      console.log(`[${NAME}] 浏览上报 #${i}: HTTP ${progRes.status} ${messageOf(progRes.body)}`);
      if (i < 3) await sleep(150);
    }

    // 4. 等待后端落库 (500ms)
    console.log(`[${NAME}] 等待服务端更新任务状态...`);
    await sleep(500);

    // 5. 任务列表查询与精准领奖
    const listRes = await getJson(LIST_URL);
    console.log(`[${NAME}] taskList 响应: HTTP ${listRes.status} ${String(listRes.body).slice(0, 160)}`);

    if (listRes.error) {
      rows.push(`任务列表: 请求失败 (${listRes.error})`);
    } else if (isAuthError(listRes)) {
      rows.push(`任务列表: 社区凭据失效 (${messageOf(listRes.body)})`);
    } else {
      const data = parseJSON(listRes.body);
      const tasks = [];
      collectTasks(data, tasks);

      if (!tasks.length) {
        rows.push("任务列表: 未解析到任务");
      } else {
        console.log(`[${NAME}] taskList 识别到 ${tasks.length} 项任务`);
        let claimedCount = 0;
        for (const t of tasks) {
          const label = taskLabel(t);
          if (claimable(t)) {
            console.log(`[${NAME}] 发现今日目标任务 -> ${label} (ID: ${taskIdOf(t)})`);
            const claimRes = await claimReward(t);
            rows.push(result(`领取[${label}]`, claimRes));
            claimedCount++;
            await sleep(150);
          } else if (alreadyClaimed(t)) {
            console.log(`[${NAME}] 任务 [${label}] 已领过`);
          }
        }
        if (claimedCount === 0) {
          rows.push("奖励领取: 今日目标奖励已全部领取完毕");
        }
      }
    }
  }

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);

  const hasSuccess = rows.some((x) => x.includes("成功") || x.includes("已领"));
  const title = hasSuccess ? "每日任务执行完成" : "每日任务执行结果";

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
