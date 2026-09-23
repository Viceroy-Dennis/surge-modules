// 三国咸话登录凭据抓包脚本 (Surge http-request)
// 捕获 Authorization, Token 及 Cookie 存入 $persistentStore (sgxh_headers, sgxh_token, sgxh_cookie)
// 降噪设计：仅凭据发生变化时保存并弹通知

const NAME = "三国咸话";
const HEADER_KEY = "sgxh_headers";
const COOKIE_KEY = "sgxh_cookie";
const TOKEN_KEY = "sgxh_token";
const TIME_KEY = "sgxh_capture_time";

const HOST_RE = /(^|\.)(api-xh|wxforum|xh|hi-gateway|api-forum-act|xianhua)\.sanguosha\.cn$/i;
const DROP = { host: 1, connection: 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };

function lowerHeaders(h) {
  const o = {};
  Object.keys(h || {}).forEach((k) => { o[String(k).toLowerCase()] = String(h[k]); });
  return o;
}

function cookieMap(s) {
  const o = {};
  String(s || "").split(";").forEach((p) => {
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

function credentialKind(h) {
  const keys = ["authorization", "token", "x-token", "x-auth-token", "accesstoken", "access-token", "cookie"];
  return keys.filter((k) => h[k]).join(", ");
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
      const h = lowerHeaders($request.headers || {});
      const kind = credentialKind(h);
      
      if (!kind) {
        $done({});
      } else {
        const saved = {};
        Object.keys(h).forEach((k) => {
          if (!DROP[k] && h[k] !== "") saved[k] = h[k];
        });

        const oldCookie = $persistentStore.read(COOKIE_KEY) || "";
        const mergedCookie = mergeCookie(oldCookie, h.cookie || "");
        if (mergedCookie) {
          saved.cookie = mergedCookie;
          $persistentStore.write(mergedCookie, COOKIE_KEY);
        }

        const oldHeaders = $persistentStore.read(HEADER_KEY) || "";
        const nextHeaders = JSON.stringify(saved);

        if (nextHeaders !== oldHeaders) {
          $persistentStore.write(nextHeaders, HEADER_KEY);
          $persistentStore.write(String(Date.now()), TIME_KEY);

          const token = h.authorization || h.token || h["x-token"] || h["x-auth-token"] || h.accesstoken || h["access-token"] || "";
          if (token) {
            $persistentStore.write(token, TOKEN_KEY);
          }

          console.log(`[${NAME}] 登录凭据已更新: host=${host}, 凭据类型: ${kind}`);
          $notification.post(NAME, "登录凭据已更新", `来源: ${host}\n类型: ${kind}`);
        }
        $done({});
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
