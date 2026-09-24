// 三国咸话登录凭据抓包脚本 (Surge http-request)
// 智能区分与保存双通道凭据：
// 1. wxforum 通道 (sgxh_wx_headers / sgxh_wx_token) —— 专用于 openMiniApp 与 signIn 签到
// 2. api-xh 通道 (sgxh_xh_headers / sgxh_xh_token) —— 专用于 updateTaskProgress, taskList, taskReward
// 3. 通用兜底 (sgxh_headers / sgxh_token)
// 智能节流 (5秒)：进入页面只弹 1 次清晰通知，明确指示捕获到的通道

const NAME = "三国咸话";
const HEADER_KEY = "sgxh_headers";
const TOKEN_KEY = "sgxh_token";
const XH_HDR_KEY = "sgxh_xh_headers";
const XH_TOK_KEY = "sgxh_xh_token";
const WX_HDR_KEY = "sgxh_wx_headers";
const WX_TOK_KEY = "sgxh_wx_token";
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
      const saved = {};
      Object.keys(h).forEach((k) => {
        if (!DROP[k] && h[k] !== "") saved[k] = h[k];
      });

      // 通用兜底
      $persistentStore.write(tok, TOKEN_KEY);
      $persistentStore.write(JSON.stringify(saved), HEADER_KEY);
      $persistentStore.write(String(Date.now()), TIME_KEY);

      const isXh = host.includes("api-xh") || host.includes("xh.sanguosha.cn") || host.includes("api-forum-act");
      const isWx = host.includes("wxforum");

      if (isXh) {
        $persistentStore.write(tok, XH_TOK_KEY);
        $persistentStore.write(JSON.stringify(saved), XH_HDR_KEY);
        console.log(`[${NAME}] 捕获到【社区/任务 api-xh】核心凭据: ${tok.slice(0, 10)}...`);
      }
      if (isWx) {
        $persistentStore.write(tok, WX_TOK_KEY);
        $persistentStore.write(JSON.stringify(saved), WX_HDR_KEY);
        console.log(`[${NAME}] 捕获到【签到 wxforum】凭据: ${tok.slice(0, 10)}...`);
      }

      // 节流通知：5 秒内最多弹 1 次通知，指明捕获的通道
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
