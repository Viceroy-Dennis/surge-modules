// 途虎养车 —— Surge 每日自动签到任务 (Cron / Generic 兼容)
// 包含：用户资产查询 + 双签任务 (App 签到 + 微信小程序签到) + 积分与抵现余额汇总
// 凭据读取: tuhu_token (支持单/多账号数组或字符串), tuhu_blackbox

const NAME = "途虎养车";
const TOKEN_KEY = "tuhu_token";
const BOX_KEY = "tuhu_blackbox";
const DEFAULT_BOX = "kMPSQ1710898198mf9JVT5oKB5";

function readTokens() {
  const raw = $persistentStore.read(TOKEN_KEY);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === "string" && v) return [v];
    return [];
  } catch (e) {
    return String(raw) ? [String(raw)] : [];
  }
}

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

function sendPost(url, headers, body) {
  return new Promise((resolve) => {
    $httpClient.post({
      url: url,
      headers: headers,
      body: typeof body === "string" ? body : JSON.stringify(body || {})
    }, (error, response, resBody) => {
      if (error) {
        resolve({ error: String(error), status: 0, body: "" });
      } else {
        const status = Number(response && (response.status || response.statusCode)) || 0;
        resolve({ error: null, status, body: String(resBody || "") });
      }
    });
  });
}

// 1. 查询当前用户信息
async function whoami(token) {
  const res = await sendPost(
    "https://cl-gateway.tuhu.cn/cl-user-info-site/userAccount/getCurrentUserInfo",
    {
      "Authorization": token,
      "authType": "oauth",
      "Content-Type": "application/json",
      "X-Surge-Task": "1"
    },
    {}
  );

  const j = parseJSON(res.body);
  if (res.status === 200 && j && j.code === 10000 && j.data) {
    const { nickName, mobile } = j.data;
    const maskedMobile = mobile ? `${mobile.slice(0, 3)}****${mobile.slice(-4)}` : "";
    return { ok: true, name: nickName || maskedMobile || "途虎车主", mobile: maskedMobile };
  }

  if (res.status === 401 || (j && (j.code === 401 || /token无效|未登录/i.test(res.body)))) {
    return { ok: false, expired: true, msg: "Token 已失效" };
  }

  return { ok: false, msg: j ? (j.message || j.msg) : `HTTP ${res.status}` };
}

// 2. 签到动作 (支持 app 与 wxapp)
async function doCheckIn(token, blackbox, type, label) {
  const res = await sendPost(
    "https://cl-gateway.tuhu.cn/cl-common-api/api/dailyCheckIn/userCheckIn",
    {
      "Authorization": token,
      "Content-Type": "application/json",
      "authType": "oauth",
      "blackbox": blackbox || DEFAULT_BOX,
      "api_level": "2",
      "channel": "iOS",
      "version": "7.40.0",
      "needErrorCode": "true",
      "X-Surge-Task": "1"
    },
    { channel: type }
  );

  const j = parseJSON(res.body);
  if (res.status === 200 && j) {
    if (j.data && j.data.rewardIntegral != null) {
      const days = j.data.continuousDays != null ? ` (连签 ${j.data.continuousDays} 天)` : "";
      return `✅ ${label}: 成功 +${j.data.rewardIntegral}积分${days}`;
    }
    const msg = j.message || j.msg || "";
    if (/已签|重复|今日已/.test(msg)) {
      return `👌 ${label}: 今日已签过`;
    }
    return `ℹ️ ${label}: ${msg || "已完成"}`;
  }

  if (res.status === 401 || (j && j.code === 401)) {
    return `❌ ${label}: 凭据失效 (401)`;
  }

  return `⚠️ ${label}: 失败 (${(j && (j.message || j.code)) || "HTTP " + res.status})`;
}

// 3. 查询当前积分
async function getPoints(token) {
  const res = await sendPost(
    "https://api.tuhu.cn/User/GetPersonalCenterQuantity",
    {
      "Authorization": token,
      "Content-Type": "application/json",
      "X-Surge-Task": "1"
    },
    {}
  );

  const j = parseJSON(res.body);
  if (j && j.Code === 1 && j.IntegralNumber != null) {
    const pts = j.IntegralNumber;
    const money = (pts / 100).toFixed(2);
    return `🪙 当前积分: ${pts} 分 (可抵扣 ¥${money})`;
  }
  return "";
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  const tokens = readTokens();
  const blackbox = $persistentStore.read(BOX_KEY) || DEFAULT_BOX;

  if (!tokens.length) {
    const msg = "未找到途虎 Token！\n💡 请在 Surge 启用模块后，打开「途虎养车」App 或微信小程序即可自动抓取";
    console.log(`[${NAME}] ${msg}`);
    $notification.post(NAME, "缺少登录凭据", msg);
    $done({ summary: msg });
    return;
  }

  console.log(`[${NAME}] 共检测到 ${tokens.length} 个账号，开始执行任务...`);
  const allReports = [];

  for (let i = 0; i < tokens.length; i++) {
    const rawToken = tokens[i];
    const token = rawToken.startsWith("Bearer ") ? rawToken : `Bearer ${rawToken}`;
    const accountTag = tokens.length > 1 ? `[账号 ${i + 1}] ` : "";

    // 1. 获取用户信息
    const user = await whoami(token);
    if (!user.ok) {
      if (user.expired) {
        allReports.push(`${accountTag}凭据已失效，请重新打开途虎刷新`);
      } else {
        allReports.push(`${accountTag}登录检查失败: ${user.msg}`);
      }
      continue;
    }

    const lines = [];
    lines.push(`👤 车主: ${user.name}`);

    // 2. 双签任务：App 签到 + 微信小程序签到
    const appRes = await doCheckIn(token, blackbox, "app", "App签到");
    lines.push(appRes);
    await sleep(800);

    const wxRes = await doCheckIn(token, blackbox, "wxapp", "小程序签到");
    lines.push(wxRes);
    await sleep(800);

    // 3. 积分与抵现查询
    const ptsInfo = await getPoints(token);
    if (ptsInfo) lines.push(ptsInfo);

    allReports.push(lines.join("\n"));
  }

  const finalSummary = allReports.join("\n\n");
  console.log(`[${NAME}]\n${finalSummary}`);

  const hasExpired = finalSummary.includes("凭据已失效") || finalSummary.includes("401");
  const title = hasExpired ? "签到完成 (部分账号失效)" : "每日签到完成";

  $notification.post(NAME, title, finalSummary);
  $done({ summary: finalSummary });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中执行此脚本" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 脚本异常: ${e}`);
    $notification.post(NAME, "脚本运行异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
