// 淘宝淘金币 —— Surge 每日任务全家桶 v3 (Cron / Generic 兼容)
// 流程：签到 → 拉任务列表 → 逐个「浏览类」任务上报完成 → 领取所有可领奖励 → 汇总金币余额
// 原理：完全基于抓包模板池（tb_tpl）回放，保留原 method/headers/参数，只重算 t/sign 并替换 taskId 等业务字段。
//       令牌过期（TOKEN_EMPTY/EXPIRED/ILLEGAL_ACCESS）自动从 Set-Cookie 续期重签。

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
const K_POOL = "tb_tpl";
const K_API = "tb_api";
const K_COOKIE = "tb_cookie";
const K_RESP = "tb_resp";
const K_LOG = "tb_task_log";
const APP_KEY = "12574478";
const HOP = { host: 1, connection: 1, "content-length": 1, "accept-encoding": 1, "content-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };
const UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

// 需要跳到支付宝/外部 App 的任务，接口无法回放，直接跳过
const SKIP_TASK = /蚂蚁|支付宝|芭芭农场|农场|森林|庄园|下载|安装|开通|付款|下单|购买|充值|邀请|好友|分享|签约|订阅|绑定|开卡|会员开通|88VIP开通/;
// 可直接上报完成的浏览类任务
const BROWSE_TASK = /浏览|逛|看|搜|访|到访|观看|视频|频道|直播|会场|沉浸|快闪|页面|专区|活动|领券|点击/;

function parseJSON(s) { try { return JSON.parse(s); } catch (e) { return null; } }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function num(v) { const n = Number(v); return isNaN(n) ? 0 : n; }

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
  const parts = String(cookie || "").split(";").map((p) => p.trim()).filter((p) => p && !/^_m_h5_tk(_enc)?=/i.test(p));
  parts.push("_m_h5_tk=" + tk + "_", "_m_h5_tk_enc=" + tk + "_");
  return parts.join("; ");
}

function encodeForm(obj) {
  return Object.keys(obj).map((k) => encodeURIComponent(k) + "=" + encodeURIComponent(obj[k])).join("&");
}

function httpSend(method, url, headers, body) {
  return new Promise((resolve) => {
    const req = { url, headers, timeout: 15 };
    if (body !== undefined && body !== null) req.body = body;
    const cb = (error, response, resBody) => {
      if (error) resolve({ error: String(error), status: 0, headers: {}, body: "" });
      else resolve({ error: null, status: Number(response && (response.status || response.statusCode)) || 0, headers: (response && response.headers) || {}, body: String(resBody || "") });
    };
    if (method === "POST") $httpClient.post(req, cb);
    else $httpClient.get(req, cb);
  });
}

/* ================= 3. mtop 模板回放（可覆盖 data 字段） ================= */
const ctx = { cookie: "" };

async function mtopReplay(rec, dataPatch) {
  const api = String(rec.api || "");
  const ver = String(rec.ver || "1.0");
  const method = String(rec.method || "GET").toUpperCase();
  const params = Object.assign({}, rec.params || {});

  let dataObj = parseJSON(String(params.data || "{}"));
  if (dataObj && typeof dataObj === "object" && dataPatch) {
    dataObj = Object.assign({}, dataObj, dataPatch);
  }
  const dataStr = dataObj && typeof dataObj === "object" ? JSON.stringify(dataObj) : String(params.data || "{}");

  const headers = {};
  Object.keys(rec.headers || {}).forEach((k) => {
    const lk = String(k).toLowerCase();
    if (!HOP[lk] && rec.headers[k] !== "") headers[lk] = String(rec.headers[k]);
  });
  headers["x-surge-task"] = "1";
  if (!headers["user-agent"]) headers["user-agent"] = UA;

  async function attempt(token, tries) {
    headers["cookie"] = ctx.cookie;
    const t = String(Date.now());
    const sign = md5(token + "&" + t + "&" + APP_KEY + "&" + dataStr);
    const p = Object.assign({}, params, { t, sign, appKey: params.appKey || APP_KEY, api, v: ver, data: dataStr });

    let url = rec.url, body;
    if (method === "POST") {
      headers["content-type"] = "application/x-www-form-urlencoded";
      body = encodeForm(p);
    } else {
      url = rec.url + "?" + encodeForm(p);
    }

    const r = await httpSend(method, url, headers, body);
    if (r.error) return { ok: false, ret: "NETWORK:" + r.error, body: "", json: null };

    const j = parseJSON(r.body);
    const ret = String((j && j.ret && j.ret[0]) || "");
    const newTk = mtopNewToken(r.headers);
    if (newTk && newTk !== mtopToken(ctx.cookie)) {
      ctx.cookie = updTk(ctx.cookie, newTk);
      $persistentStore.write(ctx.cookie, K_COOKIE);
    }
    if (/TOKEN_EMPTY|TOKEN_EXPIRED|ILLEGAL_ACCESS/i.test(ret) && tries > 0 && newTk) {
      console.log(`[${NAME}] ${api} 令牌续期 -> ${newTk.slice(0, 8)}... 重签`);
      return attempt(newTk, tries - 1);
    }
    return { ok: /^SUCCESS/.test(ret), ret, body: r.body, json: j, status: r.status, data: (j && j.data) || null };
  }

  return attempt(mtopToken(ctx.cookie), 2);
}

