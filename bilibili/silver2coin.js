// B站银瓜子换硬币 —— Surge 自动任务与手动测试脚本
// 兼容: Surge / Loon / Quantumult X
// 修复点:
// 1. 修复老旧脚本使用 GET 导致 HTTP 405 Method Not Allowed 的致命缺陷（B站现强制要求 POST）
// 2. 迁移至最新直播钱包端点 (xlive/revenue/v1/wallet/silver2coin)
// 3. 自动提取 bili_jct 填入 csrf 与 csrf_token 参数
// 4. 兑换前自动查询钱包余额，银瓜子不足 700 (兑换门槛) 时智能跳过，避免无效请求
// 5. 兑换后自动同步硬币余额，输出清晰明了的通知

const NAME = "B站银瓜子换硬币";
const KEY = "chavy_cookie_bilibili";
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";

const cookie = ($persistentStore.read(KEY) || "").trim();
const mCsrf = cookie.match(/(?:^|;\s*)bili_jct\s*=\s*([^;]+)/);
const csrf = mCsrf && mCsrf[1] ? mCsrf[1].trim() : "";

const WALLET_URL = "https://api.live.bilibili.com/xlive/revenue/v1/wallet/myWallet?need_bp=1&need_metal=1&platform=pc";
const EXCHANGE_URL = "https://api.live.bilibili.com/xlive/revenue/v1/wallet/silver2coin";
const OLD_EXCHANGE_URL = "https://api.live.bilibili.com/pay/v1/Exchange/silver2coin";
const COIN_URL = "https://account.bilibili.com/site/getCoin";

function parseJSON(s) {
  try { return JSON.parse(s || "{}"); } catch (e) { return null; }
}

function reqGet(url) {
  return new Promise((resolve) => {
    $httpClient.get({
      url: url,
      headers: {
        "User-Agent": UA,
        "Referer": "https://live.bilibili.com/",
        "Origin": "https://live.bilibili.com",
        "Cookie": cookie
      }
    }, (err, resp, body) => {
      if (err) resolve({ err: String(err), status: 0, body: "" });
      else resolve({ err: null, status: Number(resp && (resp.status || resp.statusCode)) || 0, body: String(body || "") });
    });
  });
}

function reqPost(url, bodyData) {
  return new Promise((resolve) => {
    $httpClient.post({
      url: url,
      headers: {
        "User-Agent": UA,
        "Referer": "https://live.bilibili.com/",
        "Origin": "https://live.bilibili.com",
        "Content-Type": "application/x-www-form-urlencoded",
        "Cookie": cookie
      },
      body: bodyData
    }, (err, resp, body) => {
      if (err) resolve({ err: String(err), status: 0, body: "" });
      else resolve({ err: null, status: Number(resp && (resp.status || resp.statusCode)) || 0, body: String(body || "") });
    });
  });
}

