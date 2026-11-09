'use strict';
// Native Surge runtime boundaries. Uses the complete production script, a fake
// clock and controlled callbacks; no real network or Quantumult X globals.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../xianhua/xianhua_task.js'), 'utf8');
const TOKENS = { wx: 'fixture-runtime-wx', xh: 'fixture-runtime-xh', h5: 'fixture-runtime-h5' };
const WX = 'https://wxforum.sanguosha.cn/api';
const XH = 'https://api-xh.sanguosha.cn';
const URLS = {
  shop: WX + '/shop/taskList', forever: WX + '/shop/taskForever', list: XH + '/task/sgxh-task/taskList',
  open: WX + '/openMiniApp', sign: WX + '/user/signIn', topics: WX + '/topics?page=1&category_id=1',
  heat: XH + '/task/heatValue/progress', reward: XH + '/task/sgxh-task/getReward'
};
const LISTS = [URLS.shop, URLS.forever, URLS.list];
const clone = value => JSON.parse(JSON.stringify(value));
const drain = () => new Promise(resolve => setImmediate(resolve));
const okBody = data => JSON.stringify({ code: 1000, success: true, data });
let scenarios = 0;

class FakeClock {
  constructor() { this.start = 1800000000000; this.now = this.start; this.nextId = 0; this.timers = new Map(); }
  setTimeout(fn, delay) {
    const id = ++this.nextId;
    this.timers.set(id, { fn, due: this.now + Number(delay) });
    return id;
  }
  clearTimeout(id) { this.timers.delete(id); }
  ordered() { return [...this.timers].sort((a, b) => a[1].due - b[1].due || a[0] - b[0]); }
  async advanceTo(target) {
    assert(target >= this.now, 'fake time must move forward');
    for (let steps = 0; ; steps++) {
      assert(steps < 1000, 'unexpected infinite timer loop');
      const next = this.ordered()[0];
      if (!next || next[1].due > target) break;
      this.now = Math.max(this.now, next[1].due);
      this.timers.delete(next[0]);
      next[1].fn();
      await drain();
    }
    this.now = target;
    await drain();
  }
  async advanceBy(ms) { await this.advanceTo(this.now + ms); }
  elapseWithoutDelivery(ms) { this.now += ms; }
  async deliverBudgetGuard() {
    // Simulates a delayed event loop delivering the documented hard run guard
    // before outstanding HTTP callbacks; no source internals are accessed.
    const entry = this.ordered().find(([, timer]) => timer.due === this.start + 116000);
    assert(entry, '116-second completion guard must be scheduled');
    assert(this.now >= entry[1].due);
    this.timers.delete(entry[0]);
    entry[1].fn();
    await drain();
  }
}

function backend(options = {}) {
  const state = {
    errors: [], rewardCount: 0,
    tasks: [1001, 1003, 1004, 1006, 3028, 3014].map((id, i) => ({
      taskId: id, taskType: i < 3 ? 1 : i < 5 ? 2 : 3,
      taskDesc: ['今日点赞10次', '今日浏览帖子3次', '今日分享帖子1次', '本周查看一次热力竹', '本周查看一次每周战报', '领取一次热力竹奖励'][i],
      currentProgressValue: 1, targetProgressValue: 1,
      progressStatus: options.claimable && i === 0 ? 1 : 2, taskProgressId: 900001 + i
    }))
  };
  state.reply = call => {
    let data;
    if (call.method === 'GET' && [URLS.shop, URLS.forever, URLS.topics].includes(call.options.url)) data = [];
    else if (call.method === 'GET' && call.options.url === URLS.list) data = clone(state.tasks);
    else if (call.method === 'GET' && call.options.url === URLS.heat) data = { heatValue: 0, currentRewardId: null, rewards: [] };
    else if (call.method === 'POST' && [URLS.open, URLS.sign].includes(call.options.url)) data = {};
    else if (call.method === 'POST' && call.options.url === URLS.reward) {
      const task = state.tasks.find(item => item.taskProgressId === JSON.parse(call.options.body).taskProgressId);
      if (!task || task.progressStatus !== 1) {
        state.errors.push('unexpected or duplicate reward submission');
        return { error: null, response: { status: 409 }, body: okBody({}) };
      }
      state.rewardCount++;
      task.progressStatus = 2;
      data = {};
    } else {
      state.errors.push('unexpected endpoint or method');
      return { error: null, response: { status: 404 }, body: '' };
    }
    // response.body is intentionally invalid: Surge supplies the real body as
    // callback argument three and does not supply QX's response.statusCode.
    return { error: null, response: { status: 200, body: 'WRONG RESPONSE BODY' }, body: okBody(data) };
  };
  return state;
}