/* ================= 4. 任务列表解析（结构自适应） ================= */
function walk(node, fn, depth) {
  depth = depth || 0;
  if (!node || typeof node !== "object" || depth > 8) return;
  if (Array.isArray(node)) { node.forEach((x) => walk(x, fn, depth + 1)); return; }
  fn(node);
  Object.keys(node).forEach((k) => walk(node[k], fn, depth + 1));
}

function pick(o, keys) {
  for (const k of keys) if (o[k] !== undefined && o[k] !== null && o[k] !== "") return o[k];
  return undefined;
}

function parseTasks(data) {
  const out = [], seen = {};
  walk(data, (o) => {
    const id = pick(o, ["taskId", "taskCode", "id", "taskInstanceId", "instanceId", "taskKey", "code"]);
    const title = pick(o, ["taskName", "title", "name", "taskTitle", "desc", "taskDesc", "subTitle"]);
    if (id === undefined || !title) return;
    const idStr = String(id);
    if (seen[idStr + title]) return;
    seen[idStr + title] = 1;
    const status = pick(o, ["taskStatus", "status", "state", "progressStatus", "finishStatus"]);
    const cur = num(pick(o, ["currentCount", "currentProgress", "finishCount", "completeCount", "current", "progress", "doneTimes", "finishTimes"]));
    const total = num(pick(o, ["totalCount", "targetCount", "needCount", "total", "target", "maxTimes", "times", "limitCount", "taskTotal"]));
    const reward = pick(o, ["awardCoin", "coinAmount", "rewardAmount", "coin", "reward", "awardNum", "rewardValue", "amount", "prize"]);
    const statusStr = String(status === undefined ? "" : status).toLowerCase();
    const jsonS = JSON.stringify(o).toLowerCase();
    const received = /received|已领取|"receiv[a-z]*":\s*(true|1|"1")|awarded|"rewarded":\s*true|"status":\s*"?(3|finished_received)"?/.test(jsonS) || /received|awarded|finished_award/.test(statusStr);
    const claimable = !received && (/(^|[^a-z])(finish|finished|complete|completed|done|canreceive|to_receive|toreceive|await|待领取|可领取)($|[^a-z])/.test(statusStr) || (total > 0 && cur >= total) || /"canreceive":\s*(true|1)|"receivable":\s*(true|1)|"canaward":\s*(true|1)|领取奖励/.test(jsonS));
    out.push({ id: idStr, title: String(title).trim(), status: statusStr, cur, total, reward: reward === undefined ? "" : String(reward), received, claimable, raw: o });
  });
  return out;
}

