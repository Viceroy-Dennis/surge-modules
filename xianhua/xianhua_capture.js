// 三国咸话登录凭据与领奖接口抓包脚本 (Surge http-request)
// 1. 捕获双通道凭据 (wxforum 签到通道 + api-xh 社区/任务通道)
// 2. 核心侦听：监听用户在小程序内点击「领取」的真实请求，自动捕获真实领奖 URL 与参数结构！

const NAME = "三国咸话";
const HEADER_KEY = "sgxh_headers";
const TOKEN_KEY = "sgxh_token";
const XH_HDR_KEY = "sgxh_xh_headers";
const XH_TOK_KEY = "sgxh_xh_token";
const WX_HDR_KEY = "sgxh_wx_headers";
const WX_TOK_KEY = "sgxh_wx_token";
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

    // 1. 核心侦听：捕获用户在小程序内手动点击「领取」的真实请求
    if (method === "POST" && !url.includes("updateTaskProgress") && !url.includes("signIn") && !url.includes("openMiniApp")) {
      console.log(`[${NAME}] 捕获 POST 请求: ${method} ${url} body=${bodyStr}`);
      if (/task|reward|receive|claim|award|get|draw/i.test(url)) {
        $persistentStore.write(url, REWARD_URL_KEY);
        console.log(`[${NAME}] 🎯 已锁定真实领奖接口: ${url}`);
        $notification.post(
          NAME,
          "🎯 真实领奖接口已锁定！",
          `接口: ${url.replace(/^https?:\/\/[^/]+/i, "")}\n参数: ${bodyStr.slice(0, 100)}\n后续将全自动调用此接口领奖！`
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

      // 通用保存
      $persistentStore.write(tok, TOKEN_KEY);
      $persistentStore.write(JSON.stringify(saved), HEADER_KEY);
      $persistentStore.write(String(Date.now()), TIME_KEY);

      const isXh = host.includes("api-xh") || host.includes("xh.sanguosha.cn") || host.includes("api-forum-act");
      const isWx = host.includes("wxforum");

      if (isXh) {
        $persistentStore.write(tok, XH_TOK_KEY);
        $persistentStore.write(JSON.stringify(saved), XH_HDR_KEY);
      }
      if (isWx) {
        $persistentStore.write(tok, WX_TOK_KEY);
        $persistentStore.write(JSON.stringify(saved), WX_HDR_KEY);
      }

      // 节流通知
      const lastNotify = Number($persistentStore.read(NOTIFY_KEY) || 0);
      const isThrottled = (Date.now() - lastNotify < 5000);

      if (!isThrottled) {
        $persistentStore.write(String(Date.now()), NOTIFY_KEY);
        const channelName = isXh ? "社区/任务核心凭据 (api-xh)" : isWx ? "签到凭据 (wxforum)" : `通道 (${host})`;
        $notification.post(
          NAME,
          "凭据已捕获 ✅",
          `成功捕获: ${channelName}\nToken 长度: ${tok.length} 位`
        );
      }

      $done({});
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
