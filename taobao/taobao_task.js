// 淘宝淘金币 —— Surge 每日签到任务 (Cron / Generic 兼容)
// 结构：纯 JS MD5 -> mtop H5 网关层（动态重签与 Token 自动续期舞步）-> 任务回放

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

/* ================= 2. mtop H5 网关通用层 ================= */
function mtopToken(cookie) {
  const m = String(cookie || "").match(/(?:^|;\s*)_m_h5_tk=([0-9a-zA-Z]{32})/i);
  return m ? m[1] : "";
}

function mtopBuild(api, ver, dataStr, t, token) {
  const full = String(api);
  const bare = full.replace(/^mtop\./, "");
  const sign = md5(token + "&" + t + "&12574478&" + dataStr);
  const p = [
    "jsv=2.7.2",
    "appKey=12574478",
    "t=" + t,
    "sign=" + sign,
    "api=" + encodeURIComponent(full),
    "v=" + encodeURIComponent(ver),
    "type=originaljson",
    "dataType=json",
    "timeout=10000",
    "data=" + encodeURIComponent(dataStr)
  ];
  return "https://h5api.m.taobao.com/h5/mtop." + bare + "/" + ver + "/" + full + "/?" + p.join("&");
}

function mtopHeaders(cookie, referer) {
  return {
    "User-Agent": "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
    "Accept": "application/json",
    "Origin": "https://h5.m.taobao.com",
    "Referer": referer || "https://h5.m.taobao.com/",
    "Content-Type": "application/x-www-form-urlencoded",
    "Cookie": cookie || "",
    "X-Surge-Task": "1" // 防回环
  };
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

function sendGet(url, headers) {
  return new Promise((resolve) => {
    $httpClient.get({ url, headers }, (error, response, body) => {
      if (error) {
        resolve({ error: String(error), status: 0, headers: {}, body: "" });
      } else {
        const status = Number(response && (response.status || response.statusCode)) || 0;
        const resHeaders = (response && response.headers) || {};
        resolve({ error: null, status, headers: resHeaders, body: String(body || "") });
      }
    });
  });
}

async function mtopCall(opts) {
  const ver = opts.ver || "1.0";
  const dataStr = JSON.stringify(opts.data || {});
  let cookie = String(opts.cookie || "");

  async function attempt(token, tries) {
    const t = String(Date.now());
    const url = mtopBuild(opts.api, ver, dataStr, t, token);
    const r = await sendGet(url, mtopHeaders(cookie, opts.referer));

    if (r.error) {
      return { ok: false, body: "", json: null, ret: `NETWORK: ${r.error}`, cookie };
    }

    let j = null;
    try { j = JSON.parse(r.body); } catch (e) {}
    const ret = (j && j.ret && j.ret[0]) || "";
    const newTk = mtopNewToken(r.headers);
    if (newTk) cookie = updTk(cookie, newTk);

    // 遇到 Token 过期自动刷新重签重试 (最多2次)
    if ((ret.indexOf("TOKEN_EMPTY") >= 0 || ret.indexOf("TOKEN_EXPIRED") >= 0) && tries > 0 && newTk) {
      console.log(`[淘金币] 检测到 Token 刷新: ${newTk.slice(0, 8)}... 正在重新生成 sign 校验...`);
      return attempt(newTk, tries - 1);
    }

    const ok = ret === "SUCCESS::调用成功" || ret.indexOf("SUCCESS") === 0;
    return { ok, body: r.body, json: j, ret, cookie, status: r.status };
  }

  return attempt(mtopToken(cookie), 2);
}

/* ================= 3. 任务回放与结果判定 ================= */
const NAME = "淘金币";
const K_API = "tb_api";
const K_COOKIE = "tb_cookie";
const K_RESP = "tb_resp";

function judge(r, rec) {
  const j = r.json;
  const ret = String(r.ret || "");

  if (/TOKEN_EMPTY|TOKEN_EXPIRED/.test(ret)) {
    return { state: "nologin", text: "未提取到有效 mtop 令牌 (_m_h5_tk) → 请在淘宝 App 打开淘金币页面重新抓取" };
  }

  if (/SUCCESS/.test(ret)) {
    const s = JSON.stringify(j || {});
    // 提取当前淘金币数量
    const num = s.match(/"(?:currentCoin|totalCoin|coinCount|currentCoins|coinNum|coin)"\s*:\s*"?(\d+)/i);
    const extra = num ? ` | 🪙 当前金币: ${num[1]}` : "";

    if (/已签|重复|REPEAT|already|ALREADY/.test(s)) {
      return { state: "done", text: `今日已完成签到${extra}` };
    }
    return { state: "ok", text: `${rec.api || "签到接口"} 执行成功${extra}` };
  }

  if (/FAIL_SYS_SESSION|SESSION_EXPIRED|需要登录|_bh=|未登录/i.test(ret) || /session/i.test(ret)) {
    return { state: "nologin", text: `会话失效 (${ret.slice(0, 40)}) → 请重新打开淘宝淘金币刷新 Cookie` };
  }

  return { state: "fail", text: `响应: ${ret || (r.body ? r.body.slice(0, 80) : "空响应")}` };
}

async function main() {
  const rawApi = $persistentStore.read(K_API);
  let rec = {};
  try { rec = JSON.parse(rawApi || "{}"); } catch (e) {}

  if (!rec.api) {
    const msg = "未抓到淘金币签到接口！\n💡 请确保 Surge 开启模块后，在手机淘宝打开「领淘金币」点一次签到自动保存";
    console.log(`[${NAME}] ${msg}`);
    $notification.post(NAME, "缺少签到接口", msg);
    $done({ summary: msg });
    return;
  }

  const cookie = $persistentStore.read(K_COOKIE) || "";
  console.log(`[${NAME}] 开始回放: api=${rec.api}, rank=${rec.rank || 0}, cookie长度=${cookie.length}`);

  const dataStr = String((rec.params && rec.params.data) || "{}");
  let payloadData = {};
  try { payloadData = JSON.parse(dataStr); } catch (e) {}

  const r = await mtopCall({
    api: rec.api,
    ver: rec.ver || "1.0",
    data: payloadData,
    cookie: cookie,
    referer: rec.params && rec.params.referer
  });

  console.log(`[${NAME}] 回放响应: ret=${r.ret}`);
  $persistentStore.write(JSON.stringify({ api: rec.api, ret: r.ret, body: String(r.body || "").slice(0, 2000) }), K_RESP);

  if (r.cookie && r.cookie !== cookie) {
    $persistentStore.write(r.cookie, K_COOKIE);
  }

  const j = judge(r, rec);
  const titleMap = { ok: "签到成功", done: "今日已签过", nologin: "会话已失效", fail: "签到异常" };
  const title = titleMap[j.state] || "签到完成";

  console.log(`[${NAME}] 结论 -> ${title}: ${j.text}`);
  $notification.post(NAME, title, `${j.text}\nAPI: ${rec.api}`);
  $done({ summary: j.text });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中运行" });
} else {
  main().catch((e) => {
    console.log(`[${NAME}] 运行异常: ${e}`);
    $notification.post(NAME, "脚本运行异常", String(e));
    $done({ summary: `异常: ${e}` });
  });
}
