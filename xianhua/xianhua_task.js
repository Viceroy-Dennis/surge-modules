// 三国咸话每日全套任务 (Surge Cron / Generic 兼容)
// 包含全套社区任务自动化：
// 1. 打开小程序任务 (openMiniApp)
// 2. 每日签到福利 (signIn)
// 3. 今日点赞 10 次 (自动获取热门帖子并执行 10 次真实点赞)
// 4. 今日浏览帖子 3 次 (自动浏览 3 篇帖子并上报阅读统计)
// 5. 今日分享帖子 1 次 (自动触发帖子分享动作)
// 6. 本周查看热力竹与每周战报
// 7. 智能多端点自动领奖 (支持 getTaskBonus 与微服务端点)

const NAME = "三国咸话";
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
  "https://api-xh.sanguosha.cn/task/sgxh-task/receiveReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/getReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/receive",
  "https://api-xh.sanguosha.cn/task/sgxh-task/drawReward",
  "https://api-xh.sanguosha.cn/task/sgxh-task/claimReward"
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
    hdrRaw = $persistentStore.read(HDR_XH_KEY) || "";
    tokRaw = $persistentStore.read(TOKEN_XH_KEY) || "";

    // 严禁把 wxforum 的 HS256 Token 传给 api-xh 避免报 Unsupported algorithm
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

