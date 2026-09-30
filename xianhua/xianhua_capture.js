// 三国咸话 —— Surge 登录凭据抓包脚本 (http-request)
// 1. 双通道隔离：wxforum (HS256) 与 api-xh (RS256) 完全独立存储，绝不互相覆盖
// 2. 智能领奖嗅探：捕获用户在小程序内点击【领取】时的真实接口 URL、Method、Body
// 3. 全流程可视化：只要是 POST 或 PUT 动作全部打印到日志，方便精准排查

const NAME = "三国咸话";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const COOKIE_KEY = "sgxh_cookie";
const REWARD_URL_KEY = "sgxh_confirmed_reward_url";
const REWARD_METHOD_KEY = "sgxh_confirmed_reward_method";
const REWARD_BODY_KEY = "sgxh_confirmed_reward_body";

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

      // 核心侦听：捕获用户在小程序内点击【领取】时的真实动作
      const isAction = method === "POST" || method === "PUT";
      const isKnownAction = /updateTaskProgress|signIn|openMiniApp|likes|share|topics\/\d+\/replies/i.test(url);

      if (isAction && !isKnownAction) {
        console.log(`[${NAME}] 捕获动作请求: ${method} ${url} body=${bodyStr.slice(0, 100)}`);
        // 匹配领奖特征：URL 或 Body 中包含任何动作/奖励/商城相关词
        const isRewardLike = /task|reward|receive|claim|award|bonus|draw|get|finish|exchange|shop/i.test(url) || 
                             /taskId|task_id|bonus|award|id|type/i.test(bodyStr);
        if (isRewardLike) {
          $persistentStore.write(url, REWARD_URL_KEY);
          $persistentStore.write(method, REWARD_METHOD_KEY);
          $persistentStore.write(bodyStr, REWARD_BODY_KEY);
          console.log(`[${NAME}] 🎯 成功锁定真实领奖接口: ${method} ${url}`);
          $notification.post(
            NAME,
            "🎯 真实领奖接口已锁定！",
            `接口: ${method} ${url.replace(/^https?:\/\/[^/]+/i, "")}\n参数: ${bodyStr.slice(0, 80) || "(空)"}`
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
          console.log(`[${NAME}] 捕获【社区/任务 api-xh】凭据: ${tok.slice(0, 10)}...`);

          if (tok !== oldXh) {
            $notification.post(NAME, "社区任务凭据已锁定 🎯", `通道: api-xh (浏览/任务)\nToken 长度: ${tok.length} 位`);
          }
        } else if (isWx) {
          const oldWx = $persistentStore.read(TOKEN_WX_KEY) || "";
          $persistentStore.write(tok, TOKEN_WX_KEY);
          $persistentStore.write(JSON.stringify(saved), HDR_WX_KEY);
          $persistentStore.write(String(Date.now()), TIME_KEY);
          console.log(`[${NAME}] 捕获【签到 wxforum】凭据: ${tok.slice(0, 10)}...`);

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
