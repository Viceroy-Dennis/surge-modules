// 三国咸话每日自动任务 (Surge Cron / Generic 兼容)
// 包含：打开小程序任务 + 每日签到 + 浏览帖子3次 + 自动领取已完成任务奖励
// 凭据来源: $persistentStore (sgxh_headers, sgxh_token, sgxh_cookie)

const NAME = "三国咸话";
const HEADER_KEY = "sgxh_headers";
const COOKIE_KEY = "sgxh_cookie";
const TOKEN_KEY = "sgxh_token";

const OPEN_URL = "https://wxforum.sanguosha.cn/api/openMiniApp";
const SIGN_URL = "https://wxforum.sanguosha.cn/api/user/signIn";
const PROGRESS_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/updateTaskProgress";
const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";
const REWARD_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskReward";

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

const ID_FIELDS = ["taskId", "taskID", "task_id", "id", "taskCode"];
const RECEIVED_FIELDS = ["isReceive", "isReceived", "received", "hasReceive", "hasReceived", "isGetReward", "isGet", "receiveFlag", "rewardFlag"];
const NAME_FIELDS = ["taskDesc", "taskName", "task_name", "name", "title"];

function pick(obj, fields) {
  for (let i = 0; i < fields.length; i++) {
    const f = fields[i];
    if (obj[f] !== undefined && obj[f] !== null) return { field: f, value: obj[f] };
  }
  return null;
}

function truthy(v) { return v === true || v === 1 || v === "1" || v === "true"; }

function collectTasks(node, out) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    node.forEach((item) => collectTasks(item, out));
    return;
  }
  if (pick(node, ID_FIELDS) && (pick(node, ["progressStatus", "status", "taskStatus"]) || pick(node, RECEIVED_FIELDS) || pick(node, ["currentProgressValue", "targetProgressValue"]))) {
    out.push(node);
    return;
  }
  Object.keys(node).forEach((k) => collectTasks(node[k], out));
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
  return Boolean(r && truthy(r.value));
}

function claimable(t) {
  if (alreadyClaimed(t)) return false;
  const s = pick(t, ["progressStatus"]);
  if (s && (s.value === 2 || s.value === "2")) return true;
  const curItem = pick(t, ["currentProgressValue", "progress", "currentProgress", "finishNum", "completeNum"]);
  const maxItem = pick(t, ["targetProgressValue", "targetNum", "totalNum", "maxNum", "needNum"]);
  const cur = Number(curItem ? curItem.value : NaN);
  const max = Number(maxItem ? maxItem.value : NaN);
  return isFinite(cur) && isFinite(max) && max > 0 && cur >= max;
}

async function claimReward(t) {
  const id = taskIdOf(t);
  const attempts = [{ taskId: id }, { id: id }, { taskCode: id }];
  let first = null;
  for (let i = 0; i < attempts.length; i++) {
    const r = await postJson(REWARD_URL, attempts[i]);
    const j = parseJSON(r.body);
    if (r.status >= 200 && r.status < 300 && j && (j.success === true || j.code === 0 || j.code === 200)) {
      return r;
    }
    if (!first) first = r;
    if (r.status === 401 || r.status === 403) break;
  }
  return first;
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  if (!hasCredential()) {
    const msg = "请先在 Surge 开启抓包模块，并进入一次三国咸话小程序保存凭据";
    console.log(`[${NAME}] 没有登录凭据`);
    $notification.post(NAME, "未检测到凭据", msg);
    $done({ summary: msg });
    return;
  }

  const rows = [];

  // 1. 打开小程序
  const openRes = await postJson(OPEN_URL, { flag: 1 });
  rows.push(result("打开任务", openRes));
  await sleep(1000);

  // 2. 每日签到
  const signRes = await postJson(SIGN_URL, {});
  rows.push(result("每日签到", signRes));
  await sleep(1000);

  // 3. 浏览任务 (三次)
  for (let i = 1; i <= 3; i++) {
    const progRes = await postJson(PROGRESS_URL, { operateType: 1 });
    rows.push(result(`浏览进度 ${i}/3`, progRes));
    console.log(`[${NAME}] 浏览上报 #${i}: HTTP ${progRes.status} ${messageOf(progRes.body)}`);
    if (i < 3) await sleep(1200);
  }

  // 4. 等待后端处理进度
  await sleep(2000);

  // 5. 任务列表查询与领取
  const listRes = await getJson(LIST_URL);
  if (listRes.error) {
    rows.push(`任务列表: 请求失败 (${listRes.error})`);
  } else if (listRes.status === 401 || listRes.status === 403) {
    rows.push("任务列表: 登录凭据失效");
  } else {
    const data = parseJSON(listRes.body);
    const tasks = [];
    collectTasks(data, tasks);

    if (!tasks.length) {
      rows.push("任务列表: 未解析到任务");
    } else {
      let claimedCount = 0;
      for (const t of tasks) {
        if (claimable(t)) {
          const label = taskLabel(t);
          console.log(`[${NAME}] 发现可领任务: ${label}`);
          const claimRes = await claimReward(t);
          rows.push(result(`领取[${label}]`, claimRes));
          claimedCount++;
          await sleep(1000);
        }
      }
      if (claimedCount === 0) {
        rows.push("奖励领取: 暂无可领取的奖励");
      }
    }
  }

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);

  if (rows.some((x) => x.indexOf("凭据失效") >= 0)) {
    $notification.post(NAME, "登录凭据已过期", text);
  } else {
    $notification.post(NAME, "每日任务完成", text);
  }

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