function putJson(url, payload) {
  return new Promise((resolve) => {
    $httpClient.put({
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

function isTargetTask(t) {
  const label = taskLabel(t);
  if (/累计/i.test(label) || /100次|500次|600次|1000次/i.test(label)) return false;
  return /点赞|浏览|分享|热力竹|战报|签到|打开/i.test(label);
}

function claimable(t) {
  if (alreadyClaimed(t)) return false;
  return isTargetTask(t);
}

async function claimReward(taskId) {
  const confirmedUrl = $persistentStore.read(REWARD_URL_KEY) || "";
  const confirmedMethod = $persistentStore.read("sgxh_confirmed_reward_method") || "POST";
  const confirmedBody = $persistentStore.read("sgxh_confirmed_reward_body") || "";

  // 1. 如果已有抓包确认的真实领奖 URL，严格按抓到的方法与参数格式回放
  if (confirmedUrl) {
    let targetUrl = confirmedUrl;
    let payload = {};

    // 如果 URL 中包含数字 ID，用当前任务 ID 替换 (如 /getTaskBonus/1003 -> /getTaskBonus/{taskId})
    targetUrl = targetUrl.replace(/\/\d+(\/?(\?|$))/, `/${taskId}$1`);

    // 解析抓到的 Body 结构并替换任务 ID
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

    console.log(`[${NAME}] 使用已确认领奖端点: ${confirmedMethod} ${targetUrl}`);
    if (confirmedMethod === "PUT") {
      return await putJson(targetUrl, payload);
    }
    return await postJson(targetUrl, payload);
  }

  // 2. 优先尝试 wxforum 官方端点 /api/shop/getTaskBonus/{id}
  const wxRes = await postJson(`https://wxforum.sanguosha.cn/api/shop/getTaskBonus/${taskId}`, {});
  const wxJson = parseJSON(wxRes.body);
  if (wxRes.status === 200 && wxJson && (wxJson.code === 0 || wxJson.code === 10000 || wxJson.code === 1000)) {
    return wxRes;
  }

  // 3. 依次尝试 api-xh 候选端点
  const urlsToTry = CANDIDATE_REWARD_URLS;
  let first = null;

  for (let i = 0; i < urlsToTry.length; i++) {
    const curUrl = urlsToTry[i];
    const r = await postJson(curUrl, { taskId: taskId });
    const j = parseJSON(r.body);
    const code = j ? (j.code !== undefined ? String(j.code) : "") : "";
    const isOk = r.status >= 200 && r.status < 300 && (
      (j && (j.success === true || code === "0" || code === "200" || code === "1000")) ||
      /成功|已领取|获得/.test(r.body)
    );

    if (isOk) {
      $persistentStore.write(curUrl, REWARD_URL_KEY);
      console.log(`[${NAME}] 🎯 成功锁定微服务领奖接口: ${curUrl}`);
      return r;
    }

    if (!first) first = r;
    if (isAuthError(r)) break;
  }

  return first || wxRes;
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
  const xhCred = savedHeaders(PROGRESS_URL);

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

  // 3. 获取最新推荐帖子列表
  console.log(`[${NAME}] 正在拉取社区热门帖子列表...`);
  const topicsRes = await getJson(TOPICS_URL);
  const topicsJson = parseJSON(topicsRes.body);
  let topicsList = (topicsJson && topicsJson.data) || [];

  // 如果未拉取到，使用经典帖子 ID 备选保底
  if (!Array.isArray(topicsList) || !topicsList.length) {
    topicsList = [
      { id: "12906766", title: "备选帖子1" },
      { id: "12905506", title: "备选帖子2" },
      { id: "12905512", title: "备选帖子3" },
      { id: "12904365", title: "备选帖子4" },
      { id: "12905737", title: "备选帖子5" },
      { id: "12906764", title: "备选帖子6" },
      { id: "12906763", title: "备选帖子7" },
      { id: "12905500", title: "备选帖子8" },
      { id: "12905501", title: "备选帖子9" },
      { id: "12905502", title: "备选帖子10" }
    ];
  }

  // 4. 【今日点赞 10 次】真实动作点赞
  console.log(`[${NAME}] 开始执行【今日点赞10次】任务...`);
  let likeSuccessCount = 0;
  const likeLimit = Math.min(10, topicsList.length);
  for (let i = 0; i < likeLimit; i++) {
    const tid = topicsList[i].id;
    const lkRes = await postJson(`https://wxforum.sanguosha.cn/api/topics/${tid}/likes`, {});
    const lkJson = parseJSON(lkRes.body);
    if (lkRes.status === 200 || (lkJson && (lkJson.code === 0 || lkJson.code === 10000 || lkJson.msg === "操作成功"))) {
      likeSuccessCount++;
    }
    await sleep(80);
  }
  rows.push(`今日点赞: 完成 ${likeSuccessCount}/10 次`);
  console.log(`[${NAME}] 今日点赞完成: ${likeSuccessCount}/10`);

  // 5. 【今日浏览帖子 3 次】真实动作浏览
  console.log(`[${NAME}] 开始执行【今日浏览帖子3次】任务...`);
  let viewSuccessCount = 0;
  for (let i = 0; i < 3; i++) {
    const tid = topicsList[i] ? topicsList[i].id : "12906766";
    const vwRes = await getJson(`https://wxforum.sanguosha.cn/api/topics/${tid}`);
    if (vwRes.status === 200) viewSuccessCount++;
    await sleep(80);
  }
  rows.push(`今日浏览: 完成 ${viewSuccessCount}/3 次`);
  console.log(`[${NAME}] 今日浏览完成: ${viewSuccessCount}/3`);

  // 6. 【今日分享帖子 1 次】真实动作分享
  const shareTid = topicsList[0] ? topicsList[0].id : "12906766";
  const shRes = await postJson(`https://wxforum.sanguosha.cn/api/topics/${shareTid}/share`, {});
  rows.push(result("今日分享", shRes));
  console.log(`[${NAME}] 今日分享: HTTP ${shRes.status} ${messageOf(shRes.body)}`);
  await sleep(100);

  // 7. 如果具备 api-xh 专属 Token，同步推进微服务进度
  if (xhCred.token) {
    console.log(`[${NAME}] 检测到 api-xh 凭据，正在同步微服务进度...`);
    // operateType: 1=浏览, 2=点赞, 3=分享, 4=热力竹, 5=战报
    await postJson(PROGRESS_URL, { operateType: 1 });
    await sleep(80);
    await postJson(PROGRESS_URL, { operateType: 2 });
    await sleep(80);
    await postJson(PROGRESS_URL, { operateType: 3 });
    await sleep(80);
    await postJson(PROGRESS_URL, { operateType: 4 });
    await sleep(80);
    await postJson(PROGRESS_URL, { operateType: 5 });
    await sleep(400);

    // 8. 查询 taskList 并领奖
    const listRes = await getJson(LIST_URL);
    const data = parseJSON(listRes.body);
    const tasks = [];
    collectTasks(data, tasks);

    if (tasks.length) {
      console.log(`[${NAME}] 从 taskList 识别到 ${tasks.length} 项任务`);
      let claimedCount = 0;
      for (const t of tasks) {
        const tid = taskIdOf(t);
        const label = taskLabel(t);
        if (claimable(t)) {
          const claimRes = await claimReward(tid);
          rows.push(result(`领取[${label}]`, claimRes));
          claimedCount++;
          await sleep(100);
        }
      }
      if (claimedCount === 0) {
        rows.push("奖励领取: 目标奖励已领完");
      }
    }
  } else {
    // 针对今日核心任务执行自动领奖 (1001 点赞, 1003 浏览, 1004 分享)
    console.log(`[${NAME}] 正在尝试核心任务自动领奖...`);
    const coreTasks = [
      { id: "1001", name: "今日点赞10次" },
      { id: "1003", name: "今日浏览帖子3次" },
      { id: "1004", name: "今日分享帖子1次" }
    ];
    for (const t of coreTasks) {
      const claimRes = await claimReward(t.id);
      rows.push(result(`领取[${t.name}]`, claimRes));
      await sleep(100);
    }
  }

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);

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
