"use strict";

// Offline Surge-native simulation. Usage:
// node test-fengchao-surge.cjs [fengchao_task.js] [fengchao.sgmodule]
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const scriptPath = path.resolve(process.argv[2] || path.join(__dirname, "../fengchao/fengchao_task.js"));
const modulePath = path.resolve(process.argv[3] || path.join(__dirname, "../fengchao.sgmodule"));
const source = fs.readFileSync(scriptPath, "utf8");
const moduleSource = fs.readFileSync(modulePath, "utf8");
const STORAGE_KEY = "pting.club.checkin.session";
const ORIGIN = "https://fengchao.chat";
const allRuns = [];
const testCases = [];
const clone = (value) => value === undefined ? undefined : JSON.parse(JSON.stringify(value));

class PersistentStore {
  constructor(initial, failWrites = false) {
    this.values = new Map(Object.entries(initial || {}));
    this.reads = [];
    this.writes = [];
    this.failWrites = failWrites;
  }
  read(key) {
    this.reads.push(key);
    return this.values.has(key) ? this.values.get(key) : null;
  }
  write(value, key) {
    this.writes.push({ key, value });
    if (this.failWrites) return false;
    if (value === null) this.values.delete(key);
    else this.values.set(key, value);
    return true;
  }
}

function session(overrides = {}) {
  return {
    origin: ORIGIN,
    cookie: ["fixture_cookie", "offline-surge-test"].join("="),
    userAgent: "Fixture Safari UA",
    csrfToken: "",
    xsrfToken: "",
    ...overrides,
  };
}

function jsonReply(payload, status = 200) {
  return {
    error: null,
    response: { status, headers: { "content-type": "application/json" } },
    data: JSON.stringify(payload),
  };
}

function me(signed, overrides = {}) {
  return jsonReply({
    code: 0,
    message: "success",
    data: {
      user: { id: 1, username: "fixture-user" },
      surface: {
        checkedInToday: signed,
        currentCheckInStreak: signed ? 8 : 7,
        maxCheckInStreak: 10,
        balance: { source: "credit", status: "available", amount: signed ? 350 : 344 },
      },
      ...overrides,
    },
  });
}

function checkin(reward = 6, extra = {}) {
  return jsonReply({
    code: 0,
    message: "签到成功",
    data: { alreadyCheckedIn: false, reward, currentStreak: 8, date: "2026-11-08", ...extra },
  });
}

function pendingCallback() {
  let deliver;
  return {
    bind(callback) {
      assert.equal(deliver, undefined, "A delayed callback fixture may be bound only once");
      deliver = callback;
    },
    reply(reply) {
      assert.equal(typeof deliver, "function", "The HTTP callback must be registered before delivery");
      deliver(reply);
    },
  };
}

