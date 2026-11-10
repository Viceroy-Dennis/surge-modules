/*
 * GLaDOS 多账号签到 — Surge iOS 5.9+ / Mac 5.5+
 * 配合 glados.sgmodule 使用；每天 09:14，设备本地时区。
 * 登录后刷新控制台，捕获 /api/user/status 的有效响应以保存账号。
 * 凭据仅存于本机 Surge $persistentStore；不要分享其存储导出。
 * 参数：notify=always|failure|off；手动管理：mode=list / mode=remove&id=1。
 */

(function () {
  "use strict";

  var STORE_KEY = "glados_multi_accounts";
  var REQUEST_TIMEOUT_SECONDS = 12;
  var RUN_BUDGET_MS = 160000; // 模块 timeout=180，预留结束和通知时间。
  var ACCOUNT_INTERVAL_MS = 400;
  var CHALLENGE_WAIT_MS = 2700;
  var PROOF_SUFFIX = ".glados-observe-v1";
  var HOSTS = [
    "glados.network", "glados.rocks", "glados.one", "glados.space",
    "glados.cloud", "glados.vip", "glados-facility.com"
  ];
  var finished = false;

  function finish() {
    if (finished) return;
    finished = true;
    $done({}); // HTTP 捕获时原样放行响应。
  }

  function publicError(message) {
    var error = new Error(message);
    error.publicMessage = message;
    return error;
  }

  function notify(subtitle, body) {
    try {
      $notification.post("GLaDOS 多账号", subtitle, body);
    } catch (_) {
      console.log("[GLaDOS] 通知未能发送，请检查 Surge 通知权限。");
    }
  }

  function isObject(value) {
    return value !== null && typeof value === "object" && !Array.isArray(value);
  }

  function jsonObject(text) {
    try {
      var value = JSON.parse(text);
      return isObject(value) ? value : null;
    } catch (_) {
      return null;
    }
  }

  function apiCode(data) {
    var code = data && data.code;
    if (typeof code === "number" && isFinite(code)) return code;
    if (typeof code === "string" && /^-?\d+$/.test(code)) return Number(code);
    return null; // null、空字符串和布尔值不能当作成功码 0。
  }

  function statusCode(response) {
    if (!response) return 0;
    var status = response.status !== undefined ? response.status : response.statusCode;
    return /^\d{3}$/.test(String(status)) ? Number(status) : 0;
  }

  function header(headers, name) {
    var keys = Object.keys(headers || {});
    for (var i = 0; i < keys.length; i++) {
      if (keys[i].toLowerCase() === name.toLowerCase()) {
        return typeof headers[keys[i]] === "string" ? headers[keys[i]].trim() : "";
      }
    }
    return "";
  }

  function validHeader(value) {
    return typeof value === "string" && !/[\r\n]/.test(value);
  }

  function identity(data) {
    var email = typeof data.email === "string" ? data.email.trim().toLowerCase() : "";
    if (!/^[^\s@]+@[^\s@]+$/.test(email)) email = "";
    var userId = "";
    if (typeof data.id === "string" && data.id.trim()) userId = data.id.trim();
    if (typeof data.id === "number" && isFinite(data.id)) userId = String(data.id);
    return { email: email, userId: userId };
  }

  function sameAccount(a, b) {
    if (a.email && b.email) return a.email === b.email;
    // 缺少邮箱时仅在相同域名中使用 ID 匹配，避免跨站误合并。
    return !!(a.userId && b.userId && a.userId === b.userId && a.host === b.host);
  }

  function accountLabel(account) {
    if (!account.email) return "#" + account.id;
    var parts = account.email.split("@");
    var masked = parts[0].slice(0, Math.min(2, Math.max(1, parts[0].length - 1)));
    return "#" + account.id + " " + masked + "***@" + parts[1];
  }

  function loadStore() {
    var raw = $persistentStore.read(STORE_KEY);
    if (raw === null || raw === undefined) return { schema: 1, nextId: 1, accounts: [] };
    var store = jsonObject(raw);
    var used = {};
    var valid = store && store.schema === 1 && Array.isArray(store.accounts) &&
      Number.isInteger(store.nextId) && store.nextId > 0;
    if (valid) {
      valid = store.accounts.every(function (account) {
        if (!isObject(account) || !Number.isInteger(account.id) || account.id < 1 ||
          account.id >= store.nextId || used[account.id]) return false;
        used[account.id] = true;
        return HOSTS.indexOf(account.host) !== -1 &&
          typeof account.email === "string" && typeof account.userId === "string" &&
          !!(account.email || account.userId) &&
          (!account.email || identity({ email: account.email }).email === account.email) &&
          validHeader(account.cookie) && validHeader(account.authorization) &&
          validHeader(account.userAgent) && !!(account.cookie || account.authorization);
      });
    }
    if (!valid) {
      throw publicError("账号存储格式异常，已停止以保留原数据。请检查本地存储项 " + STORE_KEY + "。");
    }
    return store;
  }

  function saveStore(store) {
    if (!$persistentStore.write(JSON.stringify(store), STORE_KEY)) {
      throw publicError("Surge 未能保存账号数据，请检查本地存储后重新抓取。");
    }
  }

  function capture() {
    if (typeof $response === "undefined" || !$request || !$response) return;
    if (String($request.method || "").toUpperCase() !== "GET") return;
    var match = /^https:\/\/([^/?#]+)\/api\/user\/status\/?(?:\?[^#]*)?$/.exec($request.url || "");
    var host = match ? match[1].toLowerCase() : "";
    if (HOSTS.indexOf(host) === -1) return;
    var status = statusCode($response);
    if (status < 200 || status >= 300) return;
    var response = jsonObject($response.body);
    if (!response || apiCode(response) !== 0 || !isObject(response.data)) return;
    var who = identity(response.data);
    if (!who.email && !who.userId) return;
    var cookie = header($request.headers, "Cookie");
    var authorization = header($request.headers, "Authorization");
    var userAgent = header($request.headers, "User-Agent");
    if ((!cookie && !authorization) || !validHeader(cookie) || !validHeader(authorization) ||
      !validHeader(userAgent)) return;

    // 同步读取、合并、保存；定时签到不回写整份账号库。
    var store = loadStore();
    var incoming = { email: who.email, userId: who.userId, host: host };
    var index = store.accounts.findIndex(function (account) { return sameAccount(account, incoming); });
    var previous = index >= 0 ? store.accounts[index] : null;
    var account = {
      id: previous ? previous.id : store.nextId,
      email: who.email || (previous ? previous.email : ""),
      userId: who.userId || (previous && previous.host === host ? previous.userId : ""),
      host: host,
      cookie: cookie,
      authorization: authorization,
      userAgent: userAgent
    };
    if (previous && JSON.stringify(previous) === JSON.stringify(account)) return;
    if (previous) store.accounts[index] = account;
    else {
      store.nextId += 1;
      store.accounts.push(account);
    }
    saveStore(store);
    notify(previous ? "账号凭据已更新" : "已添加账号", accountLabel(account) + " · " + host +
      "\n当前共 " + store.accounts.length + " 个账号。可切换下一个账号并刷新控制台。");
  }

  function readArguments() {
    var args = { mode: "checkin", notify: "always", id: "" };
    var text = typeof $argument === "string" ? $argument.trim() : "";
    if (text) {
      text.split("&").forEach(function (part) {
        var pos = part.indexOf("=");
        if (pos <= 0) throw publicError("参数格式错误，应使用 key=value，并用 & 分隔。");
        var key;
        var value;
        try {
          key = decodeURIComponent(part.slice(0, pos));
          value = decodeURIComponent(part.slice(pos + 1));
        } catch (_) {
          throw publicError("参数含有无效的 URL 编码。");
        }
        if (["mode", "notify", "id"].indexOf(key) === -1) throw publicError("脚本包含不支持的参数。");
        args[key] = value;
      });
    }
    if (["checkin", "list", "remove"].indexOf(args.mode) === -1) throw publicError("mode 应为 checkin、list 或 remove。");
    if (["always", "failure", "off"].indexOf(args.notify) === -1) throw publicError("notify 应为 always、failure 或 off。");
    if (args.mode === "remove" && !/^[1-9]\d*$/.test(args.id)) throw publicError("删除账号需要指定正整数 id，例如 mode=remove&id=1。");
    return args;
  }

  function manage(args, store) {
    if (args.mode === "list") {
      var lines = store.accounts.map(function (account) {
        return accountLabel(account) + " · " + account.host;
      });
      var body = lines.length ? lines.join("\n") : "尚未保存账号，请登录 GLaDOS 后刷新控制台。";
      console.log("[GLaDOS] " + body);
      notify("已保存 " + lines.length + " 个账号", body);
      return;
    }
    var index = store.accounts.findIndex(function (account) { return account.id === Number(args.id); });
    if (index < 0) throw publicError("没有找到指定编号的账号，请先运行 mode=list。");
    var label = accountLabel(store.accounts[index]);
    store.accounts.splice(index, 1);
    saveStore(store);
    notify("已删除本地账号", label + "\n剩余 " + store.accounts.length + " 个账号；编号保持不变。");
  }

  function requestJson(account, method, path, body, deadline) {
    var available = Math.floor((deadline - Date.now() - 250) / 1000);
    if (available < 1) return Promise.resolve({ kind: "budget" });
    var timeout = Math.min(REQUEST_TIMEOUT_SECONDS, available);
    var origin = "https://" + account.host;
    var headers = {
      Accept: "application/json, text/plain, */*",
      Origin: origin,
      Referer: origin + "/console/checkin",
      "Cache-Control": "no-cache"
    };
    if (account.cookie) headers.Cookie = account.cookie;
    if (account.authorization) headers.Authorization = account.authorization;
    if (account.userAgent) headers["User-Agent"] = account.userAgent;
    var options = {
      url: origin + path,
      headers: headers,
      timeout: timeout,
      "auto-cookie": false,
      "auto-redirect": false
    };
    if (body !== undefined) {
      headers["Content-Type"] = "application/json;charset=UTF-8";
      options.body = JSON.stringify(body);
    }
    return new Promise(function (resolve) {
      var settled = false;
      function settle(result) {
        if (settled) return;
        settled = true;
        resolve(result);
      }
      // JSC 不保证 clearTimeout 存在；settled 防止晚到回调重复结算。
      setTimeout(function () { settle({ kind: "timeout" }); }, timeout * 1000 + 100);
      try {
        $httpClient[method](options, function (error, response, text) {
          if (settled) return;
          if (error) return settle({ kind: "network" });
          var status = statusCode(response);
          if (status < 200 || status >= 300) return settle({ kind: "http", status: status });
          var data = jsonObject(text);
          settle(data ? { kind: "ok", data: data } : { kind: "invalid_json" });
        });
      } catch (_) {
        settle({ kind: "network" });
      }
    });
  }

  function transportMessage(result, checkin) {
    var uncertain = checkin ? "，签到结果未确认" : "";
    if (result.kind === "budget") return "执行时间不足";
    if (result.kind === "timeout") return "请求超时" + uncertain;
    if (result.kind === "network") return "网络异常" + uncertain;
    if (result.kind === "invalid_json") return "响应不是有效 JSON，可能遇到验证页面" + uncertain;
    if (result.status === 401) return "登录凭据失效，请重新登录并抓取";
    if (result.status === 403) return "HTTP 403，访问被拒绝，请在浏览器检查登录或验证页面";
    if (result.status === 429) return "HTTP 429，请求过于频繁，请稍后再运行";
    if (result.status >= 300 && result.status < 400) return "接口发生重定向，请从当前可用域名重新登录并抓取";
    if (result.status >= 500) return "服务暂时异常（HTTP " + result.status + "）" + uncertain;
    return result.status ? "请求失败（HTTP " + result.status + "）" : "缺少有效 HTTP 状态" + uncertain;
  }

  function classify(result) {
    if (result.kind !== "ok") {
      var kind = result.kind === "budget" ? "skipped" :
        (["timeout", "network", "invalid_json"].indexOf(result.kind) !== -1 || result.status >= 500 ? "uncertain" : "failed");
      return { kind: kind, message: transportMessage(result, true) };
    }
    var data = result.data;
    var code = apiCode(data);
    var message = typeof data.message === "string" ? data.message : "";
    if (data.reason === "device-mismatch") {
      return { kind: "failed", message: "登录设备校验未通过，请用原登录浏览器重新抓取凭据" };
    }
    if (/automated check.in detected/i.test(message)) {
      return { kind: "failed", message: "服务端拒绝自动签到，请在官网查看账号状态" };
    }
    if (code === -2 || /not\s*log(?:ged\s*in|in)|unauthorized|token\s*(?:error|expired)|未登录|登录.*(?:失效|过期)/i.test(message)) {
      return { kind: "failed", message: "登录凭据失效，请重新登录并抓取" };
    }
    var already = /please\s+try\s+tomorrow|today['’]s observation logged|return tomorrow|already\s+(?:check|signed)|今日已签到|今天已(?:经)?签到|已经签到|重复签到|明天再试/i.test(message);
    if (already && (code === null || code === 0 || code === 1)) {
      return { kind: "already", message: "今日已签到" };
    }
    if (code === 0) return { kind: "success", message: "签到成功" };
    // 不将历史积分流水或不明确的 code=1 当作本次签到成功。
    return { kind: "failed", message: "签到接口返回未识别结果" + (code === null ? "" : "（code=" + code + "）") };
  }

  function sha256(text) {
    // 无外部依赖的 UTF-8 / SHA-256；兼容 Surge JSC，无需 WebCrypto。
    var bytes = [];
    for (var c = 0; c < text.length; c++) {
      var point = text.charCodeAt(c);
      if (point >= 0xd800 && point <= 0xdbff) {
        var low = text.charCodeAt(c + 1);
        if (low >= 0xdc00 && low <= 0xdfff) {
          point = 0x10000 + ((point - 0xd800) << 10) + low - 0xdc00;
          c++;
        } else point = 0xfffd;
      } else if (point >= 0xdc00 && point <= 0xdfff) point = 0xfffd;
      if (point < 0x80) bytes.push(point);
      else if (point < 0x800) bytes.push(0xc0 | (point >>> 6), 0x80 | (point & 63));
      else if (point < 0x10000) bytes.push(0xe0 | (point >>> 12), 0x80 | ((point >>> 6) & 63), 0x80 | (point & 63));
      else bytes.push(0xf0 | (point >>> 18), 0x80 | ((point >>> 12) & 63), 0x80 | ((point >>> 6) & 63), 0x80 | (point & 63));
    }
    var bitLow = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    // 输入只含至多 4096 字符的 nonce 与固定后缀，长度远低于 2^32 bits。
    bytes.push(0, 0, 0, 0, (bitLow >>> 24) & 255, (bitLow >>> 16) & 255, (bitLow >>> 8) & 255, bitLow & 255);
    var hash = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var k = [
      0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
    ];
    function rotate(value, bits) { return (value >>> bits) | (value << (32 - bits)); }
    for (var offset = 0; offset < bytes.length; offset += 64) {
      var w = [];
      for (var i = 0; i < 16; i++) {
        var p = offset + i * 4;
        w[i] = (bytes[p] << 24) | (bytes[p + 1] << 16) | (bytes[p + 2] << 8) | bytes[p + 3];
      }
      for (var j = 16; j < 64; j++) {
        var x = w[j - 15];
        var y = w[j - 2];
        var s0 = rotate(x, 7) ^ rotate(x, 18) ^ (x >>> 3);
        var s1 = rotate(y, 17) ^ rotate(y, 19) ^ (y >>> 10);
        w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
      }
      var a = hash[0], b = hash[1], d = hash[3], e = hash[4], f = hash[5], g = hash[6], h = hash[7];
      var cc = hash[2];
      for (var n = 0; n < 64; n++) {
        var upper1 = rotate(e, 6) ^ rotate(e, 11) ^ rotate(e, 25);
        var choice = (e & f) ^ (~e & g);
        var t1 = (h + upper1 + choice + k[n] + w[n]) | 0;
        var upper0 = rotate(a, 2) ^ rotate(a, 13) ^ rotate(a, 22);
        var majority = (a & b) ^ (a & cc) ^ (b & cc);
        var t2 = (upper0 + majority) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0;
        d = cc; cc = b; b = a; a = (t1 + t2) | 0;
      }
      var block = [a, b, cc, d, e, f, g, h];
      for (var q = 0; q < 8; q++) hash[q] = (hash[q] + block[q]) | 0;
    }
    return hash.map(function (word) { return ("00000000" + (word >>> 0).toString(16)).slice(-8); }).join("");
  }

  async function submitCheckin(account, deadline) {
    if (deadline - Date.now() < CHALLENGE_WAIT_MS + 1500) {
      return { kind: "skipped", message: "执行时间不足，未提交签到" };
    }
    var started = Date.now();
    var challenge = await requestJson(account, "get", "/api/user/checkin/challenge", undefined, deadline);
    if (challenge.kind !== "ok") {
      return { kind: challenge.kind === "budget" ? "skipped" : "failed",
        message: "未提交签到：验证请求" + transportMessage(challenge, false) };
    }
    var data = challenge.data;
    var code = apiCode(data);
    var nonce = data.nonce;
    var ttl = data.ttl === undefined ? 300000 : data.ttl;
    if (code === -2) return { kind: "failed", message: "未提交签到：登录凭据失效，请重新抓取" };
    if (code !== 0 || typeof nonce !== "string" || !nonce.length || nonce.length > 4096 ||
      typeof ttl !== "number" || !isFinite(ttl) || ttl <= 0) {
      return { kind: "failed", message: "未提交签到：没有取得有效签到验证" };
    }
    // TTL 从发出验证请求开始保守计算，包含网络耗时。
    if (ttl <= Date.now() - started + CHALLENGE_WAIT_MS) {
      return { kind: "failed", message: "未提交签到：签到验证有效期不足" };
    }
    if (deadline - Date.now() < CHALLENGE_WAIT_MS + 1500) {
      return { kind: "skipped", message: "执行时间不足，未提交签到" };
    }
    var proof = sha256(nonce + PROOF_SUFFIX);
    await new Promise(function (resolve) { setTimeout(resolve, CHALLENGE_WAIT_MS); });
    if (Date.now() - started >= ttl || Date.now() < started) {
      return { kind: "failed", message: "未提交签到：签到验证已过期或系统时间变化" };
    }
    if (deadline - Date.now() < 1500) return { kind: "skipped", message: "执行时间不足，未提交签到" };
    // 一次性验证仅用于签发它的域名，始终复用同一账号、会话和 User-Agent。
    return classify(await requestJson(account, "post", "/api/user/checkin", {
      token: account.host, nonce: nonce, proof: proof
    }, deadline));
  }

  function numberValue(value) {
    if (typeof value !== "number" && typeof value !== "string") return null;
    if (typeof value === "string" && !/^-?\d+(?:\.\d+)?$/.test(value.trim())) return null;
    var number = Number(value);
    return isFinite(number) ? number : null;
  }

  function decimal(number) {
    return String(Math.round(number * 100) / 100);
  }

  async function addDetails(result, deadline) {
    if (deadline - Date.now() < 1500) {
      result.warnings.push("执行时间不足，未查询积分和天数");
      return;
    }
    var responses = await Promise.all([
      requestJson(result.account, "get", "/api/user/status", undefined, deadline),
      requestJson(result.account, "get", "/api/user/points", undefined, deadline)
    ]);
    var status = responses[0];
    var points = responses[1];
    if (status.kind === "ok" && apiCode(status.data) === 0 && isObject(status.data.data)) {
      var who = identity(status.data.data);
      who.host = result.account.host;
      if (!who.email && !who.userId) {
        result.warnings.push("状态响应缺少账号身份，未能核验");
      } else if (!sameAccount(result.account, who)) {
        result.kind = "uncertain";
        result.message = "签到已有响应，但账号身份未匹配，请重新抓取";
        return;
      }
      var days = numberValue(status.data.data.leftDays);
      if (days !== null) result.details.push("剩余 " + decimal(days) + " 天");
      else result.warnings.push("状态响应缺少有效剩余天数");
    } else {
      result.warnings.push("天数查询失败" + (status.kind !== "ok" ? "：" + transportMessage(status, false) : "：接口响应异常"));
    }
    var balance = points.kind === "ok" && apiCode(points.data) === 0 ? numberValue(points.data.points) : null;
    if (balance !== null) result.details.push("积分 " + decimal(balance));
    else result.warnings.push("积分查询失败" + (points.kind !== "ok" ? "：" + transportMessage(points, false) : "：接口响应异常"));
  }

  function resultLine(result) {
    var icons = { success: "✅", already: "☑️", failed: "❌", uncertain: "❔", skipped: "⏸" };
    var parts = [icons[result.kind] + " " + accountLabel(result.account), result.message].concat(result.details);
    if (result.warnings.length) parts.push("⚠ " + result.warnings.join("；"));
    return parts.join(" · ");
  }

  async function checkin(args, store) {
    if (!store.accounts.length) {
      notify("尚未保存账号", "请启用模块和 MITM，登录 GLaDOS 后刷新控制台；看到添加账号通知后再运行签到。");
      return;
    }
    var deadline = Date.now() + RUN_BUDGET_MS;
    var results = [];
    // 先让所有账号尝试签到，再查询附加信息，避免查询拖慢后续账号。
    for (var i = 0; i < store.accounts.length; i++) {
      var account = store.accounts[i];
      var result = await submitCheckin(account, deadline);
      result.account = account;
      result.details = [];
      result.warnings = [];
      results.push(result);
      if (i + 1 < store.accounts.length && deadline - Date.now() > ACCOUNT_INTERVAL_MS + 1500) {
        await new Promise(function (resolve) { setTimeout(resolve, ACCOUNT_INTERVAL_MS); });
      }
    }
    for (var j = 0; j < results.length; j++) {
      if (results[j].kind === "success" || results[j].kind === "already") {
        await addDetails(results[j], deadline);
      }
    }
    var count = { success: 0, already: 0, failed: 0, uncertain: 0, skipped: 0 };
    results.forEach(function (result) { count[result.kind] += 1; });
    var summary = "成功 " + count.success + " · 已签 " + count.already + " · 失败 " + count.failed +
      " · 未确认 " + count.uncertain + " · 未执行 " + count.skipped;
    var lines = results.map(resultLine);
    console.log("[GLaDOS] " + summary + "\n" + lines.join("\n"));
    var hasIssue = results.some(function (result) {
      return ["success", "already"].indexOf(result.kind) === -1 || result.warnings.length > 0;
    });
    if (args.notify === "always" || (args.notify === "failure" && hasIssue)) {
      // 控制通知长度，完整结果可在 Surge 脚本日志查看。
      var shown = lines.slice(0, 12);
      if (lines.length > shown.length) shown.push("另有 " + (lines.length - shown.length) + " 个账号，详见脚本日志。");
      notify(summary, shown.join("\n"));
    }
  }

  async function main() {
    if (typeof $request !== "undefined") {
      capture();
      return;
    }
    var args = readArguments();
    var store = loadStore();
    if (args.mode !== "checkin") manage(args, store);
    else await checkin(args, store);
  }

  Promise.resolve().then(main).then(finish, function (error) {
    var message = error && error.publicMessage ? error.publicMessage : "脚本运行异常，请检查 Surge 版本和脚本配置。";
    console.log("[GLaDOS] " + message);
    notify("运行异常", message);
    finish();
  });
})();
