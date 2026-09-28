// 淘宝淘金币 —— Surge 抓包脚本 v2 (http-request, requires-body=true)
// 核心：完整记录用户手动点击「签到」时的 mtop 请求（URL + Headers + Body），供任务脚本重签回放。
// 分级：rank3 = api 名含 sign/checkin/signin/award/draw/receive（真正动作）
//       rank2 = 含 coin/jinbi/gold/tangram/task（相关查询）
//       rank1 = 其他 mtop（只维护 Cookie，不作为回放模板）
// 只升不降；同 rank 同 api 允许刷新（更新最新参数）。

const NAME = "淘金币抓包";
const K_API = "tb_api";
const K_COOKIE = "tb_cookie";
const K_TS = "tb_capture_time";
const K_NOTIFY = "tb_last_notify";

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
  let combined = url;
  if (bodyStr && /api=|data=/.test(bodyStr)) {
    combined = url.split("?")[0] + "?" + bodyStr;
  }
  const params = qparse(combined);
  let api = String(params.api || "");
  if (!api) {
    const m = String(url).match(/\/(mtop\.[a-zA-Z0-9._]+)\//);
    if (m) api = m[1];
  }
  const ver = String(params.v || "") || (String(url).match(/\/(\d+\.\d+)\//) || [])[1] || "1.0";
  return { api, ver, params };
}

function rankOf(api, method) {
  const a = String(api || "").toLowerCase();
  if (!a) return 0;
  if (method === "OPTIONS") return -1;
  if (/gettimestamp|getcity|unit\.get|client\.log|behavior|config|abtest/i.test(a)) return 0;
  if (/sign|checkin|signin|award|draw|receive|collect|claim|complete/i.test(a)) return 3;
  if (/coin|jinbi|gold|tangram|task|welfare|benefit/i.test(a)) return 2;
  return 1;
}

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
        const { api, ver, params } = extractApi(url, bodyStr);
        const rank = rankOf(api, method);

        // 1. 维护 Cookie 池
        if (ck) {
          const oldCk = $persistentStore.read(K_COOKIE) || "";
          const merged = mergeCookie(oldCk, ck);
          if (merged && merged !== oldCk) {
            $persistentStore.write(merged, K_COOKIE);
          }
        }

        const hasTk = /_m_h5_tk=/.test(ck);
        console.log(`[${NAME}] ${method} api=${api || "(无)"} rank=${rank} cookie=${ck ? "有(tk=" + hasTk + ")" : "无"}`);

        if (rank < 2) {
          $done({});
        } else {
          let cur = {};
          try { cur = JSON.parse($persistentStore.read(K_API) || "{}"); } catch (e) {}
          const curRank = Number(cur && cur.rank) || 0;
          const curInvalid = !cur.api || /gettimestamp|getcity|unit\.get/i.test(cur.api);

          // 只升不降；同 rank 允许刷新（拿到最新参数）
          if (!curInvalid && rank < curRank) {
            console.log(`[${NAME}] rank=${rank} 低于已锁定 rank=${curRank}，跳过`);
            $done({});
          } else {
            const clean = {};
            Object.keys(h).forEach((k) => {
              if (!HOP[k] && h[k] !== "") clean[k] = h[k];
            });

            const rec = {
              url: url.split("?")[0],
              fullUrl: url,
              method: method,
              params: params,
              headers: clean,
              body: bodyStr.slice(0, 8000),
              api: api,
              ver: ver,
              rank: rank,
              ts: Date.now()
            };

            $persistentStore.write(JSON.stringify(rec), K_API);
            $persistentStore.write(String(Date.now()), K_TS);

            const lastNotify = Number($persistentStore.read(K_NOTIFY) || 0);
            const isNewApi = String(cur.api || "") !== api;
            if (isNewApi || rank > curRank || Date.now() - lastNotify > 8000) {
              $persistentStore.write(String(Date.now()), K_NOTIFY);
              console.log(`[${NAME}] 🎯 已锁定 rank=${rank} api=${api} v=${ver} data=${String(params.data || "").slice(0, 120)}`);
              $notification.post(
                NAME,
                rank >= 3 ? "已锁定淘金币签到接口 🎯" : "已锁定淘金币任务接口",
                `API: ${api}\n模板已保存，可去 Surge 执行手动签到`
              );
            }
            $done({});
          }
        }
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
