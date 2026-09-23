// 淘宝淘金币 —— Surge 抓包脚本 (http-request)
// 核心原则：
// 1. 严格过滤：坚决排除 getTimestamp / home 等系统通用接口，只锁定包含 coin / jinbi / sign 的真正淘金币接口！
// 2. 门槛提升：只有 Rank >= 2 的业务接口才允许保存为回放目标！
// 3. 持续吸纳 Cookie 池：提取 _m_h5_tk 与会话 Cookie

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

// 接口优先级评定（彻底剔除通用系统接口）
function apiRank(apiName, method) {
  const a = String(apiName || "").toLowerCase();
  if (!a) return 0;
  if (String(method || "").toUpperCase() === "OPTIONS") return -1;

  // 严禁将系统基础接口当作签到接口
  if (/gettimestamp|getcity|unit\.get|client\.log|behavior/i.test(a)) {
    return 0;
  }

  // Rank 3: 明确包含签到、领奖动作
  if (/sign|checkin|signin|award|draw|receive/i.test(a) && /coin|jinbi|tangram|gold/i.test(a)) {
    return 3;
  }
  if (/sign|checkin|signin|award|draw/i.test(a)) {
    return 3;
  }

  // Rank 2: 淘金币任务、资产、资产聚合接口
  if (/coin|jinbi|gold|tangram/i.test(a)) {
    return 2;
  }

  // 其他接口一律不作为执行目标
  return 0;
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
      if (!isMtopHost(url)) {
        $done({});
      } else {
        const method = String($request.method || "GET").toUpperCase();
        if (method === "OPTIONS") {
          $done({});
        } else {
          // 1. 无论什么 mtop 请求，只要有 Cookie 就合并入池 (重点维护 _m_h5_tk)
          const ck = h["cookie"] || "";
          if (ck) {
            const oldCk = $persistentStore.read(K_COOKIE) || "";
            const merged = mergeCookie(oldCk, ck);
            if (merged && merged !== oldCk) {
              $persistentStore.write(merged, K_COOKIE);
              $persistentStore.write(String(Date.now()), K_TS);
            }
          }

          // 2. 提取 API 名
          let bodyStr = String($request.body || "");
          let mergedUrl = url;
          if (bodyStr && /api=|data=/.test(bodyStr)) {
            const bq = qparse("http://x/?" + bodyStr);
            if (bq.api || bq.data) mergedUrl = url.split("?")[0] + "?" + bodyStr;
          }

          const parsedParams = qparse(mergedUrl);
          const apiName = String(parsedParams.api || "") || (String(mergedUrl).match(/\/(mtop\.[a-zA-Z0-9._]+)\//) || [])[1] || "";
          const ver = String(parsedParams.v || "") || (String(mergedUrl).match(/\/gw\/([0-9.]+)\//) || [])[1] || "1.0";

          // 3. 严格评估接口 Rank（低于 2 分的一律不存）
          const rank = apiRank(apiName, method);
          if (rank < 2) {
            $done({});
          } else {
            let cur = {};
            try { cur = JSON.parse($persistentStore.read(K_API) || "{}"); } catch (e) {}
            const curRank = Number(cur && cur.rank) || 0;

            // 如果当前存的是被误杀的 getTimestamp，强制覆盖
            const isInvalidCurrent = !cur.api || /gettimestamp/i.test(cur.api);

            if (!isInvalidCurrent && rank <= curRank) {
              console.log(`[${NAME}] 捕获接口 rank=${rank} (当前已锁定 rank=${curRank}) 静默更新`);
              $done({});
            } else {
              const clean = {};
              Object.keys(h).forEach((k) => {
                if (!HOP[k] && h[k] !== undefined && h[k] !== "") clean[k] = String(h[k]);
              });

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

              console.log(`[${NAME}] 真正淘金币接口已锁定! rank=${rank} api=${apiName} ver=${ver}`);
              $notification.post(
                NAME,
                `已锁定真正淘金币接口 (Rank ${rank})`,
                `API: ${apiName}\n已生成全新 mtop 回放模板！`
              );
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
