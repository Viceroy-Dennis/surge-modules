// RE0 (re0.me) 登录凭据与 Action 抓包脚本 (Surge http-request)
// 1. 持续合并与更新 Cookie 池 (cf_clearance 盾墙凭证与 hdh_sa_token 安全令牌)
// 2. 锁定 Safari 真实 User-Agent，与 cf_clearance 严格绑定以穿透 Cloudflare
// 3. 智能识别签到 Action：当 Body 为 [false] 或 [true] 时，锁定为最高优先级的签到 Action ID！
// 4. 维护候选 Action ID 历史池 (re0_candidate_actions)，支持多版本自动容灾

const NAME = "RE0抓包";
const K_COOKIE = "re0_cookie";
const K_HDR = "re0_headers";
const K_URL = "re0_url";
const K_BODY = "re0_body";
const K_ACT = "re0_action";
const K_UA = "re0_ua";
const K_CANDIDATES = "re0_candidate_actions";
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

function addCandidate(actId) {
  if (!actId || actId.length < 20) return;
  let arr = [];
  try { arr = JSON.parse($persistentStore.read(K_CANDIDATES) || "[]"); } catch (e) {}
  if (!Array.isArray(arr)) arr = [];
  if (!arr.includes(actId)) {
    arr.unshift(actId);
    if (arr.length > 8) arr = arr.slice(0, 8);
    $persistentStore.write(JSON.stringify(arr), K_CANDIDATES);
  }
}

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const h = lowerHeaders($request.headers || {});
    // 防自身脚本回环
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

        // 1. 持续合并 Cookie (cf_clearance 与 hdh_sa_token)
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

        // 3. 捕获 Server Action POST
        const isAction = Boolean(h["next-action"] || (method === "POST" && /checkin|sign/i.test(url)));
        if (method === "POST" && isAction) {
          const body = String($request.body || "[false]");
          const cleanHdr = {};
          Object.keys(h).forEach((k) => {
            if (!HOP[k] && h[k] !== "") cleanHdr[k] = String(h[k]);
          });

          const actId = String(h["next-action"] || "");
          const isCheckinBody = (body === "[false]" || body === "[true]" || /checkin|sign/i.test(url));

          if (actId) {
            addCandidate(actId);
            // 如果 Body 明确是签到参数 [false] / [true]，设为最高优先级主 Action ID
            if (isCheckinBody) {
              $persistentStore.write(actId, K_ACT);
            } else if (!$persistentStore.read(K_ACT)) {
              $persistentStore.write(actId, K_ACT);
            }
          }

          $persistentStore.write(JSON.stringify(cleanHdr), K_HDR);
          $persistentStore.write(url, K_URL);
          $persistentStore.write(body, K_BODY);
          $persistentStore.write(String(Date.now()), K_TS);

          const hasCf = Boolean(cookieMap(cookie).cf_clearance);
          console.log(`[${NAME}] 捕获到 Action POST: act=${actId.slice(0, 10)}... body=${body} isCheckin=${isCheckinBody}`);

          $notification.post(
            NAME,
            isCheckinBody ? "签到动作已精准捕获 🎯" : "Action 请求已捕获",
            `Action ID: ${actId.slice(0, 8)}...\nBody: ${body}\nCF 凭证: ${hasCf ? "✅ 已具备 (cf_clearance)" : "⚠️ 未检测到"}`
          );
        }

        $done({});
      }
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
