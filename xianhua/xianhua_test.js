// 三国咸话综合测试与诊断脚本 (Surge Generic / 手动执行专用)
// 用途: 检查抓包凭据有效性、接口连通性、当前任务进度，不触发破坏性请求

const NAME = "三国咸话测试";
const HEADER_KEY = "sgxh_headers";
const COOKIE_KEY = "sgxh_cookie";
const TOKEN_KEY = "sgxh_token";
const TIME_KEY = "sgxh_capture_time";

const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

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

function taskLabel(t) {
  const n = pick(t, NAME_FIELDS);
  const id = pick(t, ID_FIELDS);
  return String((n && n.value) || (id && id.value) || "未知任务");
}

function taskProgressText(t) {
  const curItem = pick(t, ["currentProgressValue", "progress", "currentProgress", "finishNum", "completeNum", "finishCount", "count", "current"]);
  const maxItem = pick(t, ["targetProgressValue", "targetNum", "totalNum", "maxNum", "needNum", "targetCount", "target", "need", "maxCount"]);
  if (curItem) {
    return `${curItem.value}/${maxItem ? maxItem.value : "?"}`;
  }
  return "";
}

function isDone(t) {
  const r = pick(t, RECEIVED_FIELDS);
  if (r && truthy(r.value)) return "已领奖";
  const s = pick(t, ["progressStatus", "status", "taskStatus"]);
  if (s && (s.value === 1 || s.value === "1" || s.value === 2 || s.value === "2")) return "待领奖";
  const curItem = pick(t, ["currentProgressValue", "progress", "currentProgress", "finishNum", "completeNum", "finishCount", "count", "current"]);
  const maxItem = pick(t, ["targetProgressValue", "targetNum", "totalNum", "maxNum", "needNum", "targetCount", "target", "need", "maxCount"]);
  const cur = Number(curItem ? curItem.value : NaN);
  const max = Number(maxItem ? maxItem.value : NaN);
  if (isFinite(cur) && isFinite(max) && max > 0 && cur >= max) return "待领奖";
  return "进行中";
}

async function main() {
  console.log(`[${NAME}] ========== 开始诊断 ==========`);
  const rows = [];
  const h = savedHeaders();
  const token = $persistentStore.read(TOKEN_KEY) || h.authorization || h.token || "";
  const cookie = $persistentStore.read(COOKIE_KEY) || h.cookie || "";
  const capTime = $persistentStore.read(TIME_KEY);

  if (!token && !cookie) {
    rows.push("❌ 未检测到登录凭据 (sgxh_headers/token/cookie)");
    rows.push("💡 请在 Surge 开启抓包模块，并在微信中打开「三国咸话」小程序");
    console.log(rows.join("\n"));
    $notification.post(NAME, "未找到登录凭据", rows.join("\n"));
    $done({ summary: rows.join("\n") });
    return;
  }

  rows.push("🔑 凭据状态: 已捕获");
  if (capTime) {
    const d = new Date(Number(capTime));
    rows.push(`🕒 捕获时间: ${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  }
  if (token) {
    rows.push(`🎫 Token: ${token.slice(0, 10)}... (长度 ${token.length})`);
  }

  // 测试任务列表接口
  console.log(`[${NAME}] 正在测试任务列表连通性...`);
  const res = await getJson(LIST_URL);

  if (res.error) {
    rows.push(`📡 接口测试: 失败 (${res.error})`);
  } else if (res.status === 401 || res.status === 403) {
    rows.push(`📡 接口测试: 凭据已过期 (HTTP ${res.status})`);
    rows.push("💡 请在微信中重新进入三国咸话小程序更新凭据");
  } else if (res.status >= 200 && res.status < 300) {
    rows.push(`📡 接口测试: 连通正常 (HTTP ${res.status})`);
    const data = parseJSON(res.body);
    const tasks = [];
    collectTasks(data, tasks);

    if (tasks.length > 0) {
      rows.push(`📋 任务清单 (共 ${tasks.length} 项):`);
      tasks.slice(0, 5).forEach((t) => {
        const prog = taskProgressText(t);
        const status = isDone(t);
        const label = taskLabel(t);
        rows.push(`  • ${label}${prog ? " [" + prog + "]" : ""}: ${status}`);
      });
      if (tasks.length > 5) {
        rows.push(`  ... 还有 ${tasks.length - 5} 项未展开`);
      }
    } else {
      rows.push("📋 任务清单: 返回为空或未解析到");
    }
  } else {
    rows.push(`📡 接口测试: 异常状态 HTTP ${res.status}`);
  }

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);
  $notification.post(NAME, "体检诊断报告", text);
  $done({ summary: text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中执行此脚本" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "测试异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