function harness(options = {}) {
  const storeContents = options.store || {
    [STORAGE_KEY]: JSON.stringify(options.session || session()),
  };
  const store = new PersistentStore(storeContents, options.failWrites);
  const requests = [];
  const deliveries = [];
  const notifications = [];
  const doneCalls = [];
  const unexpected = [];
  const steps = (options.http || []).slice();
  const timers = new Map();
  let nextTimerId = 0;

  function httpCall(method, request, callback) {
    assert.equal(typeof callback, "function", "Surge HTTP requires a callback");
    const copied = clone(request);
    requests.push({ ...copied, method });
    const step = steps.shift();
    if (!step) {
      unexpected.push(`Unexpected request: ${method} ${copied.url}`);
      queueMicrotask(() => callback("Unexpected fixture request", undefined, undefined));
      return;
    }
    if (step.method && method !== step.method) {
      unexpected.push(`Expected ${step.method}, received ${method}`);
    }
    if (step.path && copied.url !== (step.origin || ORIGIN) + step.path) {
      unexpected.push(`Expected URL ${(step.origin || ORIGIN) + step.path}, received ${copied.url}`);
    }
    const deliver = (reply) => {
      const response = clone(reply.response);
      deliveries.push({ error: reply.error, response, data: reply.data });
      // Native Surge callback shape: error, response(status/headers), separate data.
      // Neither response.statusCode nor response.body is supplied by the mock.
      callback(reply.error, response, reply.data);
    };
    if (step.pending) step.pending.bind(deliver);
    else queueMicrotask(() => deliver(step.reply));
    // Surge callback HTTP functions return no promise.
  }

  const sandbox = {
    $persistentStore: store,
    $httpClient: {
      get(request, callback) { httpCall("GET", request, callback); },
      post(request, callback) { httpCall("POST", request, callback); },
    },
    $notification: {
      post(title, subtitle, message) { notifications.push({ title, subtitle, message }); },
    },
    $done(...args) { doneCalls.push(clone(args)); },
    setTimeout(callback, delay) {
      const id = ++nextTimerId;
      timers.set(id, { callback, delay, active: true });
      return id;
    },
    clearTimeout(id) {
      const timer = timers.get(id);
      if (timer) timer.active = false;
    },
    console: { log() {}, warn() {}, error() {} },
  };
  if (options.request !== undefined) sandbox.$request = clone(options.request);
  if (options.argument !== undefined) sandbox.$argument = options.argument;
  const context = vm.createContext(sandbox);
  const absentQxGlobals = Array.from(vm.runInContext("[typeof $task, typeof $prefs, typeof $notify]", context));
  assert.deepEqual(absentQxGlobals, ["undefined", "undefined", "undefined"],
    "The fixture must not provide any Quantumult X globals");
  vm.runInContext(source, context, { filename: scriptPath, timeout: 1000 });

  const run = {
    store, requests, deliveries, notifications, doneCalls, unexpected, steps, timers, absentQxGlobals,
    capture: options.request !== undefined,
    postRequests: () => requests.filter((request) => request.method === "POST"),
    savedSession: () => JSON.parse(store.read(STORAGE_KEY)),
    fireTaskTimeout() {
      const timer = Array.from(timers.values()).find((entry) => entry.active && entry.delay === 40000);
      assert.ok(timer, "The 40-second task timer must be present and still active");
      timer.active = false;
      timer.callback();
    },
  };
  allRuns.push(run);
  return run;
}

async function flush() {
  for (let i = 0; i < 8; i++) await new Promise((resolve) => setImmediate(resolve));
}

async function completed(run, options = {}) {
  await flush();
  assert.equal(run.doneCalls.length, 1, "$done must run exactly once");
  assert.deepEqual(run.doneCalls, run.capture ? [[{}]] : [[]], "Capture must call $done({}); tasks must call $done()");
  assert.deepEqual(run.unexpected, [], "The script must only send expected requests");
  if (!options.allowRemaining) assert.equal(run.steps.length, 0, "All expected requests must be consumed");
  assert.equal(Array.from(run.timers.values()).filter((entry) => entry.active).length, 0,
    "Completed tasks must cancel their timers");
  for (const request of run.requests) {
    assert.equal(request.timeout, 10, "Every native HTTP request must have timeout=10 seconds");
    assert.equal(request["auto-cookie"], false, "Surge must not manage captured Cookies automatically");
    assert.equal(request["auto-redirect"], false, "Surge must not follow redirects with credentials");
    assert.equal(Object.hasOwn(request, "opts"), false, "A Surge request must not depend on Quantumult X opts");
    assert.match(request.url, /^https:\/\/(?:www\.)?(?:pting\.club|fengchao\.chat)\/api\/(?:auth\/me|check-in)$/,
      "HTTP requests must remain on the allowlisted host and paths");
  }
  const notificationCount = run.notifications.length;
  for (const timer of run.timers.values()) timer.callback();
  await flush();
  assert.equal(run.doneCalls.length, 1, "A queued timer must not call $done twice");
  assert.equal(run.notifications.length, notificationCount, "A completed task must not send late notifications");
  return run;
}

function wasSuccessful(run) {
  return run.notifications.some(({ subtitle }) =>
    ["签到成功", "今日签到已确认", "今天已签到"].includes(subtitle));
}

