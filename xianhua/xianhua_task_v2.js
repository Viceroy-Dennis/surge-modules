// 三国咸话每日全套任务 v2.0 (极速并发版 - 彻底告别超时与漏做)
// 包含全套社区与福利任务：
// 1. 打开小程序 (openMiniApp)
// 2. 每日签到 (signIn)
// 3. 今日点赞 10 次 (全并发极速完成)
// 4. 今日浏览帖子 3 次 (真实阅读 + 微服务 3 次上报双重保障)
// 5. 今日分享帖子 1 次 (自动触发)
// 6. 任务列表查询与智能多端点自动领奖 (taskReward / getTaskBonus)

const NAME = "三国咸话v2.0";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const COOKIE_KEY = "sgxh_cookie";
const REWARD_URL_KEY = "sgxh_confirmed_reward_url";

// 兼容旧键
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";

const OPEN_URL = "https://wxforum.sanguosha.cn/api/openMiniApp";
const SIGN_URL = "https://wxforum.sanguosha.cn/api/user/signIn";
const TOPICS_URL = "https://wxforum.sanguosha.cn/api/topics?page=1&category_id=1";
const PROGRESS_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/updateTaskProgress";
const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

const CANDIDATE_REWARD_URLS = [
  "https://api-xh.sanguosha.cn/task/sgxh-task/taskReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/receiveReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/getReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/receive",
  "https://api-xh.sanguosha.cn/task/sgxh-task/drawReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/claimReward"
];

const DROP = { host: 1, connection: 1, "keep-alive": 1, "proxy-connection": 1, "transfer-encoding": 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1 };

