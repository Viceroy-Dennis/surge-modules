// 三国咸话 Surge 登录凭据采集，仅用于 http-request / requires-body=false。
// 只读取请求头与官方热力竹入口的 token；微信与 H5 通道隔离。
// 不读取请求体，不修改请求，不探测领奖接口，始终 $done({}) 放行。

const NAME = "三国咸话Surge";
const TOKEN_WX_KEY = "sgxh_token_wx";
const HDR_WX_KEY = "sgxh_headers_wx";
const TOKEN_XH_KEY = "sgxh_token_xh";
const HDR_XH_KEY = "sgxh_headers_xh";
const TOKEN_H5_KEY = "sgxh_token_h5";
const HDR_H5_KEY = "sgxh_headers_h5";
const COOKIE_KEY = "sgxh_cookie";
const TOKEN_KEY = "sgxh_token";
const HEADER_KEY = "sgxh_headers";
const TIME_KEY = "sgxh_capture_time";
const NOTIFY_KEY = "sgxh_notify_ts";
const HOST_RE = /^(api-xh|wxforum|xh|hi-gateway|api-forum-act|xianhua)\.sanguosha\.cn$/i;
const DROP = { host: 1, connection: 1, "keep-alive": 1, "content-length": 1, "content-encoding": 1, "accept-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };
let storageFailure = false;

function read(key) {
  try { return $persistentStore.read(key) || ""; }
  catch (e) { storageFailure = true; throw new Error("本机存储读取失败"); }
}

function save(entries) {
  const keys = Object.keys(entries);
  const previous = {};
  keys.forEach(key => { previous[key] = read(key); });
  const attempted = [];
  try {
    keys.forEach(key => {
      attempted.push(key);
      if ($persistentStore.write(String(entries[key]), key) !== true) throw new Error("本机存储写入失败");
    });
  } catch (e) {
    storageFailure = true;
    // Surge 没有多键事务；写入失败时尽力恢复原值，且绝不通知保存成功。
    attempted.reverse().forEach(key => {
      try { $persistentStore.write(previous[key], key); } catch (ignored) {}
    });
    throw new Error("本机存储写入失败");
  }
}

function cleanValue(value) {
  if (typeof value !== "string" && typeof value !== "number") return "";
  const v = String(value).trim();
  if (!v || /^\[object .*\]$/i.test(v) || /^(undefined|null)$/i.test(v) || /[\r\n]/.test(v)) return "";
  return v;
}

function lowerHeaders(headers) {
  const out = Object.create(null);
  Object.keys(headers || {}).forEach(key => {
    const k = String(key).toLowerCase();
    const value = cleanValue(headers[key]);
    if (!DROP[k] && value) out[k] = value;
  });
  return out;
}

function cookieMap(cookie) {
  const out = Object.create(null);
  String(cookie || "").split(";").forEach(part => {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
  });
  return out;
}

function mergeCookie(oldValue, newValue) {
  const out = cookieMap(oldValue);
  const newer = cookieMap(newValue);
  Object.keys(newer).forEach(key => { if (newer[key] !== "") out[key] = newer[key]; });
  return Object.keys(out).map(key => key + "=" + out[key]).join("; ");
}

function pickToken(headers) {
  const cookies = cookieMap(headers.cookie);
  const candidates = [headers.authorization, headers.token, headers["x-token"], headers["x-auth-token"], headers.accesstoken, headers["access-token"], cookies.token];
  for (let i = 0; i < candidates.length; i++) {
    const token = cleanValue(candidates[i]);
    if (token.length >= 8) return token;
  }
  return "";
}

function queryToken(query) {
  let token = "", count = 0;
  String(query || "").split("&").forEach(part => {
    const i = part.indexOf("=");
    if (i < 0) return;
    const key = decodeURIComponent(part.slice(0, i).replace(/\+/g, " "));
    if (key !== "token") return;
    count++;
    const value = decodeURIComponent(part.slice(i + 1).replace(/\+/g, " "));
    const cleaned = cleanValue(value);
    if (cleaned === value && cleaned.length >= 8 && /^[A-Za-z0-9._~+/-]+=*$/.test(cleaned)) token = cleaned;
  });
  return count === 1 ? token : "";
}

function capture() {
  if (typeof $request === "undefined") return;
  const parts = String($request.url || "").match(/^https?:\/\/([^/?#]+)(\/[^?#]*)?(?:\?([^#]*))?(?:#.*)?$/i);
  if (!parts || !HOST_RE.test(parts[1])) return;
  const host = parts[1].toLowerCase();
  const headers = lowerHeaders($request.headers || {});
  const entries = Object.create(null);
  if (headers.cookie) entries[COOKIE_KEY] = mergeCookie(read(COOKIE_KEY), headers.cookie);

  let token = "", tokenKey = "", headerKey = "", channel = "";
  const isH5Entry = host === "xh.sanguosha.cn" && parts[2] === "/h5/energy" &&
    String($request.method || "GET").toUpperCase() === "GET";
  if (isH5Entry) {
    token = queryToken(parts[3]);
    tokenKey = TOKEN_H5_KEY; headerKey = HDR_H5_KEY; channel = "H5";
  } else {
    token = pickToken(headers);
    if ((headers["app-system"] || "").toLowerCase() === "h5") {
      tokenKey = TOKEN_H5_KEY; headerKey = HDR_H5_KEY; channel = "H5";
    } else if (host === "wxforum.sanguosha.cn") {
      tokenKey = TOKEN_WX_KEY; headerKey = HDR_WX_KEY; channel = "wxforum";
    } else if (/^(api-xh|xh|api-forum-act)\.sanguosha\.cn$/.test(host)) {
      tokenKey = TOKEN_XH_KEY; headerKey = HDR_XH_KEY; channel = "api-xh";
    }
  }

  let shouldNotify = false;
  if (token && tokenKey) {
    const oldToken = read(tokenKey);
    entries[tokenKey] = token;
    entries[headerKey] = JSON.stringify(headers);
    entries[TIME_KEY] = Date.now();
    if (channel !== "H5") {
      entries[TOKEN_KEY] = token;
      entries[HEADER_KEY] = JSON.stringify(headers);
    }
    const last = Number(read(NOTIFY_KEY));
    const elapsed = Date.now() - last;
    shouldNotify = token !== oldToken && (!Number.isFinite(last) || elapsed < 0 || elapsed >= 8000);
    if (shouldNotify) entries[NOTIFY_KEY] = Date.now();
  }
  if (Object.keys(entries).length) save(entries);
  if (shouldNotify) $notification.post(NAME, "登录凭据已更新", "通道: " + channel);
}

try {
  capture();
} catch (e) {
  // 原始异常可能带有请求 URL 或凭据，因此只输出固定提示。
  console.log("[" + NAME + "] " + (storageFailure ? "本机凭据保存失败" : "凭据捕获异常"));
  if (storageFailure) {
    try { $notification.post(NAME, "凭据保存失败", "请检查 Surge 本机存储，并重新打开小程序采集。"); } catch (ignored) {}
  }
} finally {
  $done({});
}
