// RE0 (re0.me) 登录凭据与 Action 抓包脚本 (Surge http-request)
// 专为越过 Cloudflare 盾墙与 Next.js Server Action 体系设计：
// 1. 抓取与保存 Safari 真实 User-Agent（必须与 cf_clearance 严格一致，否则必定吃 CF 403 盾墙）
// 2. 捕获并合并 cf_clearance 及全部 Session Cookie
// 3. 捕获真实签到 POST 请求头（next-action、next-router-state-tree、body）
// 4. 极致降噪：非签到动作只静默合并 Cookie，绝不刷屏打扰

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
    const url = String($request.url || "");
    const method = String($request.method || "GET").toUpperCase();

    // 过滤静态资源与 Next.js chunks，只关注页面与接口
    if (/\.(png|jpg|jpeg|gif|webp|svg|css|ico|woff2?)$/i.test(url) || url.includes("/_next/static/")) {
      $done({});
    } else {
      const h = lowerHeaders($request.headers || {});
      const cookie = String(h.cookie || "");
      const ua = String(h["user-agent"] || "");

      // 1. 持续合并与更新 Cookie (包含最重要的 cf_clearance 和 hdh_sa_token)
      if (cookie) {
        const oldCookie = $persistentStore.read(K_COOKIE) || "";
        const merged = mergeCookie(oldCookie, cookie);
        if (merged && merged !== oldCookie) {
          $persistentStore.write(merged, K_COOKIE);
          $persistentStore.write(String(Date.now()), K_TS);
        }
      }

      // 2. 保存 Safari 的真实 User-Agent (这是过 CF 盾墙的生命线)
      if (ua && ua.includes("Mozilla")) {
        $persistentStore.write(ua, K_UA);
      }

      // 3. 捕获用户在页面上点击的真实签到 Server Action POST 请求
      const isAction = Boolean(h["next-action"] || (method === "POST" && /checkin|sign/i.test(url)));
      if (method === "POST" && isAction) {
        const body = String($request.body || "[false]");
        const cleanHdr = {};
        Object.keys(h).forEach((k) => {
          if (!HOP[k] && h[k] !== "") cleanHdr[k] = String(h[k]);
        });

        const actId = String(h["next-action"] || "");
        $persistentStore.write(JSON.stringify(cleanHdr), K_HDR);
        $persistentStore.write(url, K_URL);
        $persistentStore.write(body, K_BODY);
        if (actId) $persistentStore.write(actId, K_ACT);
        $persistentStore.write(String(Date.now()), K_TS);

        const hasCf = Boolean(cookieMap(cookie).cf_clearance);
        console.log(`[${NAME}] 成功捕获签到 POST! action=${actId.slice(0, 10)}... body=${body} has_cf=${hasCf}`);
        $notification.post(
          NAME,
          "签到请求与盾墙凭证已捕获",
          `Action ID: ${actId ? actId.slice(0, 8) + "..." : "已锁定"}\nCF 凭据: ${hasCf ? "✅ 已具备 (cf_clearance)" : "⚠️ 未包含 cf_clearance"}`
        );
      }

      $done({});
    }
  }
} catch (e) {
  console.log(`[${NAME}] 抓包异常: ${e}`);
  $done({});
}
