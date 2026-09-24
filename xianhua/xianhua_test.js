// 三国咸话 —— 综合体检与状态诊断脚本 (Surge Generic 专用)
// 用途: 一键诊断 wxforum (签到通道) 与 api-xh (任务/浏览通道) 的独立凭据健康状态

const NAME = "三国咸话测试";
const HEADER_KEY = "sgxh_headers";
const TOKEN_KEY = "sgxh_token";
const XH_HDR_KEY = "sgxh_xh_headers";
const XH_TOK_KEY = "sgxh_xh_token";
const WX_HDR_KEY = "sgxh_wx_headers";
const WX_TOK_KEY = "sgxh_wx_token";
const TIME_KEY = "sgxh_capture_time";

const LIST_URL = "https://api-xh.sanguosha.cn/task/sgxh-task/taskList";

const DROP = { host: 1, connection: 1, "keep-alive": 1, "proxy-connection": 1, "transfer-encoding": 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1 };

function savedHeaders(isXh) {
  const hdrRaw = (isXh ? ($persistentStore.read(XH_HDR_KEY) || $persistentStore.read(HEADER_KEY)) : ($persistentStore.read(WX_HDR_KEY) || $persistentStore.read(HEADER_KEY))) || "{}";
  const tokRaw = (isXh ? ($persistentStore.read(XH_TOK_KEY) || $persistentStore.read(TOKEN_KEY)) : ($persistentStore.read(WX_TOK_KEY) || $persistentStore.read(TOKEN_KEY))) || "";

  let saved = {};
  try { saved = JSON.parse(hdrRaw); } catch (e) {}

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
  return h;
}

function getJson(url, isXh) {
  return new Promise((resolve) => {
    $httpClient.get({
      url: url,
      headers: savedHeaders(isXh)
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

function parseJSON(body) {
  try { return JSON.parse(body || "{}"); } catch (e) { return null; }
}

async function main() {
  console.log(`[${NAME}] ========== 开始诊断 ==========`);
  const rows = [];

  const genTok = $persistentStore.read(TOKEN_KEY) || "";
  const wxTok = $persistentStore.read(WX_TOK_KEY) || genTok;
  const xhTok = $persistentStore.read(XH_TOK_KEY) || "";
  const capTime = $persistentStore.read(TIME_KEY);

  rows.push("🔑 双通道凭据捕获状态:");
  rows.push(`  • 签到通道 (wxforum): ${wxTok ? `✅ 已具备 (长 ${wxTok.length} 位)` : "❌ 缺失"}`);
  rows.push(`  • 社区/任务通道 (api-xh): ${xhTok ? `✅ 已具备 (长 ${xhTok.length} 位)` : "⚠️ 尚未捕获"}`);

  if (capTime) {
    const d = new Date(Number(capTime));
    rows.push(`🕒 最近捕获时间: ${d.toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}`);
  }

  // 测试任务列表
  console.log(`[${NAME}] 正在测试 api-xh 任务列表...`);
  const res = await getJson(LIST_URL, true);

  rows.push("\n📡 api-xh 任务网关实测:");
  if (res.status === 200) {
    rows.push(`  • 接口状态: 🟢 连通正常 (HTTP 200)`);
    const j = parseJSON(res.body);
    const tasks = (j && j.data) || [];
    rows.push(`  • 识别任务数: ${tasks.length} 项`);
  } else if (res.status === 401 || (res.body && res.body.includes("token已经过期"))) {
    rows.push(`  • 接口状态: 🔴 401 凭据缺失或已过期`);
    rows.push(`  • 💡 解决办法: 请在小程序里随便点进一个【帖子】或点击【社区】页面，即可自动抓取 api-xh 凭据！`);
  } else {
    rows.push(`  • 接口状态: 🟡 HTTP ${res.status} ${String(res.body).slice(0, 60)}`);
  }

  const text = rows.join("\n");
  console.log(`[${NAME}]\n${text}`);
  $notification.post(NAME, xhTok ? "咸话凭据完备" : "咸话体检诊断", text);
  $done({ summary: text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中运行" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "测试异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