function coinBalance(data) {
  const s = JSON.stringify(data || {});
  const m = s.match(/"(?:currentCoin|totalCoin|coinCount|coinNum|balance|coinBalance|userCoin|coinAmount)"\s*:\s*"?(\d+)/i);
  return m ? m[1] : "";
}
function coinGain(data) {
  const s = JSON.stringify(data || {});
  const m = s.match(/"(?:awardCoin|gainCoin|addCoin|signCoin|rewardCoin|awardAmount|rewardAmount|awardNum)"\s*:\s*"?(\d+)/i);
  return m ? m[1] : "";
}

function isBiz(ret, body) {
  const s = ret + " " + String(body || "").slice(0, 400);
  if (/SESSION_EXPIRED|FAIL_SYS_SESSION|USER_NOT_LOGIN|需要登录|未登录/i.test(s)) return "nologin";
  if (/TOKEN_EMPTY|TOKEN_EXPIRED/i.test(ret)) return "notoken";
  return "";
}

/* ================= 5. 模板池读取 ================= */
function loadPool() {
  let pool = parseJSON($persistentStore.read(K_POOL) || "") || {};
  // v2 兼容：把旧签到模板并入池
  const old = parseJSON($persistentStore.read(K_API) || "");
  if (old && old.api && !pool[old.api] && !/gettimestamp|getcity|unit\.get/i.test(old.api)) {
    old.role = /sign|checkin/i.test(old.api) ? "sign" : (/award|reward|receive|claim/i.test(old.api) ? "award" : "other");
    pool[old.api] = old;
  }
  return pool;
}
function byRole(pool, role) {
  return Object.keys(pool).map((k) => pool[k]).filter((r) => r && r.role === role && r.url).sort((a, b) => num(b.ts) - num(a.ts));
}

/* ================= 6. 主流程 ================= */
async function main() {
  const lines = [];
  const stats = { sign: "", done: 0, doneFail: 0, award: 0, awardCoin: 0, skip: 0, pending: 0 };
  let state = "ok";

  ctx.cookie = $persistentStore.read(K_COOKIE) || "";
  const pool = loadPool();
  const tplSign = byRole(pool, "sign")[0];
  const tplList = byRole(pool, "list")[0];
  const tplDone = byRole(pool, "done")[0];
  const tplAward = byRole(pool, "award")[0];

  if (!ctx.cookie) return finish("nologin", "❌ 缺少 Cookie，请在手机淘宝打开「领淘金币」页面");
  if (!tplSign && !tplList && !tplAward && !tplDone) {
    return finish("nologin", "❌ 尚未捕获任何淘金币接口\n💡 打开「领淘金币」→ 点签到 → 点一个「去完成」→ 点一个「领取奖励」，抓包会自动锁定");
  }
  console.log(`[${NAME}] 模板: sign=${tplSign ? tplSign.api : "-"} list=${tplList ? tplList.api : "-"} done=${tplDone ? tplDone.api : "-"} award=${tplAward ? tplAward.api : "-"} cookie=${ctx.cookie.length}B`);

  /* ---- 6.1 签到 ---- */
  if (tplSign) {
    const r = await mtopReplay(tplSign);
    console.log(`[${NAME}] 签到 ${tplSign.api} ret=${r.ret} body=${String(r.body).slice(0, 200)}`);
    const biz = isBiz(r.ret, r.body);
    if (biz) return finish("nologin", biz === "notoken" ? "❌ mtop 令牌无效，请重新打开淘金币页" : `❌ 会话失效 (${r.ret.slice(0, 40)})，请重新登录淘宝并打开淘金币页`);
    const s = JSON.stringify(r.json || {});
    const gain = coinGain(r.data);
    if (r.ok && !/已签|重复|REPEAT|already|SIGNED/i.test(s)) stats.sign = `✅ 签到成功${gain ? " +" + gain : ""}`;
    else if (r.ok || /已签|重复|REPEAT|already|SIGNED/i.test(s)) stats.sign = "☑️ 今日已签到";
    else stats.sign = `⚠️ 签到异常 ${r.ret.slice(0, 40)}`;
  } else {
    stats.sign = "⬜ 未锁定签到接口";
  }
  lines.push(`📅 签到: ${stats.sign}`);
  await sleep(800);

  /* ---- 6.2 任务列表 ---- */
  let tasks = [];
  let listData = null;
  async function fetchList() {
    if (!tplList) return [];
    const r = await mtopReplay(tplList);
    console.log(`[${NAME}] 列表 ${tplList.api} ret=${r.ret} body=${String(r.body).slice(0, 300)}`);
    if (!r.ok) return [];
    listData = r.data;
    return parseTasks(r.data);
  }
  tasks = await fetchList();
  console.log(`[${NAME}] 解析到 ${tasks.length} 个任务: ${tasks.map((t) => `${t.title}(${t.id}) ${t.cur}/${t.total} ${t.status} ${t.received ? "已领" : t.claimable ? "可领" : ""}`).join(" | ")}`);
  if (tplList && !tasks.length) lines.push("📋 任务列表: ⚠️ 未解析出任务（看日志）");
  if (!tplList) lines.push("📋 任务列表: ⬜ 未锁定列表接口（重新打开淘金币任务面板）");

  /* ---- 6.3 上报完成浏览类任务 ---- */
  const doneLog = [];
  if (tplDone && tasks.length) {
    for (const t of tasks) {
      if (t.received || t.claimable) continue;
      if (t.total > 0 && t.cur >= t.total) continue;
      if (SKIP_TASK.test(t.title)) { stats.skip++; continue; }
      if (!BROWSE_TASK.test(t.title)) { stats.skip++; continue; }
      const need = Math.max(1, (t.total || 1) - (t.cur || 0));
      let okCount = 0;
      for (let i = 0; i < Math.min(need, 10); i++) {
        const r = await mtopReplay(tplDone, buildPatch(tplDone, t));
        const s = String(r.body).slice(0, 160);
        console.log(`[${NAME}] 完成 ${t.title} #${i + 1} ret=${r.ret} ${s}`);
        if (r.ok) okCount++;
        else if (/已完成|FINISHED|LIMIT|超过|上限/i.test(r.ret + s)) { okCount = need; break; }
        else break;
        await sleep(1500 + Math.floor(Math.random() * 800));
      }
      if (okCount >= need) { stats.done++; doneLog.push(`  ✅ ${t.title}`); }
      else if (okCount > 0) { stats.done++; doneLog.push(`  🔸 ${t.title} ${t.cur + okCount}/${t.total}`); }
      else { stats.doneFail++; doneLog.push(`  ❌ ${t.title}`); }
    }
    if (stats.done + stats.doneFail) { await sleep(2000); tasks = await fetchList(); }
  }
  lines.push(`🎯 任务完成: ${tplDone ? `${stats.done} 项${stats.doneFail ? `, 失败 ${stats.doneFail}` : ""}${stats.skip ? `, 跳过 ${stats.skip} 项(需跳转/非浏览)` : ""}` : "⬜ 未锁定完成上报接口（点一次「去完成」）"}`);
  doneLog.forEach((l) => lines.push(l));

  /* ---- 6.4 领取奖励 ---- */
  const awardLog = [];
  if (tplAward && tasks.length) {
    for (const t of tasks) {
      if (t.received || !t.claimable) continue;
      const r = await mtopReplay(tplAward, buildPatch(tplAward, t));
      const s = String(r.body).slice(0, 160);
      console.log(`[${NAME}] 领奖 ${t.title} ret=${r.ret} ${s}`);
      const gain = coinGain(r.data) || t.reward;
      if (r.ok && !/已领|REPEAT|already|RECEIVED/i.test(s)) { stats.award++; stats.awardCoin += num(gain); awardLog.push(`  🪙 ${t.title}${gain ? " +" + gain : ""}`); }
      else if (/已领|REPEAT|already|RECEIVED/i.test(s)) awardLog.push(`  ☑️ ${t.title} 已领过`);
      else awardLog.push(`  ❌ ${t.title} ${r.ret.slice(0, 30)}`);
      await sleep(1200);
    }
  } else if (tplAward && !tplList) {
    // 没有列表接口时，至少回放一次抓到的领奖模板
    const r = await mtopReplay(tplAward);
    const gain = coinGain(r.data);
    if (r.ok) { stats.award++; stats.awardCoin += num(gain); awardLog.push(`  🪙 ${tplAward.api}${gain ? " +" + gain : ""}`); }
    else awardLog.push(`  ❌ ${tplAward.api} ${r.ret.slice(0, 30)}`);
  }
  stats.pending = tasks.filter((t) => !t.received && !t.claimable && !(t.total > 0 && t.cur >= t.total)).length;
  lines.push(`🎁 领奖: ${tplAward ? `${stats.award} 项${stats.awardCoin ? `, 共 +${stats.awardCoin} 金币` : ""}` : "⬜ 未锁定领奖接口（点一次「领取奖励」）"}`);
  awardLog.forEach((l) => lines.push(l));
  if (tasks.length) lines.push(`📌 剩余未完成: ${stats.pending} 项（跳转类需手动）`);

  /* ---- 6.5 余额 ---- */
  let bal = "";
  const balSrc = byRole(pool, "other").concat(tplList ? [tplList] : []);
  for (const tpl of balSrc) {
    const r = await mtopReplay(tpl);
    bal = coinBalance(r.data);
    if (bal) break;
  }
  if (!bal && listData) bal = coinBalance(listData);
  if (bal) lines.push(`💰 当前淘金币: ${bal} (≈ 可抵 ${(num(bal) / 100).toFixed(2)} 元)`);

  if (stats.doneFail && !stats.done) state = "warn";
  return finish(state, lines.join("\n"));

  function finish(st, text) {
    const titleMap = { ok: "淘金币任务完成", warn: "淘金币任务部分失败", nologin: "淘金币会话/模板缺失" };
    console.log(`[${NAME}]\n${text}`);
    $persistentStore.write(JSON.stringify({ ts: Date.now(), text }), K_LOG);
    $notification.post(NAME, titleMap[st] || "淘金币", text);
    $done({ summary: text });
  }
}

// 根据模板 data 中的字段名，把任务 id 替换进去
function buildPatch(tpl, t) {
  const patch = {};
  const d = parseJSON(String((tpl.params || {}).data || "{}")) || {};
  const idKeys = ["taskId", "taskCode", "taskInstanceId", "instanceId", "taskKey", "id", "code"];
  let hit = false;
  idKeys.forEach((k) => { if (d[k] !== undefined) { patch[k] = t.id; hit = true; } });
  if (!hit) patch.taskId = t.id;
  // 同步透传原任务对象里的关键字段（有些接口要求 taskType / bizId）
  ["taskType", "type", "bizId", "activityId", "sceneId", "taskInstanceId"].forEach((k) => {
    if (d[k] !== undefined && t.raw && t.raw[k] !== undefined) patch[k] = t.raw[k];
  });
  return patch;
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
