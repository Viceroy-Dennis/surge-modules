// 途虎养车 —— 综合体检与状态诊断脚本 (Surge Generic 专用)
// 用途: 检查 Token 存活状态、车主昵称、blackbox 设备风控值与实时积分抵现余额 (只读安全诊断，不消耗签到)

const NAME = "途虎体检";
const TOKEN_KEY = "tuhu_token";
const BOX_KEY = "tuhu_blackbox";
const TIME_KEY = "tuhu_capture_time";

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

async function main() {
  console.log(`[${NAME}] ========== 途虎养车环境体检开始 ==========`);
  const tokens = readTokens();
  const blackbox = $persistentStore.read(BOX_KEY) || "";
  const capTime = $persistentStore.read(TIME_KEY);

  const rows = [];

  if (!tokens.length) {
    rows.push("❌ 未检测到途虎 Token (tuhu_token)");
    rows.push("💡 请在 Surge 启用模块后，打开「途虎养车」App 或微信小程序自动保存凭据");
    const text = rows.join("\n");
    console.log(text);
    $notification.post(NAME, "未捕获凭据", text);
    $done({ summary: text });
    return;
  }

  rows.push(`🔑 Token 状态: 已捕获 ${tokens.length} 个账号`);
  rows.push(`🛡️ 设备风控 (blackbox): ${blackbox ? "✅ 已捕获 (" + blackbox.slice(0, 10) + "...)" : "⚠️ 未捕获 (将使用默认保底值)"}`);

  if (capTime) {
    const d = new Date(Number(capTime));
    rows.push(`🕒 最近更新时间: ${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  }

  // 逐个诊断账号
  for (let i = 0; i < tokens.length; i++) {
    const rawToken = tokens[i];
    const token = rawToken.startsWith("Bearer ") ? rawToken : `Bearer ${rawToken}`;
    const tag = tokens.length > 1 ? `\n--- 账号 [${i + 1}] ---` : "\n📋 账号信息:";
    rows.push(tag);

    // 1. 测试个人信息接口
    const userRes = await sendPost(
      "https://cl-gateway.tuhu.cn/cl-user-info-site/userAccount/getCurrentUserInfo",
      {
        "Authorization": token,
        "authType": "oauth",
        "Content-Type": "application/json",
        "X-Surge-Task": "1"
      },
      {}
    );

    const userJson = parseJSON(userRes.body);
    if (userRes.status === 200 && userJson && userJson.code === 10000 && userJson.data) {
      const { nickName, mobile, userId } = userJson.data;
      const maskPhone = mobile ? `${mobile.slice(0, 3)}****${mobile.slice(-4)}` : "未知";
      rows.push(`  • 车主昵称: ${nickName || "未设置"}`);
      rows.push(`  • 绑定手机: ${maskPhone}`);
      rows.push(`  • 凭据状态: 🟢 存活有效`);
    } else if (userRes.status === 401 || (userJson && userJson.code === 401)) {
      rows.push(`  • 凭据状态: 🔴 已失效 (HTTP 401: Token 无效或过期)`);
      rows.push(`  • 修复建议: 请打开途虎养车 App 重新抓取`);
      continue;
    } else {
      rows.push(`  • 凭据状态: 🟡 异常 (${userJson ? userJson.message : "HTTP " + userRes.status})`);
    }

    // 2. 测试积分资产接口
    const ptsRes = await sendPost(
      "https://api.tuhu.cn/User/GetPersonalCenterQuantity",
      {
        "Authorization": token,
        "Content-Type": "application/json",
        "X-Surge-Task": "1"
      },
      {}
    );

    const ptsJson = parseJSON(ptsRes.body);
    if (ptsJson && ptsJson.Code === 1 && ptsJson.IntegralNumber != null) {
      const pts = ptsJson.IntegralNumber;
      const money = (pts / 100).toFixed(2);
      rows.push(`  • 积分余额: 🪙 ${pts} 积分`);
      rows.push(`  • 抵现价值: 💰 可抵扣 ¥${money} 元`);
    } else {
      rows.push(`  • 积分查询: ⚠️ 未能获取积分信息`);
    }
  }

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);
  console.log(`[${NAME}] ========== 途虎养车环境体检结束 ==========`);

  const allAlive = !text.includes("🔴 已失效");
  $notification.post(NAME, allAlive ? "途虎账号状态正常" : "途虎体检诊断报告", text);
  $done({ summary: text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中运行" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "体检脚本异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
