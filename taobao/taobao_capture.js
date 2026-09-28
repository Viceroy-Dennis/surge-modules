// 淘宝淘金币 —— Surge 抓包脚本 v3 (http-request, requires-body=true)
// 核心：把淘金币页面所有 mtop 请求按「角色」分类存入模板池，供任务脚本按任务列表逐个回放。
// 角色：sign  = 签到动作           (api 含 sign/checkin)
//       award = 领取任务奖励       (api 含 award/reward/receive/claim/collect/prize)
//       done  = 上报任务完成       (api 含 dotask/finish/complete/report/browse/visit/view/done)
//       list  = 查询任务列表/中心   (api 含 task + list/query/center/page/info)
//       other = 其他金币相关查询   (api 含 coin/jinbi/gold/tangram/welfare/benefit/task)
// 每个角色保留最新模板（同角色不同 api 都存，回放时优先最新）；只维护 Cookie 的低价值请求不入池。

const NAME = "淘金币抓包";
const K_POOL = "tb_tpl";          // 模板池 { api: rec }
const K_API = "tb_api";           // v2 兼容（签到模板）
const K_COOKIE = "tb_cookie";
const K_TS = "tb_capture_time";
const K_NOTIFY = "tb_last_notify";
const MAX_POOL = 12;

const HOP = { host: 1, connection: 1, "content-length": 1, "accept-encoding": 1, "content-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };

function lower(h) {
  const o = {};
  Object.keys(h || {}).forEach((k) => { o[String(k).toLowerCase()] = String(h[k]); });
  return o;
}

function mergeCookie(a, b) {
  const map = {};
  String(a || "").split(";").concat(String(b || "").split(";")).forEach((p) => {
    const s = p.trim();
    if (!s) return;
    const i = s.indexOf("=");
    if (i <= 0) return;
    map[s.slice(0, i).trim()] = s.slice(i + 1).trim();
  });
  return Object.keys(map).map((k) => `${k}=${map[k]}`).join("; ");
}

function qparse(u) {
  const q = {};
  const i = String(u || "").indexOf("?");
  if (i < 0) return q;
  String(u).slice(i + 1).split("&").forEach((kv) => {
    const j = kv.indexOf("=");
    if (j <= 0) return;
    try {
      q[decodeURIComponent(kv.slice(0, j))] = decodeURIComponent(kv.slice(j + 1).replace(/\+/g, " "));
    } catch (e) {}
  });
  return q;
}

function isMtopHost(host) {
  return /^(h5api|h5|api|acs|trade-acs|guide-acs)\.m\.taobao\.com$/i.test(host);
}

function extractApi(url, bodyStr) {
  const uParams = qparse(url);
  let bParams = {};
  if (bodyStr && /(^|&)(api|data|t|sign)=/.test(bodyStr)) bParams = qparse("?" + bodyStr);
  const params = Object.assign({}, uParams, bParams);
  let api = String(params.api || "");
  if (!api) {
    const m = String(url).match(/\/(mtop\.[a-zA-Z0-9._]+)\//);
    if (m) api = m[1];
  }
  const ver = String(params.v || "") || (String(url).match(/\/(\d+\.\d+)\//) || [])[1] || "1.0";
  return { api, ver, params, bodyIsForm: Object.keys(bParams).length > 0 };
}

function roleOf(api) {
  const a = String(api || "").toLowerCase();
  if (!a) return "";
  if (/gettimestamp|getcity|unit\.get|client\.log|behavior|config|abtest|ums\.|monitor|log\.|detail\.|recommend|search\.|feed|banner|ad\./i.test(a)) return "";
  if (/signin|checkin|dailysign|\.sign/i.test(a)) return "sign";
  if (/award|reward|receive|claim|collect|prize|obtain/i.test(a)) return "award";
  if (/dotask|finishtask|completetask|taskfinish|taskcomplete|report|browse|visit|view|done|finish|complete|trigger|execute/i.test(a)) return "done";
  if (/task.*(list|query|center|page|info|get)|(query|get|list).*task|tasks|taskcenter|tasklist/i.test(a)) return "list";
  if (/coin|jinbi|gold|tangram|welfare|benefit|task|macao|tjb/i.test(a)) return "other";
  return "";
}

const ROLE_RANK = { sign: 3, award: 3, done: 3, list: 2, other: 1 };
const ROLE_NAME = { sign: "签到", award: "领奖", done: "完成上报", list: "任务列表", other: "金币查询" };

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const h = lower($request.headers || {});
    if (h["x-surge-task"]) {
      $done({});
    } else {
      const url = String($request.url || "");
      const host = (url.match(/^https?:\/\/([^/]+)/i) || ["", ""])[1].toLowerCase();
      const method = String($request.method || "GET").toUpperCase();

      if (!isMtopHost(host) || method === "OPTIONS") {
        $done({});
      } else {
        const ck = h["cookie"] || "";
        const bodyStr = String($request.body || "");
        const { api, ver, params, bodyIsForm } = extractApi(url, bodyStr);
        const role = roleOf(api);

        // 1. 维护 Cookie 池
        if (ck) {
          const oldCk = $persistentStore.read(K_COOKIE) || "";
          const merged = mergeCookie(oldCk, ck);
          if (merged && merged !== oldCk) $persistentStore.write(merged, K_COOKIE);
        }

        console.log(`[${NAME}] ${method} api=${api || "(无)"} role=${role || "-"} tk=${/_m_h5_tk=/.test(ck)}`);

        if (!role) {
          $done({});
        } else {
          let pool = {};
          try { pool = JSON.parse($persistentStore.read(K_POOL) || "{}"); } catch (e) {}
          if (!pool || typeof pool !== "object") pool = {};

          const clean = {};
          Object.keys(h).forEach((k) => { if (!HOP[k] && h[k] !== "") clean[k] = h[k]; });

          const rec = {
            url: url.split("?")[0],
            method: method,
            params: params,
            headers: clean,
            body: bodyStr.slice(0, 8000),
            bodyIsForm: bodyIsForm,
            api: api,
            ver: ver,
            role: role,
            rank: ROLE_RANK[role] || 1,
            ts: Date.now()
          };

          const isNew = !pool[api];
          const hadRole = Object.keys(pool).some((k) => pool[k] && pool[k].role === role);
          pool[api] = rec;

          // 池子超限：淘汰最旧的 other 角色
          const keys = Object.keys(pool);
          if (keys.length > MAX_POOL) {
            keys.filter((k) => pool[k].role === "other").sort((a, b) => pool[a].ts - pool[b].ts)
              .slice(0, keys.length - MAX_POOL).forEach((k) => { delete pool[k]; });
          }
          $persistentStore.write(JSON.stringify(pool), K_POOL);
          $persistentStore.write(String(Date.now()), K_TS);
          if (role === "sign") $persistentStore.write(JSON.stringify(rec), K_API); // v2 兼容

          const lastNotify = Number($persistentStore.read(K_NOTIFY) || 0);
          if (role !== "other" && (isNew || !hadRole || Date.now() - lastNotify > 8000)) {
            $persistentStore.write(String(Date.now()), K_NOTIFY);
            const locked = ["list", "sign", "done", "award"].map((r) => {
              const ok = Object.keys(pool).some((k) => pool[k].role === r);
              return `${ok ? "✅" : "⬜"}${ROLE_NAME[r]}`;
            }).join(" ");
            console.log(`[${NAME}] 🎯 锁定 ${role} api=${api} v=${ver} data=${String(params.data || "").slice(0, 120)}`);
            $notification.post(NAME, `已锁定「${ROLE_NAME[role]}」接口 🎯`, `API: ${api}\n${locked}\n四项齐全后即可在 Surge 点「淘金币手动执行」`);
          }
          $done({});
        }
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