async function main() {
  console.log(`[${NAME}] ========== 开始执行银瓜子换硬币 ==========`);

  if (!cookie) {
    const msg = "未检测到 B 站 Cookie！\n💡 请先开启 B 站抓包模块，在 B 站 App 刷新一次获取凭据";
    console.log(`[${NAME}] ${msg}`);
    $notification.post(NAME, "缺少 Cookie", msg);
    $done({ summary: msg });
    return;
  }

  // 1. 查询当前钱包状态与银瓜子余额
  const walletRes = await reqGet(WALLET_URL);
  const wJson = parseJSON(walletRes.body);

  if (wJson && wJson.code === -101) {
    const msg = "Cookie 已失效，请在 B 站 App 内重新登录并刷新一次";
    console.log(`[${NAME}] 登录失效`);
    $notification.post(NAME, "Cookie 已过期", msg);
    $done({ summary: msg });
    return;
  }

  let silver = null;
  if (wJson && wJson.code === 0 && wJson.data && wJson.data.silver != null) {
    silver = Number(wJson.data.silver);
    console.log(`[${NAME}] 当前银瓜子余额: ${silver}`);
  }

  // 银瓜子兑换汇率：700 银瓜子 = 1 硬币（每天上限 1 次）
  if (silver !== null && silver < 700) {
    const detail = `🪙 银瓜子不足 700 (当前仅有 ${silver})\n💡 兑换 1 枚硬币需要 700 银瓜子，今日跳过兑换`;
    console.log(`[${NAME}] ${detail}`);
    $notification.post(NAME, "银瓜子不足 (跳过兑换)", detail);
    $done({ summary: detail });
    return;
  }

  // 2. 发起兑换 POST 请求
  const postBody = `csrf=${encodeURIComponent(csrf)}&csrf_token=${encodeURIComponent(csrf)}&visit_id=`;
  let exRes = await reqPost(EXCHANGE_URL, postBody);
  let exJson = parseJSON(exRes.body);

  // 兜底：如果新端点异常，尝试经典 pay/v1 POST 端点
  if (!exJson || (exRes.status !== 200 && exRes.status !== 403)) {
    console.log(`[${NAME}] 尝试备用端点: ${OLD_EXCHANGE_URL}`);
    exRes = await reqPost(OLD_EXCHANGE_URL, postBody);
    exJson = parseJSON(exRes.body);
  }

  console.log(`[${NAME}] 兑换响应: HTTP ${exRes.status} -> ${exRes.body}`);

  // 3. 结果判读
  if (exJson && exJson.code === 0) {
    // 兑换成功
    const d = exJson.data || {};
    const coinGained = d.coin != null ? d.coin : 1;
    const silverLeft = d.silver != null ? d.silver : (silver !== null ? silver - 700 : "已扣除");

    // 尝试查询最新主站硬币余额
    let coinBalance = "";
    const coinRes = await reqGet(COIN_URL);
    const cJson = parseJSON(coinRes.body);
    if (cJson && cJson.data && cJson.data.coin != null) {
      coinBalance = ` | 当前硬币总额: ${cJson.data.coin}`;
    }

    const title = "兑换成功 🎉";
    const detail = `成功兑换: +${coinGained} 枚硬币${coinBalance}\n剩余银瓜子: ${silverLeft}`;
    console.log(`[${NAME}] ${title} ${detail}`);
    $notification.post(NAME, title, detail);
    $done({ summary: detail });
    return;
  }

  // 常见状态处理
  const msg = (exJson && (exJson.message || exJson.msg)) || `HTTP ${exRes.status}`;

  if (exJson && (exJson.code === 403 || /上限|已经兑换|每天只能|重复|不可兑换/i.test(msg))) {
    const detail = `今日兑换次数已达上限 (每天限兑 1 次)\n当前银瓜子: ${silver !== null ? silver : "充足"}`;
    console.log(`[${NAME}] ${detail}`);
    $notification.post(NAME, "今日已兑换过 👌", detail);
    $done({ summary: detail });
    return;
  }

  if (exJson && /余额不足|银瓜子不足/i.test(msg)) {
    const detail = `银瓜子不足 700 (无法兑换)\n提示: ${msg}`;
    console.log(`[${NAME}] ${detail}`);
    $notification.post(NAME, "银瓜子不足", detail);
    $done({ summary: detail });
    return;
  }

  if (exJson && exJson.code === -101) {
    const detail = "Cookie 已失效，请在 B 站 App 刷新重新抓取";
    $notification.post(NAME, "登录凭据已失效", detail);
    $done({ summary: detail });
    return;
  }

  const failDetail = `响应: ${msg}\n${exRes.body ? exRes.body.slice(0, 100) : "无数据"}`;
  console.log(`[${NAME}] 兑换未达成: ${failDetail}`);
  $notification.post(NAME, "兑换未达成", failDetail);
  $done({ summary: failDetail });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中运行此脚本" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 脚本异常: ${e}`);
    $notification.post(NAME, "脚本运行异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
