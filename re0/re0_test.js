// RE0 (re0.me) 综合体检与盾墙状态诊断脚本 (Surge Generic 专用)
// 用途: 检查 Cloudflare 通行证 (cf_clearance)、Action ID、真实 UA 绑定状态

const NAME = "RE0体检诊断";
const K_COOKIE = "re0_cookie";
const K_HDR = "re0_headers";
const K_URL = "re0_url";
const K_ACT = "re0_action";
const K_UA = "re0_ua";
const K_TS = "re0_capture_time";

function cookieMap(s) {
  const o = {};
  String(s || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

function main() {
  console.log(`[${NAME}] ========== RE0 签到与盾墙体检开始 ==========`);
  const rows = [];

  const cookie = $persistentStore.read(K_COOKIE) || "";
  const actId = $persistentStore.read(K_ACT) || "";
  const ua = $persistentStore.read(K_UA) || "";
  const capTime = $persistentStore.read(K_TS);
  const targetUrl = $persistentStore.read(K_URL) || "https://re0.me/";

  if (!cookie && !actId) {
    rows.push("❌ 未检测到任何凭据");
    rows.push("💡 请在 Surge 启用模块，用 Safari 打开 re0.me 并手动点一次签到");
    const text = rows.join("\n");
    console.log(text);
    $notification.post(NAME, "未捕获凭据", text);
    $done({ summary: text });
    return;
  }

  const cMap = cookieMap(cookie);
  const hasCf = Boolean(cMap.cf_clearance);
  const hasHdh = Boolean(cMap.hdh_sa_token);

  rows.push("🛡️ Cloudflare 盾墙通行状态:");
  if (hasCf) {
    rows.push(`  • cf_clearance: ✅ 已就绪 (${cMap.cf_clearance.slice(0, 10)}...)`);
  } else {
    rows.push("  • cf_clearance: ❌ 缺失 (可能会被 CF 403 拦截)");
  }

  if (ua) {
    const isMobile = ua.includes("iPhone") || ua.includes("Mobile");
    rows.push(`  • 真实 UA 绑定: ✅ 已对齐 (${isMobile ? "移动端 Safari" : "桌面端"})`);
  } else {
    rows.push("  • 真实 UA 绑定: ⚠️ 未捕获 (使用默认 UA)");
  }

  rows.push("\n🎯 Next.js Server Action 状态:");
  if (actId) {
    rows.push(`  • Action ID: ✅ 已锁定 (${actId.slice(0, 10)}...)`);
  } else {
    rows.push("  • Action ID: ❌ 未获取 (无法发起签到动作)");
  }

  if (hasHdh) {
    rows.push(`  • hdh_sa_token: ✅ 已取得 (${cMap.hdh_sa_token.slice(0, 8)}...)`);
  } else {
    rows.push("  • hdh_sa_token: ⚠️ 初始空 (脚本执行时会自动换取)");
  }

  if (capTime) {
    const d = new Date(Number(capTime));
    rows.push(`\n🕒 最近捕获时间: ${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  }

  // 综合评价
  let ready = hasCf && actId && ua;
  rows.push(`\n📋 综合结论: ${ready ? "🟢 完美！已具备绕开 CF 盾墙的全部条件" : "🟡 建议在 Safari 页面内手动点一次签到补齐凭证"}`);

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);
  console.log(`[${NAME}] ========== RE0 签到与盾墙体检结束 ==========`);

  $notification.post(NAME, ready ? "盾墙与凭据状态良好" : "凭据体检诊断", text);
  $done({ summary: text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中执行此脚本" });
} else {
  try {
    main();
  } catch (e) {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "体检脚本异常", String(e));
    $done({ summary: `异常: ${e}` });
  }
}
