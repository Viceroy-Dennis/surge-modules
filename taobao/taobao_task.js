// 淘宝淘金币 —— Surge 每日签到任务 v2 (Cron / Generic 兼容)
// 结构：纯 JS MD5 -> 基于抓包模板的 mtop 完整回放（保留原请求头/方法/参数，仅重签 t/sign，令牌过期自动续期）

/* ================= 1. 纯 JS MD5 实现 (RFC 1321) ================= */
function md5(s) {
  function rl(v, c) { return (v << c) | (v >>> (32 - c)); }
  function au(x, y) { const l = (x & 0xFFFF) + (y & 0xFFFF), m = (x >> 16) + (y >> 16) + (l >> 16); return (m << 16) | (l & 0xFFFF); }
  function cmn(q, a, b, x, s, t) { return au(rl(au(au(a, q), au(x, t)), s), b); }
  function ff(a, b, c, d, x, s, t) { return cmn((b & c) | ((~b) & d), a, b, x, s, t); }
  function gg(a, b, c, d, x, s, t) { return cmn((b & d) | (c & (~d)), a, b, x, s, t); }
  function hh(a, b, c, d, x, s, t) { return cmn(b ^ c ^ d, a, b, x, s, t); }
  function ii(a, b, c, d, x, s, t) { return cmn(c ^ (b | (~d)), a, b, x, s, t); }
  function sb(str) {
    const utf8 = [];
    for (let i = 0; i < str.length; i++) {
      let c = str.charCodeAt(i);
      if (c < 0x80) utf8.push(c);
      else if (c < 0x800) utf8.push(0xC0 | (c >> 6), 0x80 | (c & 63));
      else if (c < 0xD800 || c >= 0xE000) utf8.push(0xE0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      else {
        i++; c = 0x10000 + (((c & 0x3FF) << 10) | (str.charCodeAt(i) & 0x3FF));
        utf8.push(0xF0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
      }
    }
    return utf8;
  }
  function b2w(b, i) { return (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)); }
  function hx(n) { let res = ""; for (let i = 0; i < 4; i++) { res += ("0" + ((n >> (i * 8)) & 0xFF).toString(16)).slice(-2); } return res; }

  const bytes = sb(s), len = bytes.length;
  bytes.push(0x80);
  while (bytes.length % 64 !== 56) bytes.push(0);
  const lb = len * 8;
  bytes.push((lb & 0xFF), (lb >>> 8) & 0xFF, (lb >>> 16) & 0xFF, (lb >>> 24) & 0xFF, 0, 0, 0, 0);
  let a = 1732584193, b = -271733879, c = -1732584194, d = 271733878;
  for (let i = 0; i < bytes.length; i += 64) {
    const x = [];
    for (let j = 0; j < 16; j++) x[j] = b2w(bytes, i + j * 4);
    const oa = a, ob = b, oc = c, od = d;
    a = ff(a, b, c, d, x[0], 7, -680876936); d = ff(d, a, b, c, x[1], 12, -389564586); c = ff(c, d, a, b, x[2], 17, 606105819); b = ff(b, c, d, a, x[3], 22, -1044525330);
    a = ff(a, b, c, d, x[4], 7, -176418897); d = ff(d, a, b, c, x[5], 12, 1200080426); c = ff(c, d, a, b, x[6], 17, -1473231341); b = ff(b, c, d, a, x[7], 22, -45705983);
    a = ff(a, b, c, d, x[8], 7, 1770035416); d = ff(d, a, b, c, x[9], 12, -1958414417); c = ff(c, d, a, b, x[10], 17, -42063); b = ff(b, c, d, a, x[11], 22, -1990404162);
    a = ff(a, b, c, d, x[12], 7, 1804603682); d = ff(d, a, b, c, x[13], 12, -40341101); c = ff(c, d, a, b, x[14], 17, -1502002290); b = ff(b, c, d, a, x[15], 22, 1236535329);
    a = gg(a, b, c, d, x[1], 5, -165796510); d = gg(d, a, b, c, x[6], 9, -1069501632); c = gg(c, d, a, b, x[11], 14, 643717713); b = gg(b, c, d, a, x[0], 20, -373897302);
    a = gg(a, b, c, d, x[5], 5, -701558691); d = gg(d, a, b, c, x[10], 9, 38016083); c = gg(c, d, a, b, x[15], 14, -660478335); b = gg(b, c, d, a, x[4], 20, -405537848);
    a = gg(a, b, c, d, x[9], 5, 568446438); d = gg(d, a, b, c, x[14], 9, -1019803690); c = gg(c, d, a, b, x[3], 14, -187363961); b = gg(b, c, d, a, x[8], 20, 1163531501);
    a = gg(a, b, c, d, x[13], 5, -1444681467); d = gg(d, a, b, c, x[2], 9, -51403784); c = gg(c, d, a, b, x[7], 14, 1735328473); b = gg(b, c, d, a, x[12], 20, -1926607734);
    a = hh(a, b, c, d, x[5], 4, -378558); d = hh(d, a, b, c, x[8], 11, -2022574463); c = hh(c, d, a, b, x[11], 16, 1839030562); b = hh(b, c, d, a, x[14], 23, -35309556);
    a = hh(a, b, c, d, x[1], 4, -1530992060); d = hh(d, a, b, c, x[4], 11, 1272893353); c = hh(c, d, a, b, x[7], 16, -155497632); b = hh(b, c, d, a, x[10], 23, -1094730640);
    a = hh(a, b, c, d, x[13], 4, 681279174); d = hh(d, a, b, c, x[0], 11, -358537222); c = hh(c, d, a, b, x[3], 16, -722521979); b = hh(b, c, d, a, x[6], 23, 76029189);
    a = hh(a, b, c, d, x[9], 4, -640364487); d = hh(d, a, b, c, x[12], 11, -421815835); c = hh(c, d, a, b, x[15], 16, 530742520); b = hh(b, c, d, a, x[2], 23, -995338651);
    a = ii(a, b, c, d, x[0], 6, -198630844); d = ii(d, a, b, c, x[7], 10, 1126891415); c = ii(c, d, a, b, x[14], 15, -1416354905); b = ii(b, c, d, a, x[5], 21, -57434055);
    a = ii(a, b, c, d, x[12], 6, 1700485571); d = ii(d, a, b, c, x[3], 10, -1894986606); c = ii(c, d, a, b, x[10], 15, -1051523); b = ii(b, c, d, a, x[1], 21, -2054922799);
    a = ii(a, b, c, d, x[8], 6, 1873313359); d = ii(d, a, b, c, x[15], 10, -30611744); c = ii(c, d, a, b, x[6], 15, -1560198380); b = ii(b, c, d, a, x[13], 21, 1309151649);
    a = ii(a, b, c, d, x[4], 6, -145523070); d = ii(d, a, b, c, x[11], 10, -1120210379); c = ii(c, d, a, b, x[2], 15, 718787259); b = ii(b, c, d, a, x[9], 21, -343485551);
    a = au(a, oa); b = au(b, ob); c = au(c, oc); d = au(d, od);
  }
  return hx(a) + hx(b) + hx(c) + hx(d);
}

/* ================= 2. 通用工具 ================= */
const NAME = "淘金币";
const K_API = "tb_api";
const K_COOKIE = "tb_cookie";
const K_RESP = "tb_resp";
const APP_KEY = "12574478";
const HOP = { host: 1, connection: 1, "content-length": 1, "accept-encoding": 1, "content-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };

function parseJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }

function cookieMap(s) {
  const o = {};
  String(s || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

function mtopToken(cookie) {
  const m = String(cookie || "").match(/(?:^|;\s*)_m_h5_tk=([0-9a-zA-Z]{32})/i);
  return m ? m[1] : "";
}

function mtopNewToken(headers) {
  let v = "";
  for (const k in headers || {}) {
    if (String(k).toLowerCase() === "set-cookie") {
      v = Array.isArray(headers[k]) ? headers[k].join(",") : String(headers[k]);
      break;
    }
  }
  const m = String(v || "").match(/_m_h5_tk=([0-9a-zA-Z]{32})/i);
  return m ? m[1] : "";
}

function updTk(cookie, tk) {
  const parts = String(cookie || "").split(";").map((p) => p.trim()).filter((p) => {
    return p && !/^_m_h5_tk=/i.test(p) && !/^_m_h5_tk_enc=/i.test(p);
  });
  parts.push("_m_h5_tk=" + tk + "_", "_m_h5_tk_enc=" + tk + "_");
  return parts.join("; ");
}

function encodeForm(obj) {
  return Object.keys(obj).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k])).join("&");
}

