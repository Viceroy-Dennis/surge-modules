// 途虎养车 —— Surge 登录凭据抓包脚本 (http-request)
// 捕获 Authorization (写入 tuhu_token 数组，支持单/多账号) 与 blackbox 设备风控凭证 (写入 tuhu_blackbox)
// 降噪设计：仅当捕获到全新或有效变更的 Token 时弹窗提醒

const NAME = "途虎抓包";
const TOKEN_KEY = "tuhu_token";
const BOX_KEY = "tuhu_blackbox";
const TIME_KEY = "tuhu_capture_time";

function lower(h) {
  const o = {};
  Object.keys(h || {}).forEach((k) => { o[String(k).toLowerCase()] = String(h[k]); });
  return o;
}

function readArr(key) {
  const raw = $persistentStore.read(key);
  if (!raw) return [];
  try {
    const v = JSON.parse(raw);
    if (Array.isArray(v)) return v.filter(Boolean);
    if (typeof v === "string" && v) return [v];
    return [];
  } catch (e) {
    return String(raw) ? [String(raw)] : [];
  }
}

function bare(tok) {
  return String(tok || "").trim().replace(/^Bearer\s+/i, "");
}

function pickAuth(headers) {
  return (
    headers["authorization"] ||
    headers["Authorization"] ||
    headers["usersession"] ||
    headers["user-session"] ||
    ""
  );
}

try {
  if (typeof $request === "undefined") {
    $done({});
  } else {
    const h = lower($request.headers || {});
    // 防自身任务回环
    if (h["x-surge-task"]) {
      $done({});
    } else {
      const url = String($request.url || "");
      if (/\.(png|jpg|jpeg|gif|webp|svg|css|ico|woff2?)$/i.test(url)) {
        $done({});
      } else {
        // 1. 捕获同盾设备风控 blackbox
        if (h["blackbox"]) {
          const oldBox = $persistentStore.read(BOX_KEY) || "";
          if (String(h["blackbox"]) !== oldBox) {
            $persistentStore.write(String(h["blackbox"]), BOX_KEY);
            console.log(`[${NAME}] blackbox 设备凭据已更新`);
          }
        }

        // 2. 捕获 Authorization Token
        const auth = String(pickAuth(h) || "").trim();
        if (!auth || auth.length < 15) {
          $done({});
        } else {
          const formattedToken = auth.startsWith("Bearer ") ? auth : `Bearer ${auth}`;
          const tokenBare = bare(formattedToken);

          const arr = readArr(TOKEN_KEY);
          const exists = arr.some((t) => bare(t) === tokenBare);

          if (exists) {
            console.log(`[${NAME}] Token 依然有效，静默跳过`);
            $done({});
          } else {
            arr.push(formattedToken);
            $persistentStore.write(JSON.stringify(arr), TOKEN_KEY);
            $persistentStore.write(String(Date.now()), TIME_KEY);

            console.log(`[${NAME}] 成功捕获新 Token！当前账号总数: ${arr.length}`);
            $notification.post(
              NAME,
              "Token 获取成功 🎉",
              `已成功捕获第 ${arr.length} 个账号\n来源: ${url.split("?")[0]}`
            );
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
