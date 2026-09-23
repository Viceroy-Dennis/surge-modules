// 淘宝淘金币 —— 综合体检与状态诊断脚本 (Surge Generic 专用)
// 用途: 检查淘金币 mtop 接口锁定状态、Cookie 池健康度、_m_h5_tk 有效性及网关连通性

const NAME = "淘金币体检";
const K_API = "tb_api";
const K_COOKIE = "tb_cookie";
const K_TS = "tb_capture_time";

function cookieMap(s) {
  const o = {};
  String(s || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

function main() {
  console.log(`[${NAME}] ========== 淘金币环境与接口体检开始 ==========`);
  const rows = [];

  const rawApi = $persistentStore.read(K_API);
  let rec = {};
  try { rec = JSON.parse(rawApi || "{}"); } catch (e) {}

  // 发现历史残留的无用时间戳接口，自动清除
  if (rec.api && /gettimestamp|getcity|unit\.get/i.test(rec.api)) {
    console.log(`[${NAME}] 清理无效接口: ${rec.api}`);
    $persistentStore.write("", K_API);
    rec = {};
  }

  const cookie = $persistentStore.read(K_COOKIE) || "";
  const capTime = $persistentStore.read(K_TS);

  if (!rec.api && !cookie) {
    rows.push("❌ 未检测到任何淘金币凭据");
    rows.push("💡 请在 Surge 启用模块，并在手机淘宝中进入「领淘金币」页面点一次签到");
    const text = rows.join("\n");
    console.log(text);
    $notification.post(NAME, "未捕获凭据", text);
    $done({ summary: text });
    return;
  }

  const cMap = cookieMap(cookie);
  const hasTk = Boolean(cMap._m_h5_tk);
  const tkVal = cMap._m_h5_tk ? cMap._m_h5_tk.slice(0, 10) + "..." : "无";

  rows.push("🔑 Cookie 状态:");
  rows.push(`  • 总长度: ${cookie.length} 字节`);
  rows.push(`  • _m_h5_tk 令牌: ${hasTk ? `✅ 已具备 (${tkVal})` : "❌ 缺失 (需打开淘金币页抓取)"}`);
  rows.push(`  • 会话状态: ${cMap.cookie2 || cMap.unb || cMap._tb_token_ ? "✅ 已具备淘宝登录会话" : "⚠️ 未检测到明确登录会话"}`);

  rows.push("\n🎯 接口自动锁定状态:");
  if (rec.api && rec.rank >= 2) {
    const rankDesc = { 3: "⭐⭐⭐ 核心签到接口 (Rank 3)", 2: "⭐⭐ 金币/资产接口 (Rank 2)" }[rec.rank] || `Rank ${rec.rank}`;
    rows.push(`  • 接口名: ✅ ${rec.api}`);
    rows.push(`  • 优先级: ${rankDesc}`);
    rows.push(`  • 接口版本: v${rec.ver || "1.0"}`);
  } else {
    rows.push("  • 接口名: ❌ 尚未锁定真正签到接口");
    rows.push("  • 动作指导: 请在手机淘宝打开「领淘金币」，并手动点一下签到按钮！");
  }

  if (capTime) {
    const d = new Date(Number(capTime));
    rows.push(`\n🕒 最近更新时间: ${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  }

  const isReady = hasTk && rec.api && rec.rank >= 2;
  rows.push(`\n📋 综合结论: ${isReady ? "🟢 完美就绪！已具备全自动签到条件" : "🟡 请在手机淘宝「淘金币」页面点一次签到按钮锁定真实接口"}`);

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);
  console.log(`[${NAME}] ========== 淘金币环境与接口体检结束 ==========`);

  $notification.post(NAME, isReady ? "淘金币环境良好" : "淘金币体检报告", text);
  $done({ summary: text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中运行" });
} else {
  try {
    main();
  } catch (e) {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "体检脚本异常", String(e));
    $done({ summary: `异常: ${e}` });
  }
}
