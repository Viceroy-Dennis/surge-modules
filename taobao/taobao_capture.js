// 淘宝淘金币 —— Surge 抓包脚本 (http-request)
// 核心原则：
// 1. 全域监听：捕获所有 *.m.taobao.com 接口，绝不因路径微小差异漏抓
// 2. 实时日志：每个进来的 mtop 请求都在 Surge 日志打印一行，透明可视
// 3. 智能捕获：无论在淘宝 App 还是 Safari 打开淘金币，只要包含 coin/sign/task/tangram 立即锁定并弹通知！

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

function extractApi(url, bodyStr) {
  let combined = url;
  if (bodyStr && /api=|data=/.test(bodyStr)) {
    combined = url.split("?")[0] + "?" + bodyStr;
  }
  const params = qparse(combined);
  let api = String(params.api || "");
  if (!api) {
    const m = String(combined).match(/\/(mtop\.[a-zA-Z0-9._]+)\//);
    if (m) api = m[1];
  }
  const ver = String(params.v || "") || (String(combined).match(/\/gw\/([0-9.]+)\//) || [])[1] || "1.0";
  return { api, ver, params, combined };
}

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const h = lower($request.headers || {});
    // 防自身脚本回环
    if (h["x-surge-task"]) {
      $done({});
    } else {
      const url = String($request.url || "");
      const method = String($request.method || "GET").toUpperCase();

      if (method === "OPTIONS" || /\.(png|jpg|jpeg|gif|webp|svg|css|ico|woff2?)$/i.test(url)) {
        $done({});
      } else {
        const ck = h["cookie"] || "";
        const bodyStr = String($request.body || "");
        const { api, ver, params, combined } = extractApi(url, bodyStr);

        // 1. 持续合并 Cookie 池 (重点保留 _m_h5_tk)
        if (ck) {
          const oldCk = $persistentStore.read(K_COOKIE) || "";
          const merged = mergeCookie(oldCk, ck);
          if (merged && merged !== oldCk) {
            $persistentStore.write(merged, K_COOKIE);
            $persistentStore.write(String(Date.now()), K_TS);
          }
        }

        // 2. 打印实时捕获日志 (Surge 控制台可见)
        const hasTk = ck.includes("_m_h5_tk");
        console.log(`[${NAME}] 捕获流量: ${method} api=${api || "(路径:" + url.slice(0, 40) + ")"} cookie=${ck ? "有(" + ck.length + "字,tk=" + hasTk + ")" : "无"}`);

        // 3. 过滤系统无用时间戳等接口
        if (!api || /gettimestamp|getcity|unit\.get|client\.log|behavior/i.test(api)) {
          $done({});
        } else {
          // 4. 判定是否为淘金币业务接口
          const isCoinTarget = /coin|jinbi|gold|tangram|task|sign|award|draw|receive/i.test(api);

          if (!isCoinTarget) {
            $done({});
          } else {
            // 计算 Rank: 明确含 sign/award/draw/receive 为 3，其余为 2
            const rank = /sign|checkin|signin|award|draw|receive/i.test(api) ? 3 : 2;

            let cur = {};
            try { cur = JSON.parse($persistentStore.read(K_API) || "{}"); } catch (e) {}
            const curRank = Number(cur && cur.rank) || 0;

            // 如果当前不是有效金币接口，或者新捕获接口 rank 更高，立刻锁定
            const isInvalidCurrent = !cur.api || !/coin|jinbi|gold|tangram|task|sign/i.test(cur.api);

            if (!isInvalidCurrent && rank <= curRank) {
              console.log(`[${NAME}] 保持当前高优先级接口 (${cur.api})，静默更新数据`);
              $done({});
            } else {
              const clean = {};
              Object.keys(h).forEach((k) => {
                if (!HOP[k] && h[k] !== undefined && h[k] !== "") clean[k] = String(h[k]);
              });

              const rec = {
                url: combined.split("?")[0],
                method: method,
                params: params,
                headers: clean,
                body: bodyStr.slice(0, 4000),
                api: api,
                ver: ver,
                rank: rank
              };

              $persistentStore.write(JSON.stringify(rec), K_API);
              $persistentStore.write(String(Date.now()), K_TS);

              console.log(`[${NAME}] 🎯 淘金币接口已锁定: Rank ${rank} -> ${api}`);
              $notification.post(
                NAME,
                `已成功锁定淘金币接口 (Rank ${rank})`,
                `API: ${api}\nCookie: ${hasTk ? "✅ 含 _m_h5_tk" : "⚠️ 等待令牌刷新"}\n可立即去 Surge 执行签到测试！`
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
