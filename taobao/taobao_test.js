// 淘宝淘金币 —— 综合体检与状态诊断脚本 v3 (Surge Generic 专用)
// 用途: 检查四类接口模板锁定状态、Cookie 池健康度、_m_h5_tk 令牌、上次任务执行结果

const NAME = "淘金币体检";
const K_POOL = "tb_tpl";
const K_API = "tb_api";
const K_COOKIE = "tb_cookie";
const K_TS = "tb_capture_time";
const K_LOG = "tb_task_log";
const ROLE_NAME = { sign: "签到", list: "任务列表", done: "完成上报", award: "领奖", other: "金币查询" };

function parseJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function cookieMap(s) {
  const o = {};
  String(s || "").split(";").forEach((p) => { const i = p.indexOf("="); if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim(); });
  return o;
}
function fmt(ts) { return new Date(Number(ts)).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai", hour12: false }); }

function main() {
  console.log(`[${NAME}] ========== 淘金币体检开始 ==========`);
  const rows = [];
  const pool = parseJSON($persistentStore.read(K_POOL) || "") || {};
  const old = parseJSON($persistentStore.read(K_API) || "");
  if (old && old.api && !pool[old.api] && !/gettimestamp|getcity|unit\.get/i.test(old.api)) {
    old.role = /sign|checkin/i.test(old.api) ? "sign" : "other";
    pool[old.api] = old;
  }
  const cookie = $persistentStore.read(K_COOKIE) || "";
  const capTime = $persistentStore.read(K_TS);
  const lastLog = parseJSON($persistentStore.read(K_LOG) || "");

  if (!Object.keys(pool).length && !cookie) {
    const text = "❌ 未检测到任何淘金币凭据\n💡 启用模块后在手机淘宝打开「领淘金币」任务面板，点一次签到、去完成、领取奖励";
    console.log(text);
    $notification.post(NAME, "未捕获凭据", text);
    $done({ summary: text });
    return;
  }

  const cMap = cookieMap(cookie);
  const hasTk = Boolean(cMap._m_h5_tk);
  rows.push("🔑 Cookie 状态:");
  rows.push(`  • 总长度: ${cookie.length} 字节`);
  rows.push(`  • _m_h5_tk 令牌: ${hasTk ? `✅ ${cMap._m_h5_tk.slice(0, 10)}...` : "❌ 缺失 (需打开淘金币页)"}`);
  rows.push(`  • 登录会话: ${cMap.cookie2 || cMap.unb || cMap._tb_token_ ? "✅ 已具备" : "⚠️ 未检测到"}`);

  rows.push("\n🎯 接口模板锁定状态:");
  const roles = ["sign", "list", "done", "award"];
  let ready = 0;
  roles.forEach((r) => {
    const recs = Object.keys(pool).map((k) => pool[k]).filter((x) => x && x.role === r).sort((a, b) => Number(b.ts) - Number(a.ts));
    if (recs.length) {
      ready++;
      const x = recs[0];
      rows.push(`  ✅ ${ROLE_NAME[r]}: ${x.api} (${x.method} v${x.ver || "1.0"})`);
      if (x.params && x.params.data) rows.push(`     data: ${String(x.params.data).slice(0, 70)}`);
    } else {
      const tip = { sign: "点一次签到", list: "打开任务面板", done: "点一个「去完成」", award: "点一个「领取奖励」" }[r];
      rows.push(`  ⬜ ${ROLE_NAME[r]}: 未锁定 → ${tip}`);
    }
  });
  const others = Object.keys(pool).filter((k) => pool[k].role === "other");
  if (others.length) rows.push(`  ℹ️ 其他金币接口 ${others.length} 个: ${others.slice(0, 3).join(", ")}`);

  if (capTime) rows.push(`\n🕒 模板更新时间: ${fmt(capTime)}`);
  if (lastLog && lastLog.ts) rows.push(`\n📜 上次执行 (${fmt(lastLog.ts)}):\n${String(lastLog.text).split("\n").slice(0, 6).join("\n")}`);

  const full = ready === 4 && hasTk;
  rows.push(`\n📋 结论: ${full ? "🟢 四项接口齐全，可全自动跑任务" : ready >= 1 && hasTk ? `🟡 已锁定 ${ready}/4 项，按提示补齐` : "🔴 请打开淘金币任务面板操作一遍"}`);

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}\n[${NAME}] ========== 体检结束 ==========`);
  $notification.post(NAME, full ? "淘金币环境良好" : "淘金币体检报告", text);
  $done({ summary: text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中运行" });
} else {
  try { main(); } catch (e) {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "体检脚本异常", String(e));
    $done({ summary: `异常: ${e}` });
  }
}