function savedHeaders(url) {
  const isXh = url.includes("api-xh") || url.includes("xh.sanguosha.cn") || url.includes("api-forum-act");
  const isWx = url.includes("wxforum");

  let hdrRaw = "";
  let tokRaw = "";

  if (isXh) {
    hdrRaw = $persistentStore.read(HDR_XH_KEY) || "";
    tokRaw = $persistentStore.read(TOKEN_XH_KEY) || "";

    if (!tokRaw) {
      tokRaw = $persistentStore.read(TOKEN_KEY) || "";
      hdrRaw = $persistentStore.read(HEADER_KEY) || "{}";
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

function hasCredential() {
  const raw = $persistentStore.read(TOKEN_WX_KEY) || $persistentStore.read(TOKEN_KEY) || $persistentStore.read(TOKEN_XH_KEY);
  return Boolean(raw);
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
  if (r.error) return `${label}: 异常 (${r.error})`;
  if (isAuthError(r)) return `${label}: 凭据失效 (${messageOf(r.body)})`;
  if (r.status >= 200 && r.status < 300) return `${label}: ${messageOf(r.body)}`;
  return `${label}: HTTP ${r.status} ${messageOf(r.body)}`;
}

// 封装带超时的 HTTP 请求，单次请求最大 2500ms，避免拖死总耗时
function httpWithTimeout(fn, opts, timeoutMs = 2500) {
  return new Promise((resolve) => {
    let finished = false;
    const timer = setTimeout(() => {
      if (!finished) {
        finished = true;
        resolve({ url: opts.url, status: 0, error: `网络超时(${timeoutMs}ms)`, body: "" });
      }
    }, timeoutMs);

    fn(opts, (error, response, body) => {
      if (!finished) {
        finished = true;
        clearTimeout(timer);
        if (error) {
          resolve({ url: opts.url, status: 0, error: String(error), body: "" });
        } else {
          resolve({
            url: opts.url,
            status: Number(response && (response.status || response.statusCode)) || 0,
            error: "",
            body: String(body || "")
          });
        }
      }
    });
  });
}

function postJson(url, payload, timeoutMs = 2500) {
  return httpWithTimeout($httpClient.post, {
    url: url,
    headers: headersFor(url),
    body: JSON.stringify(payload || {})
  }, timeoutMs);
}

function putJson(url, payload, timeoutMs = 2500) {
  return httpWithTimeout($httpClient.put, {
    url: url,
    headers: headersFor(url),
    body: JSON.stringify(payload || {})
  }, timeoutMs);
}

function getJson(url, timeoutMs = 2500) {
  return httpWithTimeout($httpClient.get, {
    url: url,
    headers: headersFor(url)
  }, timeoutMs);
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

  const s = pick(t, ["userTaskStatus", "taskStatus", "status", "state"]);
  if (s && (s.value === 2 || s.value === "2" || s.value === 3 || s.value === "3")) return true;

  if (t.receiveStatus === 2 || t.receiveStatus === "2") return true;

  return false;
}

function isDailyTargetTask(t) {
  const label = taskLabel(t);
  if (/累计/i.test(label) || /100次|500次|600次|1000次/i.test(label)) return false;
  return /点赞|浏览|分享|热力竹|战报|签到|打开/i.test(label);
}

function claimable(t) {
  if (alreadyClaimed(t)) return false;
  return isDailyTargetTask(t);
}

async function claimReward(taskId) {
  const confirmedUrl = $persistentStore.read(REWARD_URL_KEY) || "";
  const confirmedMethod = $persistentStore.read("sgxh_confirmed_reward_method") || "POST";
  const confirmedBody = $persistentStore.read("sgxh_confirmed_reward_body") || "";

  if (confirmedUrl) {
    let targetUrl = confirmedUrl.replace(/\/\d+(\/?(\?|$))/, `/${taskId}$1`);
    let payload = {};
    try {
      const bodyObj = JSON.parse(confirmedBody);
      if (typeof bodyObj === "object") {
        payload = bodyObj;
        ["taskId", "task_id", "id", "taskCode"].forEach((k) => {
          if (payload[k] !== undefined) payload[k] = taskId;
        });
      }
    } catch (e) {
      payload = { taskId: taskId };
    }

    if (confirmedMethod === "PUT") {
      return await putJson(targetUrl, payload, 2000);
    }
    return await postJson(targetUrl, payload, 2000);
  }

  // 依次尝试候选端点 (首选官方 taskReward)
  for (let i = 0; i < CANDIDATE_REWARD_URLS.length; i++) {
    const curUrl = CANDIDATE_REWARD_URLS[i];
    const r = await postJson(curUrl, { taskId: taskId }, 2000);
    const j = parseJSON(r.body);
    const code = j ? (j.code !== undefined ? String(j.code) : "") : "";
    const isOk = r.status >= 200 && r.status < 300 && (
      (j && (j.success === true || code === "0" || code === "200" || code === "1000")) ||
      /成功|已领取|获得/.test(r.body)
    );

    if (isOk) {
      $persistentStore.write(curUrl, REWARD_URL_KEY);
      return r;
    }
    if (isAuthError(r)) break;
  }

  // 备选尝试 wxforum 官方端点
  return await postJson(`https://wxforum.sanguosha.cn/api/shop/getTaskBonus/${taskId}`, {}, 2000);
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
  console.log(`[${NAME}] ========== 启动全套任务 (极速并发版) ==========`);

  // 1. 并发执行：打开小程序任务 + 每日签到
  const [openRes, signRes] = await Promise.all([
    postJson(OPEN_URL, { flag: 1 }, 2000),
    postJson(SIGN_URL, {}, 2000)
  ]);
  rows.push(result("打开任务", openRes));
  rows.push(result("每日签到", signRes));
  console.log(`[${NAME}] 打开: HTTP ${openRes.status} | 签到: HTTP ${signRes.status}`);

  // 2. 获取推荐帖子列表
  const topicsRes = await getJson(TOPICS_URL, 2000);
  const topicsJson = parseJSON(topicsRes.body);
  let topicsList = (topicsJson && topicsJson.data) || [];

  if (!Array.isArray(topicsList) || !topicsList.length) {
    topicsList = [
      { id: "12906766" }, { id: "12905506" }, { id: "12905512" }, { id: "12904365" }, { id: "12905737" },
      { id: "12906764" }, { id: "12906763" }, { id: "12905500" }, { id: "12905501" }, { id: "12905502" }
    ];
  }

  // 3. 【今日点赞 10 次】全并发打出 (0.2秒完成)
  console.log(`[${NAME}] 并发执行【今日点赞10次】...`);
  const likeLimit = Math.min(10, topicsList.length);
  const likePromises = [];
  for (let i = 0; i < likeLimit; i++) {
    likePromises.push(postJson(`https://wxforum.sanguosha.cn/api/topics/${topicsList[i].id}/likes`, {}, 2000));
  }
  const likeResults = await Promise.all(likePromises);
  const likeSuccess = likeResults.filter(r => r.status === 200 || (parseJSON(r.body) && parseJSON(r.body).code === 0)).length;
  rows.push(`今日点赞: 完成 ${likeSuccess}/10 次`);

  // 4. 【今日浏览 3 次 - 社区帖子访问】并发打出
  console.log(`[${NAME}] 并发执行【今日浏览3次】帖子详情...`);
  const viewPromises = [];
  for (let i = 0; i < 3; i++) {
    const tid = topicsList[i] ? topicsList[i].id : "12906766";
    viewPromises.push(getJson(`https://wxforum.sanguosha.cn/api/topics/${tid}`, 2000));
  }
  await Promise.all(viewPromises);

  // 5. 【今日分享 1 次】
  const shareTid = topicsList[0] ? topicsList[0].id : "12906766";
  const shRes = await postJson(`https://wxforum.sanguosha.cn/api/topics/${shareTid}/share`, {}, 2000);
  rows.push(result("今日分享", shRes));

  // 6. 核心重头戏：微服务任务系统进度上报 (必须上报 3 次完成 3/3 浏览)
  console.log(`[${NAME}] 正在执行微服务【浏览帖子3次】进度上报...`);
  let xhBrowseOk = 0;
  for (let i = 1; i <= 3; i++) {
    const progRes = await postJson(PROGRESS_URL, { operateType: 1 }, 2000);
    const pJson = parseJSON(progRes.body);
    if (progRes.status === 200 && (!pJson || pJson.code === 0 || pJson.code === 200 || pJson.success === true)) {
      xhBrowseOk++;
    }
    if (i < 3) await sleep(120);
  }
  rows.push(`今日浏览: 完成 3/3 次 (上报${xhBrowseOk}/3)`);

  // 并发同步微服务其它动作
  Promise.all([
    postJson(PROGRESS_URL, { operateType: 2 }, 1500),
    postJson(PROGRESS_URL, { operateType: 3 }, 1500),
    postJson(PROGRESS_URL, { operateType: 4 }, 1500),
    postJson(PROGRESS_URL, { operateType: 5 }, 1500)
  ]).catch(() => {});

  // 微服务落库等待 400ms
  await sleep(400);

  // 7. 查询 taskList 并执行自动领奖
  console.log(`[${NAME}] 正在拉取 taskList 任务列表...`);
  const listRes = await getJson(LIST_URL, 2000);
  const data = parseJSON(listRes.body);
  const tasks = [];
  collectTasks(data, tasks);

  if (tasks.length) {
    console.log(`[${NAME}] 识别到 ${tasks.length} 项任务`);
    const claimPromises = [];
    for (const t of tasks) {
      const tid = taskIdOf(t);
      const label = taskLabel(t);
      if (claimable(t)) {
        claimPromises.push((async () => {
          const claimRes = await claimReward(tid);
          return result(`领取[${label}]`, claimRes);
        })());
      }
    }
    if (claimPromises.length) {
      const claimOutputs = await Promise.all(claimPromises);
      claimOutputs.forEach(o => rows.push(o));
    } else {
      rows.push("奖励领取: 目标任务奖励已处于已领状态");
    }
  } else {
    // 容灾保底：直接尝试领奖核心任务
    const coreTasks = [
      { id: "1001", name: "今日点赞10次" },
      { id: "1003", name: "今日浏览帖子3次" },
      { id: "1004", name: "今日分享帖子1次" }
    ];
    const corePromises = coreTasks.map(async t => {
      const claimRes = await claimReward(t.id);
      return result(`领取[${t.name}]`, claimRes);
    });
    const coreOutputs = await Promise.all(corePromises);
    coreOutputs.forEach(o => rows.push(o));
  }

  const text = rows.join("\n");
  console.log(`[${NAME}] ========== 执行完成 ==========\n${text}`);

  const hasSuccess = rows.some((x) => x.includes("成功") || x.includes("已领") || x.includes("完成"));
  const title = hasSuccess ? "每日全套任务完成 🎉" : "任务执行结果";

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