async function execute(options = {}) {
  const clock = new FakeClock(), calls = [], logs = [], notices = [], done = [];
  const server = options.server || backend();
  const store = options.store || { sgxh_token_wx: TOKENS.wx, sgxh_token_xh: TOKENS.xh, sgxh_token_h5: TOKENS.h5 };
  const sandbox = {
    $persistentStore: {
      read: key => { if (options.readError) throw Error(TOKENS.xh); return store[key] || ''; },
      write: () => { throw Error('task runtime must not write credentials'); }
    },
    $httpClient: Object.fromEntries(['get', 'post', 'put'].map(method => [method, (request, callback) => {
      const call = { method: method.toUpperCase(), options: clone(request), callback, at: clock.now - clock.start };
      calls.push(call);
      if (options.throwOn && options.throwOn(call)) throw Error('request failed ' + TOKENS.xh);
      if (options.autoReply && !(options.holdOn && options.holdOn(call))) {
        queueMicrotask(() => {
          const reply = options.reply ? options.reply(call, server) : server.reply(call);
          callback(reply.error, reply.response, reply.body);
          if (options.duplicate) callback(reply.error, reply.response, reply.body);
        });
      }
      // A native HTTP invocation returns no Promise.
    }])),
    $notification: { post: (...args) => { if (options.notifyError) throw Error(TOKENS.wx); notices.push(args); } },
    $done: value => done.push(value),
    console: Object.fromEntries(['log', 'warn', 'error'].map(name => [name, (...args) => logs.push(args.join(' '))])),
    Date: class extends Date { static now() { return clock.now; } },
    setTimeout: (fn, delay) => clock.setTimeout(fn, delay),
    clearTimeout: id => clock.clearTimeout(id),
    encodeURIComponent, decodeURIComponent
  };
  if (Object.prototype.hasOwnProperty.call(options, 'argument')) sandbox.$argument = options.argument;
  // No $task, $prefs, $notify, $environment, require or network primitives.
  vm.runInNewContext(source, sandbox, { filename: 'xianhua_task.js', timeout: 1000 });
  await drain();
  return {
    clock, calls, logs, notices, done, server,
    respond(call, reply = server.reply(call)) { call.callback(reply.error, reply.response, reply.body); },
    async respondInitialLists() {
      assert.deepEqual(calls.map(call => call.options.url), LISTS);
      for (const call of [...calls]) this.respond(call);
      await drain();
    },
    async complete() {
      for (let step = 0; !done.length; step++) {
        assert(step < 100, 'workflow did not complete');
        const next = clock.ordered()[0];
        assert(next, 'workflow stalled with no timer or response');
        await clock.advanceTo(Math.max(clock.now, next[1].due));
      }
      await drain();
    },
    verify(expectNotice = true) {
      assert.equal(done.length, 1, 'exactly one $done');
      assert.equal(done[0], undefined, 'task must finish with $done()');
      assert.equal(notices.length, expectNotice ? 1 : 0, 'exactly one final notification when available');
      assert.equal(server.errors.length, 0, server.errors.join('; '));
      const text = JSON.stringify([logs, notices]);
      for (const value of Object.values(TOKENS)) assert(!text.includes(value), 'credential leaked');
    }
  };
}