function notification(run, subtitle) {
  const found = run.notifications.find((item) => item.subtitle === subtitle);
  assert.ok(found, `Expected notification '${subtitle}'; received ${JSON.stringify(run.notifications)}`);
  return found;
}

function test(name, action) { testCases.push({ name, action }); }

function usualPlan(postReply = checkin(), afterReply = me(true)) {
  return [
    { method: "GET", path: "/api/auth/me", reply: me(false) },
    { method: "POST", path: "/api/check-in", reply: postReply },
    { method: "GET", path: "/api/auth/me", reply: afterReply },
  ];
}

test("normal sign-in sends exactly one correct POST and verifies success", async () => {
  const run = await completed(harness({ http: usualPlan() }));
  const posts = run.postRequests();
  assert.equal(posts.length, 1);
  assert.equal(posts[0].body, '{"action":"check-in"}');
  assert.equal(posts[0].headers["Content-Type"], "application/json");
  assert.equal(posts[0].headers.Cookie, session().cookie);
  assert.equal(posts[0].headers.Origin, ORIGIN);
  assert.equal(posts[0].headers.Referer, ORIGIN + "/");
  assert.equal(run.store.writes.length, 0, "Scheduled execution must not rewrite captured credentials");
  assert.match(notification(run, "签到成功").message, /本次奖励：6 蜂蜜/);
});

test("already signed today performs one GET and no POST", async () => {
  const run = await completed(harness({ http: [{ method: "GET", reply: me(true) }] }));
  assert.equal(run.requests.length, 1);
  assert.equal(run.postRequests().length, 0);
  notification(run, "今天已签到");
});

test("initial HTTP 401 never posts", async () => {
  const run = await completed(harness({ http: [{ method: "GET", reply: jsonReply({ code: 401 }, 401) }] }));
  assert.equal(run.postRequests().length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /HTTP 401/);
});

test("initial logged-out user:null never posts", async () => {
  const run = await completed(harness({ http: [{ method: "GET", reply: me(false, { user: null }) }] }));
  assert.equal(run.postRequests().length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /未检测到登录账户/);
});

test("HTTP 200 with an initial business error never succeeds or posts", async () => {
  const reply = jsonReply({ code: 1001, message: "fixture business failure", data: JSON.parse(me(true).data).data });
  const run = await completed(harness({ http: [{ method: "GET", reply }] }));
  assert.equal(run.postRequests().length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /fixture business failure/);
});

test("HTTP 200 POST business error and unsigned verification is not success", async () => {
  const run = await completed(harness({
    http: usualPlan(jsonReply({ code: 1001, message: "fixture business failure" }), me(false)),
  }));
  assert.equal(run.postRequests().length, 1);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /fixture business failure/);
});

test("POST timeout followed by signed me confirms success without replay", async () => {
  const http = usualPlan();
  http[1] = { method: "POST", reply: { error: "Fixture timeout", response: undefined, data: undefined } };
  const run = await completed(harness({ http }));
  assert.equal(run.postRequests().length, 1);
  notification(run, "今日签到已确认");
  assert.equal(wasSuccessful(run), true);
});

test("HTTP 200 POST but me still false is not success", async () => {
  const run = await completed(harness({ http: usualPlan(checkin(), me(false)) }));
  assert.equal(run.postRequests().length, 1);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /仍显示今日未签到/);
});

test("zero reward is valid and is displayed", async () => {
  const run = await completed(harness({ http: usualPlan(checkin(0), me(true)) }));
  assert.equal(run.postRequests().length, 1);
  assert.match(notification(run, "签到成功").message, /本次奖励：0 蜂蜜/);
});

