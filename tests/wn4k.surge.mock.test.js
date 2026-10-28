/*
 * 蜗牛4K 签到脚本 · Node mock 回归测试（Surge 环境）
 * 跑法：node tests/wn4k.surge.mock.test.js
 *
 * 重点验证 Surge 专属差异：$httpClient 回调式、$persistentStore 参数顺序、
 * $argument 模块参数、http-request 脚本必须 $done()。
 */
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const CODE = fs.readFileSync(path.join(__dirname, "..", "wn4k", "wn4k_task.js"), "utf8");
const BASE = "https://wn4k.com";

let pass = 0;
let fail = 0;

function ok(name, cond, extra) {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? " → " + extra : ""}`);
  }
}
function eq(name, actual, expect) {
  ok(name, actual === expect, `实际=${JSON.stringify(actual)} 期望=${JSON.stringify(expect)}`);
}

function run({ prefs = {}, routes = {}, capture = null, argument = undefined }) {
  const store = new Map(Object.entries(prefs));
  const notes = [];
  const calls = [];
  let doneCount = 0;

  const cbOf = (opts) => (err, resp, data) => {
    calls.push({ url: opts.url, method: (opts.method || "GET").toUpperCase(), headers: opts.headers || {}, body: opts.body || "" });
    const r = (routes(opts) || { status: 404, headers: {}, body: "" });
    // Surge 回调是异步的，给一 tick 好让调用顺序稳定
    setTimeout(() => err ? null : resp, 0);
    return { err: null, resp: { status: r.status, headers: r.headers || {} }, data: r.body || "" };
  };

  const sandbox = {
    console: { log: () => {}, error: () => {} },
    setTimeout: (fn) => setTimeout(fn, 0),
    setInterval: (fn) => setInterval(fn, 0),
    clearTimeout: () => {},
    clearInterval: () => {},
    Promise,
    JSON,
    Math,
    Date,
    Number,
    String,
    Object,
    Array,
    RegExp,
    encodeURIComponent,
    decodeURIComponent,
    $httpClient: {
      get(opts, cb) {
        const r = routes(opts) || { status: 404, headers: {}, body: "" };
        calls.push({ url: opts.url, method: "GET", headers: opts.headers || {}, body: "" });
        setTimeout(() => cb(null, { status: r.status, headers: r.headers || {} }, r.body || ""), 0);
      },
      post(opts, cb) {
        const r = routes(opts) || { status: 404, headers: {}, body: "" };
        calls.push({ url: opts.url, method: "POST", headers: opts.headers || {}, body: opts.body || "" });
        setTimeout(() => cb(null, { status: r.status, headers: r.headers || {} }, r.body || ""), 0);
      },
    },
    $persistentStore: {
      read: (k) => (store.has(k) ? store.get(k) : null),
      write: (v, k) => {
        store.set(k, v);
        return true;
      },
    },
    $notification: { post: (title, sub, body) => notes.push({ title, sub, body }) },
    $done: () => {
      doneCount++;
    },
  };

  if (argument !== undefined) sandbox.$argument = argument;

  if (capture) {
    sandbox.$request = { url: capture.url || `${BASE}/user/index.html`, method: "GET", headers: capture.headers || {} };
  }

  vm.createContext(sandbox);
  vm.runInContext(CODE, sandbox, { filename: "wn4k_task.js" });

  return new Promise((resolve) => {
    setTimeout(() => resolve({ store, notes, calls, doneCount: () => doneCount }), 80);
  });
}

const json = (status, body, headers) => ({ status, headers: Object.assign({ "Content-Type": "application/json" }, headers || {}), body: JSON.stringify(body) });

(async () => {
  console.log("\n[1] cron 分支：Cookie 签到成功，且 $done 被调用");
  {
    const { store, notes, calls, doneCount } = await run({
      prefs: { WN4K_CRED: "user_id=27; user_token=abc" },
      routes: () => json(200, { code: 1, msg: "签到成功", info: { points: 10 } }),
    });
    eq("POST 到 checkin", calls[0].url, `${BASE}/user/checkin.html`);
    eq("带 Cookie", calls[0].headers.Cookie, "user_id=27; user_token=abc");
    eq("日期落库", !!store.get("WN4K_LAST_DATE"), true);
    eq("$done 调了 1 次", doneCount(), 1);
    ok("通知含 +10", /\+10/.test(notes[0].body), JSON.stringify(notes[0]));
  }

  console.log("\n[2] $argument 传账号密码：登录 → 签到");
  {
    const { store, calls } = await run({
      argument: "27@qq.com,pa55word",
      routes: (o) =>
        o.url.includes("login")
          ? json(200, { code: 1, msg: "登录成功" }, { "Set-Cookie": "user_id=27; Path=/, user_token=t27; Path=/" })
          : json(200, { code: 1, msg: "签到成功", info: { points: 3 } }),
    });
    eq("顺序 login>checkin", calls.map((c) => (c.url.includes("login") ? "login" : "checkin")).join(">"), "login>checkin");
    eq("登录表单里账号正确", calls[0].body, "user_name=27%40qq.com&user_pwd=pa55word");
    eq("Cookie 落库", store.get("WN4K_CRED"), "user_id=27; user_token=t27");
  }

  console.log("\n[3] $argument 多账号 && 分隔");
  {
    const { calls } = await run({
      argument: "a@qq.com,p1&&b@qq.com,p2",
      routes: (o) =>
        o.url.includes("login")
          ? json(200, { code: 1 }, { "Set-Cookie": "user_id=1; user_token=x" })
          : json(200, { code: 1, msg: "签到成功", info: { points: 1 } }),
    });
    ok("至少两次网络请求", calls.length >= 2, String(calls.length));
  }

  console.log("\n[4] http-request 抓包：存 Cookie 并 $done 放行");
  {
    const { store, doneCount } = await run({
      capture: { headers: { Cookie: "user_id=27; user_token=zzz; PHPSESSID=s1" } },
      routes: () => json(200, { code: 1001, msg: "今日已签到" }),
    });
    eq("Cookie 落库", store.get("WN4K_CRED"), "user_id=27; user_token=zzz; PHPSESSID=s1");
    ok("$done 已调用（放行请求）", doneCount() >= 1, String(doneCount()));
  }

  console.log("\n[5] Set-Cookie 多个独立响应头（数组形式）也能拼");
  {
    const { store } = await run({
      argument: "x@qq.com,p",
      routes: (o) =>
        o.url.includes("login")
          ? json(200, { code: 1 }, { "Set-Cookie": ["user_id=5; Path=/; Expires=Wed, 21 Oct 2026 07:28:00 GMT", "user_token=q5; Path=/; HttpOnly"] })
          : json(200, { code: 1, msg: "签到成功" }),
    });
    eq("两个头都解析到", store.get("WN4K_CRED"), "user_id=5; user_token=q5");
  }

  console.log("\n[6] 账号错密码：不重试、说明清楚");
  {
    const { notes, calls } = await run({
      argument: "x@qq.com,bad",
      routes: () => json(200, { code: 1003, msg: "获取用户信息失败" }),
    });
    eq("只登录一次", calls.length, 1);
    ok("通知里带服务器原文", /获取用户信息失败/.test(notes[0].body), JSON.stringify(notes[0]));
  }

  console.log(`\n===== ${pass} 通过 / ${fail} 失败 =====`);
  process.exit(fail === 0 ? 0 : 1);
})();
