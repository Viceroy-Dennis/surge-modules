"use strict";

// Offline Surge runtime tests. No QX globals or real network are available.
// Run: node tests/wn4k.surge.checkin.test.cjs
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const path = require("node:path");
const source = fs.readFileSync(path.join(__dirname, "../wn4k/wn4k_checkin.js"), "utf8");
const STORE = "wn4k.checkin.accounts.v1";
const LOCK = "wn4k.checkin.lock.v1";
const BASE = Date.parse("2026-10-28T01:05:00Z");

function response(status = 200, body = { code: 1, msg: "Check-in successful" }, headers = {}) {
  return { status, body: typeof body === "string" ? body : JSON.stringify(body), headers };
}

function request(id = "11", overrides = {}) {
  return Object.assign({
    url: "https://wn4k.com/user/ajax_sign.html",
    method: "POST",
    headers: {
      Cookie: "user_id=" + id + "; user_name=test" + id + "; session=SECRET" + id,
      "Content-Type": "application/x-www-form-urlencoded", "Content-Length": "10", "X-Noise": "ignore"
    },
    body: "mode=daily"
  }, overrides);
}

async function flushPromises() {
  // Drain chained Promise handlers before advancing the virtual timer queue.
  for (let i = 0; i < 16; i++) await Promise.resolve();
}

async function execute(options = {}) {
  const store = options.store || new Map();
  const notifications = [];
  const requests = [];
  const logs = [];
  const waits = [];
  const writes = [];
  const doneArgs = [];
  const callbacks = [];
  const timers = new Map();
  const queue = [...(options.responses || [])];
  let time = options.time || BASE;
  let timerId = 0;
  let doneCount = 0;
  let watchdogForced = false;

  class Clock extends Date {
    constructor(...args) { super(...(args.length ? args : [time])); }
    static now() { return time; }
  }

  function schedule(callback, delay) {
    const id = ++timerId;
    timers.set(id, { callback, at: time + Number(delay), delay: Number(delay) });
    return id;
  }

  function send(method, req, callback) {
    const captured = JSON.parse(JSON.stringify(req));
    // Surge selects the HTTP method by $httpClient.get/post.
    captured.method = method;
    requests.push(captured);
    callbacks.push(callback);
    const step = queue.shift();
    if (!step) throw new Error("Missing offline fixture");
    if (step.throw) throw new Error(step.throw);
    if (step.never) return;
    const deliver = () => {
      if (step.update) step.update(store);
      const res = step.response || step;
      const metadata = { headers: res.headers || {} };
      if (res.status !== undefined) metadata.status = res.status;
      if (res.statusCode !== undefined) metadata.statusCode = res.statusCode;
      callback(step.error || null, metadata, res.body);
      if (step.duplicate) callback(null, metadata, res.body);
    };
    if (step.advance || step.delay) schedule(deliver, step.advance || step.delay);
    else queueMicrotask(deliver);
  }

  const context = {
    Date: Clock,
    console: { log: (...values) => logs.push(values.join(" ")) },
    setTimeout(callback, ms) { waits.push(Number(ms)); return schedule(callback, ms); },
    clearTimeout(id) { timers.delete(id); },
    $persistentStore: {
      read: key => store.has(key) ? store.get(key) : null,
      write(value, key) {
        writes.push({ key, value });
        if (options.failWrite) return false;
        store.set(key, value);
        return true;
      }
    },
    $notification: { post: (...args) => notifications.push(args) },
    $done: (...args) => { doneCount++; doneArgs.push(args); },
    $httpClient: {
      get: (req, cb) => send("GET", req, cb),
      post: (req, cb) => send("POST", req, cb)
    }
  };
  if (options.noClearTimeout) delete context.clearTimeout;
  if (options.request) context.$request = options.request;
  if (options.argument !== undefined) context.$argument = options.argument;
  vm.runInNewContext(source, context, { filename: "wn4k_checkin.js", timeout: 1000 });

  for (let turn = 0; turn < 500 && !doneCount; turn++) {
    await flushPromises();
    if (doneCount) break;
    let pending = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0]);
    if (options.fireWatchdogFirst && !watchdogForced) {
      // A delayed native callback must also be harmless when the run ends first.
      const watchdog = pending.find(([, timer]) => timer.delay >= 100000);
      if (watchdog) { pending = [watchdog]; watchdogForced = true; }
    }
    if (!pending.length) throw new Error("Script stalled without pending timers");
    const [id, timer] = pending[0];
    timers.delete(id);
    time = Math.max(time, timer.at);
    timer.callback();
  }
  await flushPromises();
  assert.equal(doneCount, 1, "Must finish exactly once");

  return {
    store, requests, notifications, waits, logs, writes, doneArgs,
    get time() { return time; },
    get doneCount() { return doneCount; },
    async drainTimers() {
      let fired = 0;
      while (timers.size && fired < 500) {
        await flushPromises();
        const [id, timer] = [...timers].sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
        timers.delete(id);
        time = Math.max(time, timer.at);
        timer.callback();
        fired++;
      }
      await flushPromises();
      assert.equal(timers.size, 0, "Remaining timers must stop scheduling work");
      return fired;
    },
    async lateCallback(index = 0, res = response()) {
      assert.ok(callbacks[index], "Expected a saved native callback");
      callbacks[index](null, { status: res.status, headers: res.headers }, res.body);
      await flushPromises();
    }
  };
}