test("case-insensitive capture headers are persisted with Surge write(value,key)", async () => {
  const run = await completed(harness({
    store: {},
    request: { url: "https://FENGCHAO.CHAT/api/auth/me?fixture=1", headers: {
      cOoKiE: "  capture_fixture=1  ", "uSeR-aGeNt": "Mixed Case UA",
      "x-CsRf-ToKeN": "mixed-csrf", "X-xSrF-tOkEn": "mixed-xsrf",
    } },
  }));
  assert.deepEqual(run.savedSession(), {
    origin: ORIGIN, cookie: "capture_fixture=1", userAgent: "Mixed Case UA",
    csrfToken: "mixed-csrf", xsrfToken: "mixed-xsrf",
  });
  assert.equal(run.store.writes.length, 1);
  assert.equal(run.store.writes[0].key, STORAGE_KEY);
  assert.equal(run.requests.length, 0);
  assert.deepEqual(run.doneCalls, [[{}]]);
  notification(run, "凭据已保存");
});

test("empty capture Cookie preserves existing credentials", async () => {
  const raw = JSON.stringify(session({ csrfToken: "existing-csrf" }));
  const run = await completed(harness({
    store: { [STORAGE_KEY]: raw },
    request: { url: ORIGIN + "/api/auth/me", headers: { COOKIE: "   " } },
  }));
  assert.equal(run.store.read(STORAGE_KEY), raw);
  assert.equal(run.store.writes.length, 0);
  assert.equal(run.requests.length, 0);
});

test("malicious stored origin is rejected before any request", async () => {
  const run = await completed(harness({ session: session({ origin: "https://fengchao.chat.evil.example" }) }));
  assert.equal(run.requests.length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /本地凭据无效/);
});

test("HTTP and path-bearing stored origins are rejected", async () => {
  for (const origin of ["http://fengchao.chat", "https://fengchao.chat/private", "https://fengchao.chat@evil.example"]) {
    const run = await completed(harness({ session: session({ origin }) }));
    assert.equal(run.requests.length, 0, `Rejected origin: ${origin}`);
    assert.equal(wasSuccessful(run), false);
  }
});

test("untrusted capture domain does not overwrite or send credentials", async () => {
  const raw = JSON.stringify(session());
  const run = await completed(harness({
    store: { [STORAGE_KEY]: raw },
    request: { url: "https://fengchao.chat.evil.example/api/auth/me", headers: { Cookie: "evil_fixture=1" } },
  }));
  assert.equal(run.store.read(STORAGE_KEY), raw);
  assert.equal(run.requests.length, 0);
  assert.equal(run.store.writes.length, 0);
});

test("successful POST and failed confirmation query reports pending", async () => {
  const run = await completed(harness({ http: usualPlan(checkin(), jsonReply({ code: 503 }, 503)) }));
  assert.equal(run.postRequests().length, 1);
  assert.equal(wasSuccessful(run), false);
  notification(run, "签到结果待确认");
});

test("POST timeout plus failed confirmation query also reports pending", async () => {
  const http = usualPlan();
  http[1] = { method: "POST", reply: { error: "Fixture POST timeout" } };
  http[2] = { method: "GET", reply: { error: "Fixture verification timeout" } };
  const run = await completed(harness({ http }));
  assert.equal(run.postRequests().length, 1);
  assert.equal(wasSuccessful(run), false);
  notification(run, "签到结果待确认");
});

test("remembered CSRF headers are forwarded to scheduled requests", async () => {
  const run = await completed(harness({
    session: session({ csrfToken: "stored-csrf", xsrfToken: "stored-xsrf" }), http: usualPlan(),
  }));
  for (const request of run.requests) {
    assert.equal(request.headers["X-CSRF-Token"], "stored-csrf");
    assert.equal(request.headers["X-XSRF-Token"], "stored-xsrf");
  }
});

test("same-session GET capture preserves remembered CSRF and User-Agent", async () => {
  const run = await completed(harness({
    session: session({ csrfToken: "stored-csrf", xsrfToken: "stored-xsrf" }),
    request: { url: ORIGIN + "/api/auth/me", headers: { Cookie: session().cookie } },
  }));
  assert.equal(run.savedSession().csrfToken, "stored-csrf");
  assert.equal(run.savedSession().xsrfToken, "stored-xsrf");
  assert.equal(run.savedSession().userAgent, session().userAgent);
  assert.equal(run.requests.length, 0);
});

