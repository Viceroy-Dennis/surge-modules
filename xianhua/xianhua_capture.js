// 三国咸话登录凭据与领奖抓包脚本 (Surge http-request)
// 1. 无条件可靠捕获当前登录头并存入 sgxh_headers / sgxh_token（彻底移除 HS256 过滤限制）
// 2. 核心侦听：监听用户在小程序内点击「领取」的 POST 动作，自动记录真实领奖接口！
// 3. 节流通知：每 8 秒最多弹 1 次通知，告知捕获状态

const NAME = "三国咸话";
const HEADER_KEY = "sgxh_headers";
const TOKEN_KEY = "sgxh_token";
const COOKIE_KEY = "sgxh_cookie";
const REWARD_URL_KEY = "sgxh_confirmed_reward_url";
const TIME_KEY = "sgxh_capture_time";
const NOTIFY_KEY = "sgxh_last_notify";

const DROP = { host: 1, connection: 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };

function lowerHeaders(h) {
  const o = {};
  Object.keys(h || {}).forEach((k) => { o[String(k).toLowerCase()] = String(h[k]); });
  return o;
}

function cookieMap(cookie) {
  const o = {};
  String(cookie || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

function pickToken(h) {
  const c = cookieMap(h.cookie);
  const tok = h.authorization || h.token || h["x-token"] || h["x-auth-token"] ||
    h.accesstoken || h["access-token"] || c.token || "";
  return String(tok || "").trim();
}

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const url = String($request.url || "");
    const method = String($request.method || "GET").toUpperCase();
    const host = (url.match(/^https?:\/\/([^/]+)/i) || ["", ""])[1].toLowerCase();
    const raw = $request.headers || {};
    const h = lowerHeaders(raw);
    const tok = pickToken(h);
    const bodyStr = String($request.body || "");

    // 1. 核心侦听：如果在小程序内点了「领取」或其他 POST 业务动作
    if (method === "POST" && !url.includes("updateTaskProgress") && !url.includes("signIn") && !url.includes("openMiniApp")) {
      console.log(`[${NAME}] 捕获 POST 请求: ${url} body=${bodyStr}`);
      if (/task|reward|receive|claim|award|get|draw/i.test(url) || /taskId|id/i.test(bodyStr)) {
        $persistentStore.write(url, REWARD_URL_KEY);
        console.log(`[${NAME}] 🎯 已捕获真实领奖接口: ${url}`);
        $notification.post(
          NAME,
          "🎯 真实领奖接口已锁定！",
          `接口: ${url.replace(/^https?:\/\/[^/]+/i, "")}\n参数: ${bodyStr.slice(0, 100)}`
        );
      }
    }

    if (!tok || tok.length < 8) {
      $done({});
    } else {
      const saved = {};
      Object.keys(h).forEach((k) => {
        if (!DROP[k] && h[k] !== "") saved[k] = h[k];
      });

      // 无论哪个域名，只要有有效 Token 立即保存
      $persistentStore.write(tok, TOKEN_KEY);
      $persistentStore.write(JSON.stringify(saved), HEADER_KEY);
      $persistentStore.write(String(Date.now()), TIME_KEY);

      if (h.cookie) {
        $persistentStore.write(h.cookie, COOKIE_KEY);
      }

      console.log(`[${NAME}] 鉴权头已更新: ${method} ${url.replace(/^https?:\/\/[^/]+/i, "")}`);

      // 节流通知 (8秒)
      const lastNotify = Number($persistentStore.read(NOTIFY_KEY) || 0);
      if (Date.now() - lastNotify > 8000) {
        $persistentStore.write(String(Date.now()), NOTIFY_KEY);
        $notification.post(
          NAME,
          "登录凭据已更新 ✅",
          `来源: ${host}\nToken 长度: ${tok.length} 位\n随时可运行任务！`
        );
      }

      $done({});
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