async function seed(ids = ["11"]) {
  const store = new Map();
  for (const id of ids) await execute({ store, request: request(id) });
  return store;
}

const tests = [];
function test(name, fn) { tests.push([name, fn]); }
function accounts(store) { return JSON.parse(store.get(STORE) || "[]"); }
function text(result) { return JSON.stringify(result.notifications); }

 test("empty task reports missing accounts and finishes without network access", async () => {
  const result = await execute();
  assert.ok(result.logs.some(line => line.includes("START")));
  assert.ok(result.logs.some(line => line.includes("NO_ACCOUNTS")));
  assert.ok(result.logs.some(line => line.includes("END")));
  assert.equal(result.requests.length, 0);
  assert.ok(result.notifications.length > 0);
});

 test("native callback results keep account credentials out of notifications and logs", async () => {
  const store = await seed(["11", "22"]);
  const result = await execute({ store, responses: [response(), response()] });
  assert.equal(result.logs.filter(line => line.includes("RESULT") && line.includes("HTTP=200")).length, 2);
  const visible = JSON.stringify([result.logs, result.notifications]);
  for (const secret of ["SECRET", "user_id=", "test11", "test22"]) assert.equal(visible.includes(secret), false);
});

 test("Surge argument diagnose inspects accounts without requests or writes", async () => {
  const store = await seed();
  store.set("WN4K_CREDS", '{"11":{"ck":"SECRET","nm":"test11"}}');
  const before = JSON.stringify([...store]);
  const result = await execute({ store, argument: "diagnose" });
  assert.equal(result.requests.length, 0);
  assert.equal(result.writes.length, 0);
  assert.equal(JSON.stringify([...store]), before);
  assert.ok(result.logs.some(line => line.includes("mode=diagnose")));
  assert.ok(result.logs.some(line => line.includes("legacy-store=present")));
  assert.ok(result.logs.some(line => line.includes("cookie=present")));
  assert.equal(JSON.stringify([result.logs, result.notifications]).includes("SECRET"), false);
});

 test("diagnostic empty state and corrupt storage finish with sanitized output", async () => {
  const diagnostic = await execute({ argument: "diagnose" });
  assert.ok(diagnostic.logs.some(line => line.includes("diagnose")));
  const store = new Map([[STORE, "secret-corrupt-value"]]);
  const corrupt = await execute({ store });
  assert.ok(corrupt.logs.some(line => line.includes("ERROR")));
  assert.ok(corrupt.logs.some(line => line.includes("END")));
  assert.equal(store.get(STORE), "secret-corrupt-value");
  assert.equal(JSON.stringify([corrupt.logs, corrupt.notifications]).includes("secret-corrupt-value"), false);
});

 test("captures deduplicated accounts with allowed headers and supplied bodies", async () => {
  const store = await seed(["11", "22", "11"]);
  assert.equal(accounts(store).length, 2);
  assert.equal(accounts(store)[0].body, "mode=daily");
  assert.equal(accounts(store)[0].headers["content-length"], undefined);
  assert.equal(accounts(store)[0].headers["x-noise"], undefined);
});

 test("GET page refresh cannot downgrade a saved POST or overwrite its body", async () => {
  const store = new Map();
  const url = "https://wn4k.com/user/checkin.html";
  await execute({ store, request: request("11", { url, body: "csrf=ORIGINAL" }) });
  const capture = await execute({ store, request: request("11", { url, method: "GET", body: undefined,
    headers: { Cookie: "user_id=11; session=REFRESHED" } }) });
  assert.equal(accounts(store)[0].method, "POST");
  assert.equal(accounts(store)[0].body, "csrf=ORIGINAL");
  assert.equal(accounts(store)[0].headers.cookie, "user_id=11; session=REFRESHED");
  assert.equal(capture.requests.length, 0, "Capture must never perform a check-in");
});

 test("header-only member page enrolls the verified empty POST endpoint", async () => {
  for (const route of ["index.html", "info.html", "checkin.html"]) {
    const result = await execute({ request: request("11", {
      url: "https://wn4k.com/user/" + route, method: "GET", body: undefined }) });
    const account = accounts(result.store)[0];
    assert.ok(account);
    assert.equal(account.method, "POST");
    assert.equal(account.url, "https://wn4k.com/user/checkin.html");
    assert.equal(account.body, "");
    assert.equal(account.headers["x-requested-with"], "XMLHttpRequest");
    assert.equal(result.requests.length, 0);
  }
});

 test("old GET check-in records recover as POST without another button click", async () => {
  const store = await seed(["11", "22"]);
  const current = accounts(store);
  current.forEach(account => Object.assign(account, { url: "https://wn4k.com/user/checkin.html", method: "GET", body: "" }));
  store.set(STORE, JSON.stringify(current));
  const result = await execute({ store, responses: [response(), response()] });
  assert.equal(result.requests.length, 2);
  assert.ok(result.requests.every(req => req.method === "POST" && req.body === ""));
  assert.notEqual(result.requests[0].headers.cookie, result.requests[1].headers.cookie);
  assert.ok(accounts(store).every(account => account.lastDay === "2026-10-28"));
});

 test("HTTP 200 HTML, empty and unrecognized JSON do not count as check-in success", async () => {
  for (const fixture of [
    { body: '<html><title>SECRET_NAME</title><p>Account page SECRET</p></html>', format: "HTML" },
    { body: '{"data":{"code":1},"secret":"SECRET"}', format: "JSON_OBJECT" },
    { body: "", format: "EMPTY" }
  ]) {
    const store = await seed();
    const result = await execute({ store, responses: [response(200, fixture.body)] });
    assert.ok(result.logs.some(line => line.includes("format=" + fixture.format)));
    assert.equal(accounts(store)[0].lastDay, undefined);
    assert.equal(JSON.stringify([result.logs, result.notifications]).includes("SECRET"), false);
  }
});

 test("HTML login and challenge pages are distinguished without revealing their contents", async () => {
  for (const fixture of [
    { body: '<html><form><input name="user_pwd" value="SECRET"></form></html>', marker: "login" },
    { body: '<html><title>Just a moment...</title><div id="cf-chl-widget">SECRET</div></html>', marker: "challenge" }
  ]) {
    const store = await seed();
    const result = await execute({ store, responses: [response(200, fixture.body)] });
    assert.ok(result.logs.some(line => line.includes("marker=" + fixture.marker)));
    assert.equal(result.requests.length, 1);
    assert.equal(accounts(store)[0].lastDay, undefined);
    assert.equal(JSON.stringify(result.logs).includes("SECRET"), false);
  }
});

 test("BOM-prefixed JSON from the third callback parameter is parsed", async () => {
  const store = await seed();
  await execute({ store, responses: [response(200, '\uFEFF{"code":1,"msg":"Check-in successful"}')] });
  assert.equal(accounts(store)[0].lastDay, "2026-10-28");
});

 test("ignores login, foreign hosts, unrelated routes and secret request payloads", async () => {
  for (const req of [request("11", { url: "https://wn4k.com/user/login.html", body: "action=checkin&user_pwd=SECRET" }),
    request("11", { url: "https://wn4k.com/user/points.html" }),
    request("11", { url: "https://wn4k.com.evil.test/user/ajax_sign.html" }),
    request("11", { body: '{"password":"SECRET"}' }),
    request("11", { body: '{"profile":{"password":"SECRET"}}' }),
    request("11", { body: "user%5Fpwd=SECRET" }),
    request("11", { url: "https://wn4k.com/user/ajax_sign.html?password=SECRET" })]) {
    const result = await execute({ request: req });
    assert.equal(accounts(result.store).length, 0);
    assert.equal(result.requests.length, 0);
  }
});

 test("does not invent account identity or replay unknown/binary header-only bodies", async () => {
  for (const req of [request("11", { headers: { Cookie: "session=SECRET" } }),
    request("11", { body: undefined, bodyBytes: new ArrayBuffer(4) }),
    request("11", { body: undefined })]) {
    const result = await execute({ request: req });
    assert.equal(accounts(result.store).length, 0);
  }
});

 test("isolates accounts with native Cookie and redirect flags and skips completed days", async () => {
  const store = await seed(["11", "22"]);
  const first = await execute({ store, responses: [response(), response()] });
  assert.equal(first.requests.length, 2);
  assert.notEqual(first.requests[0].headers.cookie, first.requests[1].headers.cookie);
  for (const req of first.requests) {
    assert.equal(req["auto-cookie"], false);
    assert.equal(req["auto-redirect"], false);
    assert.equal(req.timeout, 10);
    assert.equal(req.opts, undefined, "QX request options must not be used in Surge");
  }
  assert.ok(accounts(store).every(account => account.lastDay === "2026-10-28"));
  const second = await execute({ store });
  assert.equal(second.requests.length, 0);
  assert.equal(store.get(LOCK), "");
});

 test("native errors and server errors retry at most three times with backoff", async () => {
  const store = await seed();
  const success = await execute({ store, responses: [response(500), { error: "timeout SECRET" }, response()] });
  assert.equal(success.requests.length, 3);
  assert.ok(success.waits.includes(1500));
  assert.ok(success.waits.includes(3000));
  assert.equal(text(success).includes("SECRET"), false);
  assert.equal(accounts(store)[0].lastDay, "2026-10-28");
  const failureStore = await seed();
  const failure = await execute({ store: failureStore, responses: [response(500), response(500), response(500), response()] });
  assert.equal(failure.requests.length, 3);
  assert.equal(accounts(failureStore)[0].lastDay, undefined);
});

 test("does not retry authentication, challenge or redirect responses", async () => {
  for (const res of [response(401), response(403), response(200, { code: 1004 }),
    response(200, { code: 0, msg: "Please solve captcha" }), response(302)]) {
    const store = await seed();
    const result = await execute({ store, responses: [res] });
    assert.equal(result.requests.length, 1);
    assert.equal(accounts(store)[0].lastDay, undefined);
  }
});

 test("failure messages, ambiguous JSON and invalid status never mark success", async () => {
  for (const res of [response(200, "<html>Welcome</html>"), response(200, { code: 0, msg: "Unknown" }),
    response(200, { code: 1, msg: "Check-in failed" }), response(200, { code: 0, msg: "已签到失败" }),
    { body: '{"code":1}', headers: {} }, response(0), response(700)]) {
    const store = await seed();
    await execute({ store, responses: [res] });
    assert.equal(accounts(store)[0].lastDay, undefined);
  }
});

 test("recognizes already-checked-in message and code 1001", async () => {
  for (const body of [{ code: 0, msg: "今天已经签到" }, { code: 1001 }, { code: "1001" }]) {
    const store = await seed();
    await execute({ store, responses: [response(200, body)] });
    assert.equal(accounts(store)[0].lastDay, "2026-10-28");
  }
});

 test("only affirmative already-signed-in messages mark the day complete", async () => {
  for (const msg of ["今日签到暂未开放", "今天签到活动尚未开始", "今日尚未签到", "今天未签到", "今天签到需要等待"]) {
    const store = await seed();
    await execute({ store, responses: [response(200, { code: 0, msg })] });
    assert.equal(accounts(store)[0].lastDay, undefined, "Must not mark success for: " + msg);
  }
  for (const body of [{ code: 0, msg: "今天已经签到" }, { code: 0, msg: "您今日已签到" },
    { code: 0, msg: "请勿重复签到" }, { code: 1001 }]) {
    const store = await seed();
    await execute({ store, responses: [response(200, body)] });
    assert.equal(accounts(store)[0].lastDay, "2026-10-28", "Must recognize already-signed-in response: " + JSON.stringify(body));
  }
});

 test("honors Retry-After without waiting beyond the task budget", async () => {
  const store = await seed();
  const long = await execute({ store, responses: [response(429, {}, { "Retry-After": "300" })] });
  assert.equal(long.requests.length, 1);
  assert.equal(long.waits.includes(300000), false);
  assert.equal(accounts(store)[0].lastDay, undefined);
  const shortStore = await seed();
  const short = await execute({ store: shortStore, responses: [response(429, {}, { "retry-after": "5" }), response()] });
  assert.ok(short.waits.includes(5000));
});

 test("member page refresh preserves endpoint-specific CSRF headers", async () => {
  const store = await seed();
  await execute({ store, request: request("11", { method: "GET", url: "https://wn4k.com/user/index/", body: undefined,
    headers: { Cookie: "user_id=11; session=NEW", "X-CSRF-Token": "WRONG" } }) });
  assert.equal(accounts(store)[0].headers.cookie, "user_id=11; session=NEW");
  assert.equal(accounts(store)[0].url, "https://wn4k.com/user/ajax_sign.html");
  assert.equal(accounts(store)[0].headers["x-csrf-token"], undefined);
  await execute({ store, request: request("22", { method: "GET", url: "https://wn4k.com/user/index/", body: undefined }) });
  assert.equal(accounts(store).length, 2);
  assert.equal(accounts(store)[1].method, "POST");
});

 test("known empty POST is captured without triggering a second sign-in", async () => {
  const result = await execute({ request: request("22", {
    url: "https://www.wn4k.com/user/checkin.html", body: undefined }) });
  assert.equal(accounts(result.store).length, 1);
  assert.equal(accounts(result.store)[0].method, "POST");
  assert.equal(accounts(result.store)[0].body, "");
  assert.equal(result.requests.length, 0);
  assert.ok(result.notifications.length > 0);
});

 test("GET repair never sends credentials to foreign hosts", async () => {
  const store = await seed();
  const current = accounts(store);
  Object.assign(current[0], { url: "https://wn4k.com.evil.test/user/checkin.html", method: "GET", body: "" });
  store.set(STORE, JSON.stringify(current));
  const result = await execute({ store });
  assert.equal(result.requests.length, 0);
  assert.equal(accounts(store)[0].method, "GET");
});

 test("concurrent credential refresh survives a successful callback", async () => {
  const store = await seed();
  await execute({ store, responses: [{ response: response(), update(data) {
    const current = accounts(data);
    current[0].headers.cookie = "user_id=11; session=ROTATED";
    data.set(STORE, JSON.stringify(current));
  } }] });
  assert.equal(accounts(store)[0].headers.cookie, "user_id=11; session=ROTATED");
  assert.equal(accounts(store)[0].lastDay, "2026-10-28");
});

 test("live task lock is preserved and corrupt storage is never overwritten", async () => {
  const store = await seed();
  store.set(LOCK, String(BASE + 60000));
  const busy = await execute({ store });
  assert.equal(busy.requests.length, 0);
  assert.equal(store.get(LOCK), String(BASE + 60000));
  const corrupt = new Map([[STORE, "{broken"]]);
  await execute({ store: corrupt, request: request() });
  assert.equal(corrupt.get(STORE), "{broken");
});

 test("tampered foreign endpoints and mismatched account cookies cannot be replayed", async () => {
  for (const tamper of [account => { account.url = "https://evil.test/sign"; },
    account => { account.headers.cookie = "user_id=22; session=OTHER"; }]) {
    const store = await seed();
    const current = accounts(store);
    tamper(current[0]);
    store.set(STORE, JSON.stringify(current));
    const result = await execute({ store });
    assert.equal(result.requests.length, 0);
  }
});

 test("a request spanning UTC+8 midnight is not credited to the following day", async () => {
  const store = await seed();
  await execute({ store, time: Date.parse("2026-10-28T15:59:59Z"), responses: [{ advance: 3000, response: response() }] });
  assert.equal(accounts(store)[0].lastDay, undefined);
});

 test("many slow failures defer pending accounts and prioritize them next time", async () => {
  const store = await seed(["11", "22", "33", "44"]);
  const result = await execute({ store, responses: Array.from({ length: 12 }, () => ({ never: true })) });
  assert.ok(result.time - BASE <= 100000);
  assert.ok(result.requests.length < 12);
  const neverAttempted = accounts(store).filter(account => !account.lastAttemptAt);
  assert.ok(neverAttempted.length > 0, "At least one account must be deferred");
  const next = await execute({ store, time: BASE + 15 * 60000, responses: [response(), response(), response(), response()] });
  assert.equal(next.requests[0].headers.cookie, neverAttempted[0].headers.cookie);
});

 test("alternate routing and explicit supplied bodies remain compatible", async () => {
  const routed = await execute({ request: request("11", { url: "https://www.wn4k.com/index.php?s=%2Fuser%2Fajax_sign.html" }) });
  assert.equal(accounts(routed.store).length, 1);
  const action = await execute({ request: request("11", { url: "https://wn4k.com/user/action.html", body: '{"action":"checkin","csrf":"LOCAL"}' }) });
  assert.equal(accounts(action.store).length, 1);
});

 test("missing native callback times out, terminates once and ignores a late success", async () => {
  const store = await seed();
  const result = await execute({ store, responses: [{ never: true }, { never: true }, { never: true }] });
  assert.equal(result.requests.length, 3);
  assert.equal(accounts(store)[0].lastDay, undefined);
  assert.ok(result.time - BASE < 100000);
  const before = JSON.stringify([...store]);
  const writeCount = result.writes.length;
  const notifyCount = result.notifications.length;
  await result.lateCallback();
  assert.equal(JSON.stringify([...store]), before);
  assert.equal(result.writes.length, writeCount);
  assert.equal(result.notifications.length, notifyCount);
  assert.equal(result.doneCount, 1);
});

 test("duplicate callback and callbacks after completion do not duplicate writes or completion", async () => {
  const store = await seed();
  const result = await execute({ store, responses: [{ response: response(), duplicate: true }] });
  assert.equal(result.requests.length, 1);
  assert.equal(accounts(store)[0].lastDay, "2026-10-28");
  const before = JSON.stringify([...store]);
  const writeCount = result.writes.length;
  const notifyCount = result.notifications.length;
  await result.lateCallback(0, response(200, { code: 1004 }));
  assert.equal(JSON.stringify([...store]), before);
  assert.equal(result.writes.length, writeCount);
  assert.equal(result.notifications.length, notifyCount);
  assert.equal(result.doneCount, 1);
});

 test("run watchdog releases its lock and ignores an in-flight late callback", async () => {
  const store = await seed();
  const result = await execute({ store, responses: [{ never: true }], fireWatchdogFirst: true });
  assert.equal(accounts(store)[0].lastDay, undefined);
  assert.equal(store.get(LOCK), "");
  const before = JSON.stringify([...store]);
  const writeCount = result.writes.length;
  const notifyCount = result.notifications.length;
  await result.lateCallback();
  assert.equal(JSON.stringify([...store]), before);
  assert.equal(result.writes.length, writeCount);
  assert.equal(result.notifications.length, notifyCount);
  assert.equal(result.doneCount, 1);
});

 test("runtime without clearTimeout finishes successful work and ignores remaining timers", async () => {
  const store = await seed();
  const result = await execute({ store, responses: [response()], noClearTimeout: true });
  assert.equal(accounts(store)[0].lastDay, "2026-10-28");
  assert.equal(store.get(LOCK), "");
  const before = JSON.stringify([...store]);
  const writeCount = result.writes.length;
  const notifyCount = result.notifications.length;
  const requestCount = result.requests.length;
  const fired = await result.drainTimers();
  assert.ok(fired >= 2, "HTTP guard and run watchdog should both still fire");
  assert.equal(JSON.stringify([...store]), before);
  assert.equal(result.writes.length, writeCount);
  assert.equal(result.notifications.length, notifyCount);
  assert.equal(result.requests.length, requestCount);
  assert.equal(result.doneCount, 1);
});

 test("runtime without clearTimeout handles missing callbacks and ignores all late work", async () => {
  const store = await seed();
  const result = await execute({ store, noClearTimeout: true,
    responses: [{ never: true }, { never: true }, { never: true }] });
  assert.equal(result.requests.length, 3);
  assert.equal(accounts(store)[0].lastDay, undefined);
  assert.equal(store.get(LOCK), "");
  const before = JSON.stringify([...store]);
  const writeCount = result.writes.length;
  const notifyCount = result.notifications.length;
  const requestCount = result.requests.length;
  assert.ok(await result.drainTimers() >= 1, "Run watchdog should still fire");
  for (let index = 0; index < requestCount; index++) await result.lateCallback(index);
  assert.equal(JSON.stringify([...store]), before);
  assert.equal(result.writes.length, writeCount);
  assert.equal(result.notifications.length, notifyCount);
  assert.equal(result.requests.length, requestCount);
  assert.equal(result.doneCount, 1);
});

 test("persistent-store failure stops safely without a network request", async () => {
  const capture = await execute({ request: request(), failWrite: true });
  assert.equal(accounts(capture.store).length, 0);
  assert.equal(capture.requests.length, 0);
  const store = await seed();
  const task = await execute({ store, failWrite: true });
  assert.equal(task.requests.length, 0);
  assert.equal(accounts(store)[0].lastDay, undefined);
});

 test("module matches member routes while excluding login and unrelated requests", async () => {
  const config = fs.readFileSync(path.join(__dirname, "../wn4k.sgmodule"), "utf8");
  const capture = config.split(/\r?\n/).find(line => /type=http-request/.test(line));
  assert.ok(capture, "Must provide request capture");
  assert.match(capture, /requires-body=false/);
  const match = capture.match(/\bpattern=([^,]+)/);
  assert.ok(match, "Must include a URL pattern");
  const regex = new RegExp(match[1].trim());
  for (const url of ["https://wn4k.com/user/index/", "https://wn4k.com/user/info.html",
    "https://wn4k.com/user/checkin.html", "https://www.wn4k.com/index.php/user/checkin.html",
    "https://wn4k.com/index.php?s=/user/checkin.html", "https://wn4k.com/index.php?s=%2Fuser%2Fcheckin.html"]) {
    assert.ok(regex.test(url), "Rule did not match " + url);
  }
  for (const url of ["https://wn4k.com.evil.test/user/checkin.html", "https://wn4k.com/user/login.html",
    "https://wn4k.com/user/logout.html", "https://wn4k.com/user/action.html", "https://wn4k.com/user/index-malicious.html"]) {
    assert.equal(regex.test(url), false, "Rule should exclude " + url);
  }
});

 test("module uses 09:14 cron, manual and local diagnostic entries with the same script", async () => {
  const config = fs.readFileSync(path.join(__dirname, "../wn4k.sgmodule"), "utf8");
  const scripts = config.split(/\r?\n/).filter(line => /\btype=(cron|generic|http-request)/.test(line));
  const cron = scripts.find(line => /type=cron/.test(line));
  assert.ok(cron);
  assert.match(cron, /cronexp="14 9 \* \* \*"/);
  assert.match(cron, /wake-system=true(?:,|$)/);
  assert.match(cron, /timeout=120(?:,|$)/);
  assert.ok(scripts.some(line => /type=generic/.test(line) && !/argument=diagnose/.test(line)));
  assert.ok(scripts.some(line => /type=generic/.test(line) && /argument=diagnose/.test(line)));
  assert.ok(scripts.every(line => /script-path=https:\/\/raw\.githubusercontent\.com\/[^/]+\/surge-modules\/main\/wn4k\/wn4k_checkin\.js(?:,|$)/.test(line)));
  assert.match(config, /\[MITM\][\s\S]*hostname\s*=\s*%APPEND%\s*wn4k\.com,\s*www\.wn4k\.com/);
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log("PASS " + name); }
    catch (error) { failed++; console.error("FAIL " + name + "\n" + error.stack); }
  }
  console.log("\n" + (tests.length - failed) + "/" + tests.length + " tests passed (mock Surge; no real account requests).");
  if (failed) process.exitCode = 1;
})().catch(error => { console.error(error); process.exitCode = 1; });