test("capture updates explicitly supplied CSRF tokens", async () => {
  const run = await completed(harness({
    session: session({ csrfToken: "old-csrf", xsrfToken: "old-xsrf" }),
    request: { url: ORIGIN + "/api/check-in", headers: { Cookie: session().cookie,
      "X-CSRF-Token": "new-csrf", "X-XSRF-Token": "new-xsrf" } },
  }));
  assert.equal(run.savedSession().csrfToken, "new-csrf");
  assert.equal(run.savedSession().xsrfToken, "new-xsrf");
});

test("switching capture domain does not carry old CSRF credentials", async () => {
  const run = await completed(harness({
    session: session({ csrfToken: "old-csrf", xsrfToken: "old-xsrf" }),
    request: { url: "https://pting.club/api/auth/me", headers: { Cookie: "other_domain_fixture=1" } },
  }));
  assert.equal(run.savedSession().origin, "https://pting.club");
  assert.equal(run.savedSession().csrfToken, "");
  assert.equal(run.savedSession().xsrfToken, "");
});

test("global timeout finishes once and a late initial GET cannot start POST", async () => {
  const initial = pendingCallback();
  const run = harness({ http: [
    { method: "GET", pending: initial },
    { method: "POST", reply: checkin() },
    { method: "GET", reply: me(true) },
  ] });
  await flush();
  assert.equal(run.requests.length, 1);
  assert.equal(run.doneCalls.length, 0);
  run.fireTaskTimeout();
  assert.equal(run.doneCalls.length, 1);
  notification(run, "执行超时");
  initial.reply(me(false));
  await completed(run, { allowRemaining: true });
  assert.equal(run.postRequests().length, 0);
  assert.equal(run.requests.length, 1, "An ended task must not start additional HTTP requests");
});

test("global timeout during POST finishes once after its late callback", async () => {
  const submitted = pendingCallback();
  const run = harness({ http: [
    { method: "GET", reply: me(false) },
    { method: "POST", pending: submitted },
    { method: "GET", reply: me(true) },
  ] });
  await flush();
  assert.equal(run.postRequests().length, 1);
  run.fireTaskTimeout();
  const notificationCount = run.notifications.length;
  submitted.reply(checkin());
  await completed(run, { allowRemaining: true });
  assert.equal(run.postRequests().length, 1);
  assert.equal(run.requests.length, 2, "No verification HTTP may start after the task ends");
  assert.equal(run.notifications.length, notificationCount);
});

test("failed persistentStore.write is reported and capture finishes once", async () => {
  const run = await completed(harness({
    store: {}, failWrites: true,
    request: { url: ORIGIN + "/api/auth/me", headers: { Cookie: "write_failure_fixture=1" } },
  }));
  assert.equal(run.store.read(STORAGE_KEY), null);
  assert.equal(run.requests.length, 0);
  notification(run, "保存失败");
});

test("missing credentials fail locally without any HTTP request", async () => {
  const run = await completed(harness({ store: {} }));
  assert.equal(run.requests.length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /未获取 Cookie/);
});

// Surge-specific transport, diagnose mode, and module integration checks.
test("Surge callback status and separate data are sufficient without QX globals", async () => {
  const run = await completed(harness({ http: [{ method: "GET", reply: me(true) }] }));
  assert.deepEqual(run.absentQxGlobals, ["undefined", "undefined", "undefined"]);
  assert.deepEqual(Object.keys(run.deliveries[0].response).sort(), ["headers", "status"]);
  assert.equal(typeof run.deliveries[0].data, "string");
  assert.equal(Object.hasOwn(run.deliveries[0].response, "statusCode"), false);
  assert.equal(Object.hasOwn(run.deliveries[0].response, "body"), false);
  notification(run, "今天已签到");
});

test("callback error overrides an otherwise successful status and data", async () => {
  const reply = me(true);
  reply.error = "Fixture transport error";
  const run = await completed(harness({ http: [{ method: "GET", reply }] }));
  assert.equal(run.postRequests().length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /网络请求失败或超时/);
});

test("callback HTTP status rejects 503 even when separate data looks successful", async () => {
  const reply = me(true);
  reply.response.status = 503;
  const run = await completed(harness({ http: [{ method: "GET", reply }] }));
  assert.equal(run.postRequests().length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /HTTP 503/);
});