function httpSend(method, url, headers, body) {
  return new Promise((resolve) => {
    const req = { url, headers };
    if (body !== undefined && body !== null) req.body = body;
    const cb = (error, response, resBody) => {
      if (error) {
        resolve({ error: String(error), status: 0, headers: {}, body: "" });
      } else {
        resolve({
          error: null,
          status: Number(response && (response.status || response.statusCode)) || 0,
          headers: (response && response.headers) || {},
          body: String(resBody || "")
        });
      }
    };
    if (method === "POST") $httpClient.post(req, cb);
    else $httpClient.get(req, cb);
  });
}

/* ================= 3. 基于抓包模板的 mtop 重签回放 ================= */
async function mtopReplay(rec, cookie) {
  const api = String(rec.api || "");
  const ver = String(rec.ver || "1.0");
  const method = String(rec.method || "GET").toUpperCase();
  const params = Object.assign({}, rec.params || {});
  const dataStr = String(params.data || "{}");

  // 还原抓包时的请求头（剔除 hop-by-hop），Cookie 用最新池
  const headers = {};
  Object.keys(rec.headers || {}).forEach((k) => {
    const lk = String(k).toLowerCase();
    if (!HOP[lk] && rec.headers[k] !== "") headers[lk] = String(rec.headers[k]);
  });
  headers["cookie"] = cookie;
  headers["x-surge-task"] = "1";
  if (!headers["user-agent"]) headers["user-agent"] = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

  async function attempt(token, tries) {
    const t = String(Date.now());
    const sign = md5(token + "&" + t + "&" + APP_KEY + "&" + dataStr);
    const p = Object.assign({}, params, { t, sign, appKey: params.appKey || APP_KEY, api, v: ver });

    let url = rec.url;
    let body;
    if (method === "POST") {
      // POST 表单：所有参数放 body
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = encodeForm(p);
    } else {
      // GET：参数拼进 URL
      url = rec.url + "?" + encodeForm(p);
    }

    const r = await httpSend(method, url, headers, body);
    if (r.error) return { ok: false, ret: "NETWORK:" + r.error, body: "", json: null, cookie };

    const j = parseJSON(r.body);
    const ret = (j && j.ret && j.ret[0]) || "";
    const newTk = mtopNewToken(r.headers);
    if (newTk) cookie = updTk(cookie, newTk);

    if (/TOKEN_EMPTY|TOKEN_EXPIRED|ILLEGAL_ACCESS/i.test(ret) && tries > 0 && newTk) {
      console.log(`[${NAME}] 令牌刷新 -> ${newTk.slice(0, 8)}... 重签重试`);
      return attempt(newTk, tries - 1);
    }
    return { ok: /^SUCCESS/.test(ret), ret, body: r.body, json: j, cookie, status: r.status };
  }

  return attempt(mtopToken(cookie), 2);
}

