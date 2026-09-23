// RE0 (re0.me) 登录凭据与 Action 抓包脚本 (Surge http-request)
// 1. 保存真实 User-Agent 与 cf_clearance 通行证
// 2. 捕获真实签到 POST 请求 (Next-Action, Next-Router-State-Tree, Body)
// 3. 严格防回环：过滤自身脚本发起的请求 (X-Surge-Task)，避免自发自抓

const NAME = "RE0抓包";
const K_COOKIE = "re0_cookie";
const K_HDR = "re0_headers";
const K_URL = "re0_url";
const K_BODY = "re0_body";
const K_ACT = "re0_action";
const K_UA = "re0_ua";
const K_TS = "re0_capture_time";

const HOP = { host: 1, connection: 1, "content-length": 1, "accept-encoding": 1, "content-encoding": 1, "transfer-encoding": 1, "proxy-connection": 1 };

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

function cookieString(o) {
  return Object.keys(o).map((k) => `${k}=${o[k]}`).join("; ");
}

function mergeCookie(oldStr, newStr) {
  const o = cookieMap(oldStr);
  const n = cookieMap(newStr);
  Object.keys(n).forEach((k) => {
    if (n[k] !== "") o[k] = n[k];
  });
  return cookieString(o);
}

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const h = lowerHeaders($request.headers || {});
    // 防回环：如果是脚本自己发出的请求，直接跳过
    if (h["x-surge-task"]) {
      $done({});
    } else {
      const url = String($request.url || "");
      const method = String($request.method || "GET").toUpperCase();

      if (/\.(png|jpg|jpeg|gif|webp|svg|css|ico|woff2?)$/i.test(url) || url.includes("/_next/static/")) {
        $done({});
      } else {
        const cookie = String(h.cookie || "");
        const ua = String(h["user-agent"] || "");

        // 1. 持续合并 Cookie (确保 cf_clearance 和 hdh_sa_token 始终最新)
        if (cookie) {
          const oldCookie = $persistentStore.read(K_COOKIE) || "";
          const merged = mergeCookie(oldCookie, cookie);
          if (merged && merged !== oldCookie) {
            $persistentStore.write(merged, K_COOKIE);
            $persistentStore.write(String(Date.now()), K_TS);
          }
        }

        // 2. 锁定真实 Safari UA
        if (ua && ua.includes("Mozilla")) {
          $persistentStore.write(ua, K_UA);
        }

        // 3. 捕获真实签到 POST
        const isAction = Boolean(h["next-action"] || (method === "POST" && /checkin|sign/i.test(url)));
        if (method === "POST" && isAction) {
          const body = String($request.body || "[false]");
          const cleanHdr = {};
          Object.keys(h).forEach((k) => {
            if (!HOP[k] && h[k] !== "") cleanHdr[k] = String(h[k]);
          });

          const actId = String(h["next-action"] || "");
          const oldAct = $persistentStore.read(K_ACT) || "";

          $persistentStore.write(JSON.stringify(cleanHdr), K_HDR);
          $persistentStore.write(url, K_URL);
          $persistentStore.write(body, K_BODY);
          if (actId) $persistentStore.write(actId, K_ACT);
          $persistentStore.write(String(Date.now()), K_TS);

          const hasCf = Boolean(cookieMap(cookie).cf_clearance);
          console.log(`[${NAME}] 捕获到 Action POST: act=${actId.slice(0, 10)}... body=${body}`);

          // 仅在 Action ID 变化或初次捕获时发通知，避免重复刷屏
          if (actId !== oldAct) {
            $notification.post(
              NAME,
              "签到请求与盾墙凭据已捕获",
              `Action ID: ${actId.slice(0, 8)}...\nCF 凭据: ${hasCf ? "✅ 已具备 (cf_clearance)" : "⚠️ 未检测到 cf_clearance"}`
            );
          }
        }

        $done({});
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