test("non-JSON separate callback data is rejected", async () => {
  const reply = { error: null, response: { status: 200, headers: {} }, data: "fixture non-json data" };
  const run = await completed(harness({ http: [{ method: "GET", reply }] }));
  assert.equal(run.postRequests().length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /非 JSON/);
});

test("missing callback response status cannot succeed based on JSON alone", async () => {
  const reply = me(true);
  reply.response = undefined;
  const run = await completed(harness({ http: [{ method: "GET", reply }] }));
  assert.equal(run.postRequests().length, 0);
  assert.equal(wasSuccessful(run), false);
  assert.match(notification(run, "签到未完成").message, /HTTP NaN/);
});

test("diagnose unsigned account only GETs and does not write credentials", async () => {
  const raw = JSON.stringify(session());
  const run = await completed(harness({ argument: "diagnose", store: { [STORAGE_KEY]: raw },
    http: [{ method: "GET", path: "/api/auth/me", reply: me(false) }] }));
  assert.equal(run.requests.length, 1);
  assert.equal(run.postRequests().length, 0);
  assert.equal(run.store.writes.length, 0);
  assert.equal(run.store.read(STORAGE_KEY), raw);
  assert.match(notification(run, "状态查询成功").message, /今日未签到/);
  assert.equal(wasSuccessful(run), false);
});

test("diagnose signed account only GETs and shows the current state", async () => {
  const run = await completed(harness({ argument: " diagnose ",
    http: [{ method: "GET", path: "/api/auth/me", reply: me(true) }] }));
  assert.equal(run.requests.length, 1);
  assert.equal(run.postRequests().length, 0);
  assert.equal(run.store.writes.length, 0);
  assert.match(notification(run, "状态查询成功").message, /今日已签到/);
});

test("diagnose unauthorized account reports query failure without POST or writes", async () => {
  const run = await completed(harness({ argument: "diagnose",
    http: [{ method: "GET", reply: jsonReply({ code: 401 }, 401) }] }));
  assert.equal(run.postRequests().length, 0);
  assert.equal(run.store.writes.length, 0);
  notification(run, "状态查询失败");
});

test("diagnose missing credentials fails locally without HTTP or writes", async () => {
  const run = await completed(harness({ argument: "diagnose", store: {} }));
  assert.equal(run.requests.length, 0);
  assert.equal(run.store.writes.length, 0);
  assert.match(notification(run, "状态查询失败").message, /未获取 Cookie/);
});

test("diagnose timeout and late callback still perform no POST or writes", async () => {
  const initial = pendingCallback();
  const run = harness({ argument: "diagnose", http: [{ method: "GET", pending: initial }] });
  await flush();
  run.fireTaskTimeout();
  initial.reply(me(false));
  await completed(run);
  assert.equal(run.requests.length, 1);
  assert.equal(run.postRequests().length, 0);
  assert.equal(run.store.writes.length, 0);
  notification(run, "执行超时");
});

function scriptEntries() {
  const scriptSection = moduleSource.split(/\[Script\]/i)[1]?.split(/\[MITM\]/i)[0];
  assert.ok(scriptSection, "The module must contain a Script section");
  return scriptSection.split(/\r?\n/).map((line) => line.trim()).filter((line) => /\btype=/.test(line));
}