/* ================= 4. 结果判定 ================= */
function judge(r, api) {
  const ret = String(r.ret || "");
  const s = JSON.stringify(r.json || {});

  if (/TOKEN_EMPTY|TOKEN_EXPIRED/i.test(ret)) {
    return { state: "nologin", text: "mtop 令牌无效 (_m_h5_tk)，请重新打开淘金币页" };
  }
  if (/SESSION_EXPIRED|FAIL_SYS_SESSION|需要登录|未登录|USER_NOT_LOGIN/i.test(ret + s)) {
    return { state: "nologin", text: `会话失效 (${ret.slice(0, 40)})，请重新登录淘宝并打开淘金币页` };
  }
  if (/^SUCCESS/.test(ret)) {
    const num = s.match(/"(?:currentCoin|totalCoin|coinCount|currentCoins|coinNum|coin|amount|balance)"\s*:\s*"?(\d+)/i);
    const gain = s.match(/"(?:awardCoin|reward|gainCoin|addCoin|signCoin|value)"\s*:\s*"?(\d+)/i);
    const extra = (gain ? ` +${gain[1]}` : "") + (num ? ` | 🪙 余额 ${num[1]}` : "");
    if (/已签|重复|REPEAT|already|ALREADY|SIGNED/i.test(s)) {
      return { state: "done", text: `今日已签到${extra}` };
    }
    if (/sign|checkin|signin|award|draw|receive|collect|claim/i.test(api)) {
      return { state: "ok", text: `签到成功${extra}` };
    }
    return { state: "ok", text: `${api} 调用成功${extra}\n(未锁定签到动作接口，请在淘金币页点一次签到)` };
  }
  return { state: "fail", text: `响应: ${ret || (r.body ? r.body.slice(0, 100) : "空")}` };
}

/* ================= 5. 主流程 ================= */
async function main() {
  let rec = parseJSON($persistentStore.read(K_API) || "") || {};
  if (rec.api && /gettimestamp|getcity|unit\.get/i.test(rec.api)) {
    $persistentStore.write("", K_API);
    rec = {};
  }
  const cookie = $persistentStore.read(K_COOKIE) || "";

  if (!rec.api || !rec.url) {
    const msg = "❌ 尚未捕获淘金币签到接口\n💡 在手机淘宝打开「领淘金币」并点一次签到，抓包会自动锁定";
    $notification.post(NAME, "缺少签到模板", msg);
    $done({ summary: msg });
    return;
  }
  if (!cookie) {
    const msg = "❌ 缺少 Cookie，请重新打开淘金币页";
    $notification.post(NAME, "缺少 Cookie", msg);
    $done({ summary: msg });
    return;
  }

  console.log(`[${NAME}] 回放模板: ${rec.method} ${rec.api} v${rec.ver} rank=${rec.rank} cookie=${cookie.length}B tk=${!!mtopToken(cookie)}`);

  const r = await mtopReplay(rec, cookie);
  console.log(`[${NAME}] ret=${r.ret} body=${String(r.body || "").slice(0, 200)}`);
  $persistentStore.write(JSON.stringify({ api: rec.api, ret: r.ret, body: String(r.body || "").slice(0, 2000) }), K_RESP);
  if (r.cookie && r.cookie !== cookie) $persistentStore.write(r.cookie, K_COOKIE);

  const j = judge(r, rec.api);
  const titleMap = { ok: "签到完成", done: "今日已签过", nologin: "会话已失效", fail: "签到异常" };
  $notification.post(NAME, titleMap[j.state] || "签到结果", `${j.text}\nAPI: ${rec.api}`);
  $done({ summary: j.text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中运行" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "脚本异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
