// RE0 (re0.me) 综合体检与盾墙状态诊断脚本 (Surge Generic 专用)
// 用途: 一键实测 Cloudflare 穿透状态、Action ID 连通性与真实服务器响应文本

const NAME = "RE0体检诊断";
const K_COOKIE = "re0_cookie";
const K_HDR = "re0_headers";
const K_URL = "re0_url";
const K_BODY = "re0_body";
const K_ACT = "re0_action";
const K_UA = "re0_ua";
const K_TS = "re0_capture_time";

const DEFAULT_HOME = "https://re0.me/";
const DEFAULT_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148";
const HOP = ["host", "connection", "content-length", "accept-encoding", "content-encoding", "transfer-encoding", "proxy-connection"];

function cookieMap(s) {
  const o = {};
  String(s || "").split(";").forEach((p) => {
    const i = p.indexOf("=");
    if (i > 0) o[p.slice(0, i).trim()] = p.slice(i + 1).trim();
  });
  return o;
}

function checkCf(status, headers, body) {
  const h = headers || {};
  let cf = "";
  for (const k in h) if (String(k).toLowerCase() === "cf-mitigated") cf = String(h[k]);
  const str = String(body || "");
  if (/just a moment|challenge-platform|_cf_chl_opt/i.test(str) || (Number(status) === 403 && (cf || /cloudflare/i.test(str)))) {
    return cf || "challenge";
  }
  return "";
}

function main() {
  console.log(`[${NAME}] ========== RE0 签到与盾墙实测体检开始 ==========`);
  const rows = [];

  const cookie = $persistentStore.read(K_COOKIE) || "";
  const actId = $persistentStore.read(K_ACT) || "";
  const ua = $persistentStore.read(K_UA) || "";
  const bodyPayload = $persistentStore.read(K_BODY) || "[false]";
  const capTime = $persistentStore.read(K_TS);
  const targetUrl = $persistentStore.read(K_URL) || DEFAULT_HOME;

  if (!cookie && !actId) {
    rows.push("❌ 未检测到任何凭据");
    rows.push("💡 请在 Safari 打开 re0.me 并手动点一次签到");
    const text = rows.join("\n");
    console.log(text);
    $notification.post(NAME, "未捕获凭据", text);
    $done({ summary: text });
    return;
  }

  const cMap = cookieMap(cookie);
  const hasCf = Boolean(cMap.cf_clearance);

  rows.push("🛡️ 盾墙与指纹准备:");
  rows.push(`  • cf_clearance: ${hasCf ? "✅ 已就绪" : "❌ 缺失 (需过 CF)"}`);
  rows.push(`  • UA 指纹: ${ua ? "✅ 真实 Safari" : "⚠️ 默认 UA"}`);
  rows.push(`  • Action ID: ${actId ? "✅ " + actId.slice(0, 10) + "..." : "❌ 缺失"}`);

  // 发起实测 POST
  let saved = {};
  try { saved = JSON.parse($persistentStore.read(K_HDR) || "{}"); } catch (e) {}
  const h = {};
  Object.keys(saved).forEach((k) => {
    const lk = String(k).toLowerCase();
    if (!HOP.includes(lk) && saved[k] !== undefined && saved[k] !== null && saved[k] !== "") {
      h[lk] = String(saved[k]);
    }
  });

  h["content-type"] = "text/plain;charset=UTF-8";
  h["accept"] = "text/x-component";
  h["origin"] = "https://re0.me";
  h["referer"] = targetUrl;
  h["user-agent"] = ua || DEFAULT_UA;
  h["cookie"] = cookie;
  h["x-surge-task"] = "1";
  if (actId) h["next-action"] = actId;

  console.log(`[${NAME}] 正在向 ${targetUrl} 发送实测试探...`);

  $httpClient.post({
    url: targetUrl,
    headers: h,
    body: bodyPayload
  }, (err, resp, resBody) => {
    if (err) {
      rows.push(`\n📡 连通测试: 失败 (${err})`);
    } else {
      const status = Number(resp && (resp.status || resp.statusCode)) || 0;
      const resHeaders = resp && resp.headers ? resp.headers : {};
      const cfBlocked = checkCf(status, resHeaders, resBody);

      rows.push("\n📡 服务器实测响应:");
      if (cfBlocked) {
        rows.push(`  • 状态: ❌ 被 CF 盾墙拦截 (HTTP 403, ${cfBlocked})`);
        rows.push("  • 解决: 在 Safari 打开 re0.me 过一次滑块/点击");
      } else {
        rows.push(`  • 盾墙穿透: 🟢 成功绕开！HTTP ${status}`);

        let resMsg = "";
        try {
          const j = JSON.parse(resBody);
          resMsg = j.message || j.msg || "";
        } catch (e) {}

        if (!resMsg) {
          const m = String(resBody || "").match(/"message"\s*:\s*"((?:[^"\\]|\\.)+)"/);
          if (m) resMsg = m[1];
        }

        const ok = /签到成功|已签到|重复签到|明日再来|今日已签|已经签到|签到过了/.test(String(resBody || "")) ||
                   /"success"\s*:\s*true/.test(String(resBody || ""));

        if (ok) {
          rows.push(`  • 业务结果: ✅ ${resMsg || "签到成功/已签过"}`);
        } else if (resMsg) {
          rows.push(`  • 业务提示: ⚠️ ${resMsg}`);
        } else {
          const cleanRaw = String(resBody || "").replace(/[\r\n\t]+/g, " ").slice(0, 100);
          rows.push(`  • 原始返回: ${cleanRaw || "(空)"}`);
        }
      }
    }

    const text = rows.join("\n");
    console.log(`[${NAME}]\n${text}`);
    console.log(`[${NAME}] ========== RE0 签到与盾墙体检结束 ==========`);
    $notification.post(NAME, "RE0 穿盾体检结果", text);
    $done({ summary: text });
  });
}

if (typeof $httpClient === "undefined") {
  $done({ summary: "请在 Surge 环境中执行此脚本" });
} else {
  try {
    main();
  } catch (e) {
    console.log(`[${NAME}] 异常: ${e}`);
    $notification.post(NAME, "体检脚本异常", String(e));
    $done({ summary: `异常: ${e}` });
  }
}
