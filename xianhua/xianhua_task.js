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

function cookieMap(cookie) {
  const o = {};
  String(cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

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
  if (token) {
    if (!h.authorization && !h.token && !h["x-token"] && !h["x-auth-token"]) {
      h.authorization = token;
    }
    const ck = cookieMap(h.cookie || "");
    if (!ck.token) {
      h.cookie = h.cookie ? h.cookie + "; token=" + token : "token=" + token;
    }
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

function isAuthError(r) {
  if (r.status === 401 || r.status === 403) return true;
  const str = String(r.body || "");
  if (str.indexOf("未登录") !== -1 || str.indexOf("token已经过期") !== -1 || str.indexOf("token过期") !== -1 || str.indexOf("token失效") !== -1) {
    return true;
  }
  return false;
}

function result(label, r) {
  if (r.error) return `${label}: 请求失败 (${r.error})`;
  if (isAuthError(r)) return `${label}: 登录凭据失效`;
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

function isBrowseTask(t) {
  const label = taskLabel(t);
  return /浏览|阅读|看帖/.test(label);
}

function isSignTask(t) {
  const label = taskLabel(t);
  return /签到|打开|登录|登陆|小程序/.test(label) && !/发表|发帖|评论/.test(label);
}

function claimable(t) {
  if (alreadyClaimed(t)) return false;

  // 1. 浏览与签到任务：刚在主流程执行完毕，必定已达成，直接发起领取！
  if (isBrowseTask(t)) return true;
  if (isSignTask(t)) return true;

  // 2. 状态值明确指示已完成待领 (1 或 2 表示待领)
  const s = pick(t, ["progressStatus", "status", "taskStatus", "state"]);
  if (s && (s.value === 1 || s.value === "1" || s.value === 2 || s.value === "2")) return true;

  // 3. 进度数值比对 (兼容各种字段名)
  const curItem = pick(t, ["currentProgressValue", "progress", "currentProgress", "finishNum", "completeNum", "finishCount", "count", "current"]);
  const maxItem = pick(t, ["targetProgressValue", "targetNum", "totalNum", "maxNum", "needNum", "targetCount", "target", "need", "maxCount"]);
  const cur = Number(curItem ? curItem.value : NaN);
  const max = Number(maxItem ? maxItem.value : NaN);
  if (isFinite(cur) && isFinite(max) && max > 0 && cur >= max) return true;

  return false;
}

async function claimReward(t) {
  const id = taskIdOf(t);
  const attempts = [{ taskId: id }, { taskId: Number(id) }, { id: id }, { taskCode: id }];
  let first = null;
  for (let i = 0; i < attempts.length; i++) {
    const r = await postJson(REWARD_URL, attempts[i]);
    const j = parseJSON(r.body);
    const code = j ? (j.code !== undefined ? String(j.code) : "") : "";
    const isOk = r.status >= 200 && r.status < 300 && (
      (j && (j.success === true || code === "0" || code === "200" || code === "1000")) ||
      /成功|已领取|获得/.test(r.body)
    );
    console.log(`[${NAME}] 领奖响应 (taskId=${id}, payload=${JSON.stringify(attempts[i])}): HTTP ${r.status} ${messageOf(r.body)}`);
    if (isOk) {
      return r;
    }
    if (!first) first = r;
    if (isAuthError(r)) break;
  }
  return first;
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

  // 1. 打开小程序
  const openRes = await postJson(OPEN_URL, { flag: 1 });
  rows.push(result("打开任务", openRes));
  console.log(`[${NAME}] 打开小程序: HTTP ${openRes.status} ${messageOf(openRes.body)}`);
  if (isAuthError(openRes)) {
    const failMsg = "❌ Token 已过期 (401)\n💡 请在微信中重新进入「三国咸话」小程序刷新凭据后再运行";
    console.log(`[${NAME}] 登录凭据失效，立即停止执行`);
    $notification.post(NAME, "登录凭据已过期", failMsg);
    $done({ summary: failMsg });
    return;
  }
  await sleep(600);

  // 2. 每日签到
  const signRes = await postJson(SIGN_URL, {});
  rows.push(result("每日签到", signRes));
  console.log(`[${NAME}] 每日签到: HTTP ${signRes.status} ${messageOf(signRes.body)}`);
  if (isAuthError(signRes)) {
    const failMsg = "❌ 签到鉴权失败 (Token 已过期)\n💡 请在微信中重新进入小程序刷新凭据";
    console.log(`[${NAME}] 签到凭据失效，立即停止执行`);
    $notification.post(NAME, "登录凭据已过期", failMsg);
    $done({ summary: failMsg });
    return;
  }
  await sleep(600);

  // 3. 浏览任务 (三次)
  for (let i = 1; i <= 3; i++) {
    const progRes = await postJson(PROGRESS_URL, { operateType: 1 });
    rows.push(result(`浏览进度 ${i}/3`, progRes));
    console.log(`[${NAME}] 浏览上报 #${i}: HTTP ${progRes.status} ${messageOf(progRes.body)}`);
    if (isAuthError(progRes)) {
      const failMsg = "❌ 浏览上报鉴权失败 (Token 已过期)\n💡 请在微信中重新进入小程序刷新凭据";
      console.log(`[${NAME}] 浏览上报凭据失效，立即停止执行`);
      $notification.post(NAME, "登录凭据已过期", failMsg);
      $done({ summary: failMsg });
      return;
    }
    if (i < 3) await sleep(1000);
  }

  // 4. 等待后端处理进度入库 (服务端异步写入需要时间，留足 2.5 秒)
  console.log(`[${NAME}] 等待服务端更新任务状态...`);
  await sleep(2500);

  // 5. 任务列表查询与领取
  const listRes = await getJson(LIST_URL);
  console.log(`[${NAME}] taskList 响应: HTTP ${listRes.status} ${String(listRes.body).slice(0, 200)}`);

  if (listRes.error) {
    rows.push(`任务列表: 请求失败 (${listRes.error})`);
  } else if (isAuthError(listRes)) {
    rows.push("任务列表: 登录凭据失效");
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
          console.log(`[${NAME}] 发现可领任务 -> ${label}`);
          const claimRes = await claimReward(t);
          rows.push(result(`领取[${label}]`, claimRes));
          claimedCount++;
          await sleep(800);
        } else if (alreadyClaimed(t)) {
          console.log(`[${NAME}] 任务 [${label}] 之前已领过`);
        } else {
          console.log(`[${NAME}] 任务 [${label}] 未达成或非目标`);
        }
      }
      if (claimedCount === 0) {
        rows.push("奖励领取: 暂无可领取的奖励 (已全部领完)");
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
