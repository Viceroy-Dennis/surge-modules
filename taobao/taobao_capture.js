// 淘宝淘金币 —— Surge 抓包脚本 (http-request)
// 功能：自动捕获与学习淘金币 mtop 签到接口与会话 Cookie 池
// 机制：
// 1. rank 制分级锁定（rank3: 签到接口 > rank2: 金币/任务接口 > rank1: 普通 mtop）
// 2. 持续合并与更新 Cookie 池（包含最重要的 _m_h5_tk 与会话鉴权）
// 3. 极致降噪：只有初次锁定更高 rank 接口时弹窗通知，其余请求静默更新

const NAME = "淘金币抓包";
const K_API = "tb_api";
const K_COOKIE = "tb_cookie";
const K_TS = "tb_capture_time";

const HOP = { host: 1, connection: 1, "content-length": 1, "accept-encoding": 1, "content-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };

function lower(h) {
  const o = {};
  Object.keys(h || {}).forEach((k) => { o[String(k).toLowerCase()] = h[k]; });
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

function isMtopHost(u) {
  const m = String(u || "").match(/^https?:\/\/([^/?]+)/i);
  const host = m ? String(m[1]).toLowerCase() : "";
  return /^(h5api|h5|api|acs)\.m\.taobao\.com$/.test(host);
}

function qparse(u) {
  const q = {};
  const i = String(u || "").indexOf("?");
  if (i < 0) return q;
  String(u).slice(i + 1).split("&").forEach((kv) => {
    const j = kv.indexOf("=");
    if (j <= 0) return;
    q[decodeURIComponent(kv.slice(0, j))] = decodeURIComponent(kv.slice(j + 1).replace(/\+/g, " "));
  });
  return q;
}

function apiRank(u, method) {
  const p = qparse(u);
  let a = String(p.api || "");
  if (!a) {
    const m = String(u || "").match(/\/(mtop\.[a-zA-Z0-9._]+)\//);
    if (m) a = m[1];
  }
  if (!a) return 0;
  if (String(method || "").toUpperCase() === "OPTIONS") return -1;
  if (/sign|checkin|signin|award|draw|receive/i.test(a)) return 3;
  if (/coin|jinbi|point|task|daily/i.test(a)) return 2;
  return 1;
}

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const h = lower($request.headers || {});
    // 防回环
    if (h["x-surge-task"]) {
      $done({});
    } else {
      const url = String($request.url || "");
      if (!isMtopHost(url)) {
        $done({});
      } else {
        const method = String($request.method || "GET").toUpperCase();
        if (method === "OPTIONS") {
          $done({});
        } else {
          // 1. 维护 Cookie 池
          const ck = h["cookie"] || "";
          if (ck) {
            const oldCk = $persistentStore.read(K_COOKIE) || "";
            const merged = mergeCookie(oldCk, ck);
            if (merged && merged !== oldCk) {
              $persistentStore.write(merged, K_COOKIE);
              $persistentStore.write(String(Date.now()), K_TS);
            }
          }

          // 2. 检查接口 rank 分级
          const rank = apiRank(url, method);
          if (rank <= 0) {
            $done({});
          } else {
            let cur = {};
            try { cur = JSON.parse($persistentStore.read(K_API) || "{}"); } catch (e) {}
            const curRank = Number(cur && cur.rank) || 0;

            // 只升不降
            if (rank <= curRank) {
              console.log(`[${NAME}] 捕获接口 rank=${rank} (当前已锁定 rank=${curRank}) 静默更新 Cookie`);
              $done({});
            } else {
              const clean = {};
              Object.keys(h).forEach((k) => {
                if (!HOP[k] && h[k] !== undefined && h[k] !== "") clean[k] = String(h[k]);
              });

              let bodyStr = String($request.body || "");
              let mergedUrl = url;
              if (bodyStr && /api=|data=/.test(bodyStr)) {
                const bq = qparse("http://x/?" + bodyStr);
                if (bq.api || bq.data) mergedUrl = url.split("?")[0] + "?" + bodyStr;
              }

              const parsedParams = qparse(mergedUrl);
              const apiName = String(parsedParams.api || "") || (String(mergedUrl).match(/\/(mtop\.[a-zA-Z0-9._]+)\//) || [])[1] || "";
              const ver = String(parsedParams.v || "") || (String(mergedUrl).match(/\/gw\/([0-9.]+)\//) || [])[1] || "1.0";

              const rec = {
                url: mergedUrl.split("?")[0],
                method: method,
                params: parsedParams,
                headers: clean,
                body: bodyStr.slice(0, 4000),
                api: apiName,
                ver: ver,
                rank: rank
              };

              $persistentStore.write(JSON.stringify(rec), K_API);
              $persistentStore.write(String(Date.now()), K_TS);

              console.log(`[${NAME}] 接口已锁定: rank=${rank} api=${apiName} ver=${ver}`);
              if (rank >= 2) {
                $notification.post(
                  NAME,
                  `已锁定淘金币${rank >= 3 ? "签到" : "任务"}接口`,
                  `API: ${apiName}\n已自动生成 mtop 重签回放模板`
                );
              }
              $done({});
            }
          }
        }
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
