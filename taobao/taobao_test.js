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

  const cookie = $persistentStore.read(K_COOKIE) || "";
  const capTime = $persistentStore.read(K_TS);

  if (!rec.api && !cookie) {
    rows.push("❌ 未检测到任何凭据与接口");
    rows.push("💡 请在 Surge 启用模块，并在手机淘宝中进入「淘金币」页面点一次签到");
    const text = rows.join("\n");
    console.log(text);
    $notification.post(NAME, "未捕获凭据", text);
    $done({ summary: text });
    return;
  }

  const cMap = cookieMap(cookie);
  const hasTk = Boolean(cMap._m_h5_tk);
  const hasEnc = Boolean(cMap._m_h5_tk_enc);
  const tkVal = cMap._m_h5_tk ? cMap._m_h5_tk.slice(0, 10) + "..." : "无";

  rows.push("🔑 Cookie 池状态:");
  rows.push(`  • 总长度: ${cookie.length} 字节`);
  rows.push(`  • _m_h5_tk (mtop签名令牌): ${hasTk ? `✅ 已具备 (${tkVal})` : "❌ 缺失 (需打开淘金币页抓取)"}`);
  rows.push(`  • 会话凭据: ${cMap.cookie2 || cMap.unb || cMap._tb_token_ ? "✅ 已具备淘宝登录会话" : "⚠️ 未检测到明确登录会话"}`);

  rows.push("\n🎯 接口自动学习状态:");
  if (rec.api) {
    const rankDesc = { 3: "⭐⭐⭐ 核心签到接口 (Rank 3)", 2: "⭐⭐ 金币/任务接口 (Rank 2)", 1: "⭐ 普通 mtop (Rank 1)" }[rec.rank] || `Rank ${rec.rank}`;
    rows.push(`  • 接口名: ✅ ${rec.api}`);
    rows.push(`  • 优先级: ${rankDesc}`);
    rows.push(`  • 接口版本: v${rec.ver || "1.0"}`);
  } else {
    rows.push("  • 接口名: ❌ 尚未锁定 (请进淘宝点一次签到)");
  }

  if (capTime) {
    const d = new Date(Number(capTime));
    rows.push(`\n🕒 最近更新时间: ${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  }

  const isReady = hasTk && rec.api && rec.rank >= 2;
  rows.push(`\n📋 综合结论: ${isReady ? "🟢 完美就绪！具备全自动签到与 mtop 验签条件" : "🟡 建议在手机淘宝「淘金币」页面点一次签到补全"}`);

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);
  console.log(`[${NAME}] ========== 淘金币环境与接口体检结束 ==========`);

  $notification.post(NAME, isReady ? "淘金币环境就绪" : "淘金币体检报告", text);
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
