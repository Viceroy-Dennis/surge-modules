// 三国咸话 —— Surge 登录凭据抓包脚本 (http-request)
// 彻底解决 Token 互相覆盖的根因：双通道独立存储
// 1. wxforum 签到通道 -> 存入 sgxh_token_wx 与 sgxh_headers_wx (HS256 算法)
// 2. api-xh 社区/任务通道 -> 存入 sgxh_token_xh 与 sgxh_headers_xh (RS256 算法)
// 互不覆盖，永不污染！

const NAME = "三国咸话";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const COOKIE_KEY = "sgxh_cookie";
const REWARD_URL_KEY = "sgxh_confirmed_reward_url";

// 兼容旧键
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";
const TIME_KEY = "sgxh_capture_time";

const HOST_RE = /(^|\.)(api-xh|wxforum|xh|hi-gateway|api-forum-act|xianhua)\.sanguosha\.cn$/i;
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

function mergeCookie(oldValue, newValue) {
  const o = cookieMap(oldValue);
  const n = cookieMap(newValue);
  Object.keys(n).forEach((k) => { if (n[k] !== "") o[k] = n[k]; });
  return Object.keys(o).map((k) => k + "=" + o[k]).join("; ");
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

    if (!HOST_RE.test(host)) {
      $done({});
    } else {
      const method = String($request.method || "GET").toUpperCase();
      const bodyStr = String($request.body || "");

      // 核心侦听：如果在小程序内点了【领取】或其他 POST 领奖动作
      if (method === "POST" && !url.includes("updateTaskProgress") && !url.includes("signIn") && !url.includes("openMiniApp") && !url.includes("likes")) {
        console.log(`[${NAME}] 捕获 POST 请求: ${url} body=${bodyStr}`);
        if (/task|reward|receive|claim|award|bonus|get|draw/i.test(url) || /taskId|task_id|bonus/i.test(bodyStr)) {
          $persistentStore.write(url, REWARD_URL_KEY);
          console.log(`[${NAME}] 🎯 成功捕获真实领奖接口: ${url}`);
          $notification.post(
            NAME,
            "🎯 真实领奖接口已锁定！",
            `接口: ${url.replace(/^https?:\/\/[^/]+/i, "")}\n参数: ${bodyStr.slice(0, 100)}\n后续自动调用此接口领奖！`
          );
        }
      }

      const h = lowerHeaders($request.headers || {});
      const tok = pickToken(h);

      // 合并 Cookie
      if (h.cookie) {
        const oldCookie = $persistentStore.read(COOKIE_KEY) || "";
        const merged = mergeCookie(oldCookie, h.cookie);
        if (merged) $persistentStore.write(merged, COOKIE_KEY);
      }

      if (!tok || tok.length < 8) {
        $done({});
      } else {
        const saved = {};
        Object.keys(h).forEach((k) => {
          if (!DROP[k] && h[k] !== "") saved[k] = h[k];
        });

        const isXh = /api-xh|xh\.sanguosha|api-forum-act/i.test(host);
        const isWx = /wxforum/i.test(host);

        if (isXh) {
          const oldXh = $persistentStore.read(TOKEN_XH_KEY) || "";
          $persistentStore.write(tok, TOKEN_XH_KEY);
          $persistentStore.write(JSON.stringify(saved), HDR_XH_KEY);
          $persistentStore.write(String(Date.now()), TIME_KEY);
          console.log(`[${NAME}] 捕获到【社区/任务 api-xh】核心凭据: ${tok.slice(0, 10)}...`);

          if (tok !== oldXh) {
            $notification.post(NAME, "社区任务凭据已锁定 🎯", `通道: api-xh (浏览/任务)\nToken 长度: ${tok.length} 位`);
          }
        } else if (isWx) {
          const oldWx = $persistentStore.read(TOKEN_WX_KEY) || "";
          $persistentStore.write(tok, TOKEN_WX_KEY);
          $persistentStore.write(JSON.stringify(saved), HDR_WX_KEY);
          $persistentStore.write(String(Date.now()), TIME_KEY);
          console.log(`[${NAME}] 捕获到【签到 wxforum】凭据: ${tok.slice(0, 10)}...`);

          if (tok !== oldWx) {
            $notification.post(NAME, "签到凭据已更新 ✅", `通道: wxforum (签到)\nToken 长度: ${tok.length} 位`);
          }
        }

        // 兼容旧脚本
        $persistentStore.write(tok, TOKEN_KEY);
        $persistentStore.write(JSON.stringify(saved), HEADER_KEY);

        $done({});
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