test("module cron, user-visible time, and script comment all specify 09:14", async () => {
  const cron = scriptEntries().filter((line) => /\btype=cron\b/.test(line));
  assert.equal(cron.length, 1);
  assert.match(cron[0], /\bcronexp="14 9 \* \* \*"/);
  assert.match(moduleSource, /#!desc=.*09:14/);
  assert.match(source, /09:14/);
  assert.match(source, /cronexp="14 9 \* \* \*"/);
});

test("module has capture, cron, generic sign-in, and generic diagnose sharing one URL", async () => {
  const entries = scriptEntries();
  assert.equal(entries.length, 4);
  assert.equal(entries.filter((line) => /\btype=http-request\b/.test(line)).length, 1);
  assert.equal(entries.filter((line) => /\btype=generic\b/.test(line)).length, 2);
  const diagnose = entries.filter((line) => /\bargument=diagnose\b/.test(line));
  assert.equal(diagnose.length, 1);
  assert.match(diagnose[0], /\btype=generic\b/);
  const signIn = entries.filter((line) => /\btype=generic\b/.test(line) && !/\bargument=/.test(line));
  assert.equal(signIn.length, 1);
  const urls = entries.map((line) => line.match(/\bscript-path=(https:\/\/[^,\s]+)/)?.[1]);
  assert.ok(urls.every(Boolean));
  assert.equal(new Set(urls).size, 1);
  assert.match(urls[0], /^https:\/\/raw\.githubusercontent\.com\/[^/]+\/surge-modules\/main\/fengchao\/fengchao_task\.js$/);
  assert.ok(urls[0].endsWith("/" + path.basename(scriptPath)), "The module must load the tested script filename");
  for (const entry of entries) assert.match(entry, /\bscript-update-interval=0(?:\s|$)/);
});

test("module capture pattern and timeout settings match the script entry modes", async () => {
  const entries = scriptEntries();
  const capture = entries.find((line) => /\btype=http-request\b/.test(line));
  assert.match(capture, /\brequires-body=false\b/);
  assert.match(capture, /\btimeout=10\b/);
  const patternText = capture.match(/\bpattern=(.*?),\s*requires-body=/)?.[1];
  assert.ok(patternText);
  const pattern = new RegExp(patternText);
  for (const host of ["pting.club", "www.pting.club", "fengchao.chat", "www.fengchao.chat"]) {
    assert.equal(pattern.test(`https://${host}/api/auth/me`), true);
    assert.equal(pattern.test(`https://${host}/api/check-in?fixture=1`), true);
  }
  for (const url of ["http://fengchao.chat/api/auth/me", "https://fengchao.chat.evil.example/api/auth/me",
    "https://evil.example/api/auth/me", "https://fengchao.chat/api/auth/login"]) {
    assert.equal(pattern.test(url), false, `The module must not capture ${url}`);
  }
  for (const entry of entries.filter((line) => !/\btype=http-request\b/.test(line))) {
    assert.match(entry, /\btimeout=45\b/, "Task entry timeout must allow the script's 40-second timer");
  }
});

test("module appends exactly the four approved MITM hosts", async () => {
  const hostLine = moduleSource.match(/^hostname\s*=\s*%APPEND%\s+(.+)$/m);
  assert.ok(hostLine, "MITM hostnames must append to the existing configuration");
  const hosts = hostLine[1].split(",").map((value) => value.trim()).sort();
  assert.deepEqual(hosts, ["pting.club", "www.pting.club", "fengchao.chat", "www.fengchao.chat"].sort());
  assert.match(moduleSource, /^#!arguments=capture:/m);
});

(async () => {
  let passed = 0;
  const failures = [];
  for (const { name, action } of testCases) {
    try {
      await action();
      passed++;
      console.log(`PASS ${name}`);
    } catch (error) {
      const message = error && error.message ? error.message : String(error);
      failures.push({ name, message });
      console.log(`FAIL ${name}\n  ${message.replace(/\n/g, "\n  ")}`);
    }
  }
  const requestCount = allRuns.reduce((sum, run) => sum + run.requests.length, 0);
  const postCount = allRuns.reduce((sum, run) => sum + run.postRequests().length, 0);
  const doneCount = allRuns.reduce((sum, run) => sum + run.doneCalls.length, 0);
  console.log(`\nSUMMARY tests=${testCases.length} passed=${passed} failed=${failures.length} runs=${allRuns.length}`);
  console.log(`SURGE_SIMULATED requests=${requestCount} post=${postCount} done=${doneCount} realNetwork=0 realTimeoutWait=0 qxGlobals=0`);
  if (failures.length) {
    console.log("FAILURES " + JSON.stringify(failures, null, 2));
    process.exitCode = 1;
  }
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
