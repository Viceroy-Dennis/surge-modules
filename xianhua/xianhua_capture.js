// 三国咸话登录凭据抓包脚本 (Surge http-request)
// 核心原则：
// 1. 严格过滤：必须包含真实有效的用户 Token (长度>=8) 才保存，杜绝空头或追踪 Cookie 冲掉凭据
// 2. 极致降噪：Token 相同绝不重复弹窗，进小程序并发几十个请求也只弹 1 次通知！

const NAME = "三国咸话";
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";
const TIME_KEY = "sgxh_capture_time";

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
    const url = $request.url || "";
    const raw = $request.headers || {};
    const h = lowerHeaders(raw);
    const tok = pickToken(h);

    // 只有拿到真正的有效 Token (且长度合理) 才处理，避免无 token 请求污染
    if (!tok || tok.length < 8) {
      $done({});
    } else {
      const oldTok = $persistentStore.read(TOKEN_KEY) || "";
      const isNew = (tok !== oldTok);

      // 只保留安全有效的头部
      const saved = {};
      Object.keys(h).forEach((k) => {
        if (!DROP[k] && h[k] !== "") saved[k] = h[k];
      });

      // 无论新旧，保持头部最新可用
      $persistentStore.write(tok, TOKEN_KEY);
      $persistentStore.write(JSON.stringify(saved), HEADER_KEY);
      $persistentStore.write(String(Date.now()), TIME_KEY);

      // 降噪核心：只有捕获到全新 Token 时才弹窗，相同 Token 只记录 console.log！
      if (isNew) {
        console.log(`[${NAME}] 捕获到新 Token: ${tok.slice(0, 10)}... (长 ${tok.length})`);
        $notification.post(NAME, "登录凭据已更新", `成功捕获最新 Token！\n长约 ${tok.length} 位`);
      } else {
        console.log(`[${NAME}] Token 依然有效，静默更新请求头`);
      }

      $done({});
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
