// 蜂巢 (pting.club) 每日自动签到 (Surge Cron / Generic 兼容)
// 凭据来源: $persistentStore (pting_cookie)
// 签到端点: POST https://pting.club/api/check-in  {"action":"check-in"}

const NAME = "蜂巢签到";
const COOKIE_KEY = "pting_cookie";
const CHECK_URL = "https://pting.club/api/check-in";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

function handleResponse(body, status) {
  const json = parseJSON(body);
  if (!json) {
    const raw = String(body || "").slice(0, 120);
    console.log(`[${NAME}] 响应非 JSON: ${raw}`);
    $notification.post(NAME, "签到结果异常", `HTTP ${status}\n${raw}`);
    return;
  }

  console.log(`[${NAME}] 签到响应: ${JSON.stringify(json)}`);
  const code = json.code;
  const msg = json.message || json.msg || "";
  const data = json.data || {};

  const already = (data.alreadyCheckedIn === true || data.checked === true || msg.indexOf("已签") !== -1);
  const reward = data.reward != null ? ` 奖励: +${data.reward}` : "";
  const streakNum = data.streak != null ? data.streak : data.currentCheckInStreak;
  const streak = streakNum != null ? ` | 连续: ${streakNum} 天` : "";
  const pointNum = data.points != null ? data.points : data.score;
  const point = pointNum != null ? ` | 积分: ${pointNum}` : "";

  let detail = `${reward}${streak}${point}`.trim();
  if (detail.startsWith("|")) detail = detail.slice(1).trim();

  if (status === 401 || code === 401) {
    console.log(`[${NAME}] 登录凭据失效`);
    $notification.post(NAME, "未登录 (Cookie 已失效)", "请在 Safari 重新登录 pting.club 并刷新页面更新凭据");
    return;
  }

  if (status >= 200 && status < 300) {
    const title = already ? "今天已签过" : "签到成功";
    $notification.post(NAME, title, detail || (msg || "操作已完成"));
    return;
  }

  $notification.post(NAME, "签到失败", `HTTP ${status} | ${msg || ("code=" + code)}`);
}

function checkin() {
  const cookie = $persistentStore.read(COOKIE_KEY) || "";
  if (!cookie) {
    const hint = "未检测到 Cookie，请先在浏览器登录 pting.club 并访问任意页面";
    console.log(`[${NAME}] ${hint}`);
    $notification.post(NAME, "没有 Cookie", hint);
    $done({ summary: hint });
    return;
  }

  $httpClient.post({
    url: CHECK_URL,
    headers: {
      "Content-Type": "application/json",
      "Accept": "application/json",
      "Origin": "https://pting.club",
      "Referer": "https://pting.club/",
      "Cookie": cookie,
      "User-Agent": UA
    },
    body: JSON.stringify({ action: "check-in" })
  }, (err, resp, body) => {
    if (err) {
      console.log(`[${NAME}] 请求出错: ${err}`);
      $notification.post(NAME, "请求失败", String(err));
      $done({ summary: `请求失败: ${err}` });
      return;
    }

    const status = Number(resp && (resp.status || resp.statusCode)) || 0;
    handleResponse(body, status);
    $done({ summary: `HTTP ${status}` });
  });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中执行此脚本" });
} else {
  try {
    checkin();
  } catch (e) {
    console.log(`[${NAME}] 运行异常: ${e}`);
    $notification.post(NAME, "脚本运行异常", String(e));
    $done({ summary: `异常: ${e}` });
  }
}
