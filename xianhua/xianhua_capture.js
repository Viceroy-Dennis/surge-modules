// 三国咸话登录凭据抓包脚本 (Surge http-request)
// 核心优化：
// 1. 全域支持：覆盖 api-xh, wxforum, xh, hi-gateway, api-forum-act, xianhua 全线域名
// 2. 智能节流 (8秒)：每次打开小程序确保【恰好弹1次】捕获确认通知，绝不刷屏二十几个弹窗，也绝不无声无息！
// 3. 自动规整 Token：去除首尾空格，确保持久化写入 sgxh_token / sgxh_headers

const NAME = "三国咸话";
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";
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
    const host = (url.match(/^https?:\/\/([^/]+)/i) || ["", ""])[1].toLowerCase();
    const raw = $request.headers || {};
    const h = lowerHeaders(raw);
    const tok = pickToken(h);

    if (!tok || tok.length < 8) {
      $done({});
    } else {
      const oldTok = $persistentStore.read(TOKEN_KEY) || "";
      const isNew = (tok !== oldTok);

      const saved = {};
      Object.keys(h).forEach((k) => {
        if (!DROP[k] && h[k] !== "") saved[k] = h[k];
      });

      // 无论新旧，持续将最新请求头与 Token 写入存储
      $persistentStore.write(tok, TOKEN_KEY);
      $persistentStore.write(JSON.stringify(saved), HEADER_KEY);
      $persistentStore.write(String(Date.now()), TIME_KEY);

      // 节流通知：8 秒内最多弹 1 次通知，既不轰炸刷屏，又确保能看到捕获成功的反馈！
      const lastNotify = Number($persistentStore.read(NOTIFY_KEY) || 0);
      const isThrottled = (Date.now() - lastNotify < 8000);

      if (!isThrottled) {
        $persistentStore.write(String(Date.now()), NOTIFY_KEY);
        console.log(`[${NAME}] 成功捕获 Token: ${tok.slice(0, 10)}... (长 ${tok.length})`);
        $notification.post(
          NAME,
          "登录凭据已更新 ✅",
          `域名: ${host}\nToken: ${tok.slice(0, 8)}... (${isNew ? "全新凭据" : "已重新核验"})\n可随时在 Surge 运行每日任务！`
        );
      } else {
        console.log(`[${NAME}] 并发请求静默存盘`);
      }

      $done({});
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
