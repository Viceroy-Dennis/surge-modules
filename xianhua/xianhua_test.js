// 三国咸话 Surge 只读诊断：只查询社区任务列表，不执行任务或领取奖励。
// Surge iOS 5.9+ / Mac 5.5+，使用原生 HTTP 回调并关闭自动 Cookie 与重定向。
const NAME = "三国咸话体检";
const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";
let completed = false;
let watchdog = null;
let token = "";

function safeText(value) {
  let text = String(value === undefined || value === null ? "" : value);
  for (const credential of [token, token.replace(/^Bearer\s+/i, "")]) {
    if (credential) text = text.split(credential).join("[已隐藏]");
  }
  return text.replace(/<[^>]*>/g, "").replace(/Bearer\s+[\w.+/~=-]+/gi, "[已隐藏]")
    .replace(/eyJ[\w-]+\.[\w-]+\.[\w-]+/g, "[已隐藏]")
    .replace(/https?:\/\/[^\s]+\?[^\s]+/g, "[链接]").replace(/[\r\n]+/g, " ").slice(0, 90);
}

function status(task) {
  return { "-1": "未完成", "0": "未完成", "1": "待领取", "2": "已领取" }[String(task.progressStatus)] || "状态未知";
}

function finish(title, text) {
  if (completed) return;
  completed = true;
  if (watchdog !== null) clearTimeout(watchdog);
  try {
    console.log("[" + NAME + "] " + text);
    $notification.post(NAME, title, text);
  } catch (ignored) {
    // 通知不可用时仍结束脚本，不重复查询。
  } finally {
    $done();
  }
}

function inspect() {
  token = $persistentStore.read("sgxh_token_xh") || $persistentStore.read("sgxh_token_wx") || $persistentStore.read("sgxh_token") || "";
  if (!token) {
    finish("缺少凭据", "请在 Surge 启用三国咸话模块，并在小程序打开福利页和热力竹页面。");
    return;
  }
  watchdog = setTimeout(() => finish("查询超时", "未执行任务或领奖操作，请检查网络后重试。"), 12000);
  $httpClient.get({
    url: LIST_URL,
    headers: {
      authorization: token, "app-code": "2", platform: "weixin", "app-system": "weixin",
      "app-version": "8.0.0", "appversion-code": "800", "current-uri": "subPackages/index/welfare/welfare",
      accept: "application/json"
    },
    timeout: 10,
    "auto-cookie": false,
    "auto-redirect": false
  }, (error, response, data) => {
    if (completed) return;
    if (error) {
      finish("网络请求失败", "未执行任务或领奖操作，请检查网络后重试。");
      return;
    }
    const code = Number(response && response.status) || 0;
    let json;
    try { json = JSON.parse(data || "{}"); } catch (ignored) {}
    if (code !== 200 || !json || String(json.code) !== "1000" || json.success === false || !Array.isArray(json.data)) {
      finish("查询失败", "HTTP " + code + "，请检查凭据和网络。");
      return;
    }
    const lines = json.data.filter(task => task && typeof task === "object").map(task => {
      const cycle = { 1: "每日", 2: "每周", 3: "一次性/累计" }[Number(task.taskType)] || "其他";
      const label = safeText(task.taskDesc || task.taskName || task.taskId || "任务");
      const current = task.currentProgressValue == null ? "?" : safeText(task.currentProgressValue);
      const target = task.targetProgressValue == null ? "?" : safeText(task.targetProgressValue);
      return "[" + cycle + "] " + label + ": " + current + "/" + target + " | " + status(task);
    });
    finish("任务列表（只查询）", lines.join("\n") || "服务器未返回任务。");
  });
}

try {
  inspect();
} catch (e) {
  // 不打印可能包含 token 的原始网络或存储异常。
  finish("诊断未完成", "请检查 Surge 本机凭据与网络；未执行任务或领奖操作。");
}