async function test(name, fn) {
  try { await fn(); scenarios++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}

(async () => {
  await test('complete native workflow uses response.status and callback body', async () => {
    const result = await execute({ autoReply: true }); await result.complete(); result.verify();
    assert(!result.logs.some(text => text.includes('运行异常')));
    assert(result.notices[0][2].includes('签到：成功'));
    assert(result.notices[0][2].includes('今日点赞10次：已领取'));
    assert(result.notices[0][1].includes('已复查'));
    assert(result.calls.some(call => call.method === 'POST'));
    for (const call of result.calls) {
      assert(Number.isInteger(call.options.timeout) && call.options.timeout >= 1 && call.options.timeout <= 6, 'timeout must be seconds');
      assert.equal(call.options['auto-cookie'], false);
      assert.equal(call.options['auto-redirect'], false);
      assert(!('opts' in call.options));
      assert(!('method' in call.options), 'native method is selected by $httpClient method');
    }
    assert.equal(result.clock.timers.size, 0);
  });

  await test('missing or H5-only credential makes no request', async () => {
    for (const store of [{}, { sgxh_token_h5: TOKENS.h5 }]) {
      const result = await execute({ store }); result.verify();
      assert.equal(result.calls.length, 0); assert.equal(result.clock.timers.size, 0);
      assert.equal(result.notices[0][1], '未检测到凭据');
    }
  });

  for (const argument of ['mode=list', 'list', '#mode=list']) {
    await test('read-only argument ' + argument + ' makes exactly three GETs', async () => {
      const result = await execute({ argument, autoReply: true }); result.verify();
      assert.deepEqual(result.calls.map(call => call.options.url), LISTS);
      assert(result.calls.every(call => call.method === 'GET' && !('body' in call.options)));
      assert.equal(result.notices[0][1], '任务列表（只查询）');
      assert.equal(result.clock.timers.size, 0);
    });
  }

  await test('invalid and malformed arguments fail before any HTTP request', async () => {
    for (const argument of ['mode=%zz', 'mode=list&mode=run', '#mode=list&other=1', 'mode=RUN', 'diagnose', '{"mode":"list"}', { mode: 'list' }, 123]) {
      const result = await execute({ argument }); result.verify();
      assert.equal(result.calls.length, 0); assert.equal(result.notices[0][1], '脚本参数无效');
    }
  });

  await test('synchronous native GET exceptions resolve list mode without leaking errors', async () => {
    const result = await execute({ argument: 'list', throwOn: () => true }); result.verify();
    assert.equal(result.calls.length, 3);
    assert(result.logs.some(text => text.includes('查询失败')));
    assert(!result.logs.some(text => text.includes('运行异常')));
  });

  await test('native network errors cannot become successful list responses', async () => {
    const result = await execute({ argument: 'list' });
    for (const call of result.calls) result.respond(call, { error: 'network error ' + TOKENS.xh, response: { status: 200 }, body: okBody(result.server.tasks) });
    await drain(); result.verify();
    assert(!result.notices[0][2].includes('今日点赞10次'));
    assert(result.logs.filter(text => text.includes('查询失败')).length >= 3);
  });

  await test('single list request timeout ignores late and duplicate callbacks', async () => {
    const result = await execute({ argument: 'list' });
    result.respond(result.calls[0]); result.respond(result.calls[1]); await drain();
    await result.clock.advanceBy(3000); result.verify();
    const count = result.calls.length, notice = JSON.stringify(result.notices);
    result.respond(result.calls[2]); result.respond(result.calls[2]); await drain();
    result.verify(); assert.equal(result.calls.length, count); assert.equal(JSON.stringify(result.notices), notice);
  });

  await test('sign-in POST timeout never resubmits after a late callback', async () => {
    const result = await execute({ autoReply: true, holdOn: call => call.options.url === URLS.sign });
    await result.complete(); result.verify();
    const signCalls = result.calls.filter(call => call.options.url === URLS.sign);
    assert.equal(signCalls.length, 1);
    assert(result.notices[0][2].includes('签到：失败'));
    const count = result.calls.length, notice = JSON.stringify(result.notices);
    result.respond(signCalls[0]); result.respond(signCalls[0]); await drain();
    await result.clock.advanceBy(120000);
    result.verify(); assert.equal(result.calls.length, count); assert.equal(JSON.stringify(result.notices), notice);
  });

  await test('duplicate callbacks cannot duplicate sign-in or reward submissions', async () => {
    const server = backend({ claimable: true });
    const result = await execute({ server, autoReply: true, duplicate: true }); await result.complete(); result.verify();
    assert.equal(server.rewardCount, 1);
    for (const url of [URLS.open, URLS.sign, URLS.reward]) assert.equal(result.calls.filter(call => call.options.url === url).length, 1);
    assert(result.notices[0][2].includes('今日点赞10次：已领取'));
  });

  await test('synchronous sign-in failure does not retry or abort the entire run', async () => {
    const result = await execute({ autoReply: true, throwOn: call => call.options.url === URLS.sign });
    await result.complete(); result.verify();
    assert.equal(result.calls.filter(call => call.options.url === URLS.sign).length, 1);
    assert(result.notices[0][2].includes('签到：失败'));
    assert(!result.logs.some(text => text.includes('运行异常')));
  });

  await test('QX-only statusCode and malformed JSON are rejected by native runtime', async () => {
    for (const invalid of [
      { error: null, response: { statusCode: 200 }, body: okBody(backend().tasks) },
      { error: null, response: { status: 200 }, body: '<html>verification required</html>' }
    ]) {
      const result = await execute({ argument: 'list' });
      for (const call of result.calls) result.respond(call, invalid);
      await drain(); result.verify();
      assert(!result.notices[0][2].includes('今日点赞10次'));
      assert(result.logs.some(text => text.includes('查询失败')));
    }
  });

  await test('106-second deadline prevents every subsequent HTTP dispatch', async () => {
    const result = await execute();
    result.clock.elapseWithoutDelivery(106000);
    await result.respondInitialLists();
    await result.complete(); result.verify();
    assert.equal(result.calls.length, 3, 'no task actions or further queries after request budget expires');
    assert(result.calls.every(call => call.at < 106000));
    assert(result.clock.now - result.clock.start < 116000);
    assert(result.logs.some(text => text.includes('达到本轮时间上限')));
  });

  await test('last millisecond of request budget clamps native timeout and stops dispatch', async () => {
    const result = await execute();
    result.clock.elapseWithoutDelivery(105999);
    await result.respondInitialLists();
    assert.deepEqual(result.calls.slice(3).map(call => call.options.url), [URLS.open, URLS.sign]);
    for (const call of result.calls.slice(3)) assert.equal(call.options.timeout, 1);
    await result.complete(); result.verify();
    assert.equal(result.calls.length, 5);
    assert(result.calls.every(call => call.at < 106000));
    for (const call of result.calls.slice(3)) result.respond(call);
    await drain(); result.verify(); assert.equal(result.calls.length, 5);
  });

  await test('116-second hard guard finishes once and suppresses later HTTP dispatch', async () => {
    const result = await execute();
    result.clock.elapseWithoutDelivery(116000);
    await result.clock.deliverBudgetGuard(); result.verify();
    assert.equal(result.notices[0][1], '运行达到时间上限');
    const notice = JSON.stringify(result.notices);
    for (const call of [...result.calls]) { result.respond(call); result.respond(call); }
    await drain(); await result.clock.advanceBy(120000);
    result.verify(); assert.equal(result.calls.length, 3); assert.equal(JSON.stringify(result.notices), notice);
    assert.equal(result.clock.timers.size, 0);
  });

  await test('notification exception still completes the full workflow exactly once', async () => {
    const result = await execute({ autoReply: true, notifyError: true }); await result.complete(); result.verify(false);
    assert(result.logs.some(text => text.includes('系统通知发送失败')));
    assert.equal(result.clock.timers.size, 0);
  });

  await test('persistent-store exception finishes without exposing credentials or dispatching', async () => {
    const result = await execute({ readError: true }); result.verify();
    assert.equal(result.calls.length, 0); assert.equal(result.notices[0][1], '脚本运行异常');
    assert.equal(result.clock.timers.size, 0);
  });

  console.log('PASS Surge native runtime: ' + scenarios + ' scenarios');
})().catch(error => { console.error(error.stack); process.exitCode = 1; });
