'use strict';
// Native Surge callback and lifecycle checks; fake timers and no real network.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../xianhua/xianhua_test.js'), 'utf8');
const TOKEN = 'fixture-diagnostic-token';
let scenarios = 0;

function test(name, fn) {
  try { fn(); scenarios++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}

function execute(options = {}) {
  const calls = [], logs = [], notices = [], done = [], timers = new Map();
  const store = options.store || { sgxh_token_xh: TOKEN };
  let callback, timerId = 0;
  vm.runInNewContext(source, {
    $persistentStore: {
      read: key => { if (options.readError) throw Error(TOKEN); return store[key] || ''; },
      write: () => assert.fail('diagnosis may not write any local key')
    },
    $httpClient: {
      get: (request, next) => {
        calls.push(request);
        if (options.getError) throw Error(TOKEN);
        callback = next;
      },
      post: () => assert.fail('diagnosis may not POST'),
      put: () => assert.fail('diagnosis may not PUT')
    },
    $notification: { post: (...args) => { if (options.notifyError) throw Error(TOKEN); notices.push(args); } },
    $done: value => done.push(value),
    console: { log: (...args) => logs.push(args.join(' ')) },
    setTimeout: (fn, ms) => { const id = ++timerId; timers.set(id, { fn, ms }); return id; },
    clearTimeout: id => timers.delete(id)
  }, { filename: 'xianhua_test.js', timeout: 1000 });
  return {
    calls, logs, notices, done, timers,
    respond(error, response, body) { assert.equal(typeof callback, 'function'); callback(error, response, body); },
    expire() { for (const [id, timer] of [...timers]) { timers.delete(id); timer.fn(); } },
    verify(expectNotice = true) {
      assert.equal(done.length, 1, 'one completion only');
      assert.equal(done[0], undefined, 'generic task must call $done()');
      assert.equal(timers.size, 0, 'completed task must clear watchdog');
      assert.equal(notices.length, expectNotice ? 1 : 0);
      assert(!JSON.stringify([logs, notices]).includes(TOKEN), 'credential must not enter logs or notifications');
      assert(calls.length <= 1, 'no automatic retry');
    }
  };
}

function body(data, extra = {}) { return JSON.stringify({ code: 1000, success: true, data, ...extra }); }
const tasks = [
  { taskId: 1001, taskType: 1, taskDesc: '<b>今日点赞10次</b>', currentProgressValue: 10, targetProgressValue: 10, progressStatus: 2 },
  { taskId: 1006, taskType: 2, taskDesc: '本周查看热力竹', currentProgressValue: 1, targetProgressValue: 1, progressStatus: 1 },
  { taskId: 3014, taskType: 3, taskDesc: '首次领取热力竹', currentProgressValue: 0, targetProgressValue: 1, progressStatus: -1 }
];

test('native status and callback body produce task statuses', () => {
  const result = execute();
  assert.equal(result.calls.length, 1);
  const request = result.calls[0];
  assert.equal(request.url, 'https://api-xh.sanguosha.cn/task/sgxh-task/taskList');
  assert.equal(request.timeout, 10, 'HTTP timeout is in seconds');
  assert.equal(request['auto-cookie'], false);
  assert.equal(request['auto-redirect'], false);
  assert(!('opts' in request));
  assert.equal(request.headers.authorization, TOKEN);
  assert.equal(request.headers['app-system'], 'weixin');
  assert.equal([...result.timers.values()][0].ms, 12000);
  result.respond(null, { status: 200, body: 'must be ignored' }, body(tasks));
  result.verify();
  const text = result.notices[0][2];
  assert(text.includes('[每日] 今日点赞10次: 10/10 | 已领取'));
  assert(text.includes('[每周] 本周查看热力竹: 1/1 | 待领取'));
  assert(text.includes('[一次性/累计] 首次领取热力竹: 0/1 | 未完成'));
});

test('empty tasks are a successful empty list', () => {
  const result = execute(); result.respond(null, { status: 200 }, body([])); result.verify();
  assert(result.notices[0][2].includes('服务器未返回任务'));
});

test('missing credential performs no network call', () => {
  const result = execute({ store: {} }); result.verify();
  assert.equal(result.calls.length, 0); assert.equal(result.notices[0][1], '缺少凭据');
});

test('H5 credential is never used for the WeChat task list', () => {
  const result = execute({ store: { sgxh_token_h5: TOKEN } }); result.verify();
  assert.equal(result.calls.length, 0);
});

test('legacy and wxforum credentials remain compatible', () => {
  for (const key of ['sgxh_token_wx', 'sgxh_token']) {
    const result = execute({ store: { [key]: TOKEN } });
    assert.equal(result.calls[0].headers.authorization, TOKEN);
    result.respond(null, { status: 200 }, body([])); result.verify();
  }
});

test('api-xh credential has priority over both fallbacks', () => {
  const result = execute({ store: { sgxh_token_xh: TOKEN, sgxh_token_wx: 'fixture-other-wx', sgxh_token: 'fixture-other-legacy' } });
  assert.equal(result.calls[0].headers.authorization, TOKEN);
  result.respond(null, { status: 200 }, body([])); result.verify();
});

for (const [name, response, data] of [
  ['unauthorized', { status: 401 }, body(tasks)],
  ['server failure', { status: 500 }, body(tasks)],
  ['missing response', undefined, body(tasks)],
  ['QX-only status is invalid', { statusCode: 200 }, body(tasks)],
  ['non-JSON body', { status: 200 }, '<html>verification page</html>'],
  ['failed business result', { status: 200 }, body(tasks, { success: false })],
  ['incorrect business code', { status: 200 }, body(tasks, { code: 20000 })],
  ['invalid task collection', { status: 200 }, body({ tasks })]
]) test('rejects ' + name, () => {
  const result = execute(); result.respond(null, response, data); result.verify();
  assert.equal(result.notices[0][1], '查询失败');
});

test('network error is sanitized and does not retry', () => {
  const result = execute(); result.respond('failed https://example.test/?token=' + TOKEN, { status: 200 }, body(tasks)); result.verify();
  assert.equal(result.notices[0][1], '网络请求失败');
});

test('timeout finishes once and ignores late response', () => {
  const result = execute(); result.expire(); result.verify();
  assert.equal(result.notices[0][1], '查询超时');
  result.respond(null, { status: 200 }, body(tasks)); result.verify();
});

test('duplicate callback cannot duplicate notification or completion', () => {
  const result = execute(); result.respond(null, { status: 200 }, body(tasks));
  result.respond(Error(TOKEN), { status: 500 }, ''); result.expire(); result.verify();
});

test('synchronous HTTP exception is sanitized and clears timer', () => {
  const result = execute({ getError: true }); result.verify();
  assert.equal(result.notices[0][1], '诊断未完成');
});

test('storage read exception is sanitized and makes no request', () => {
  const result = execute({ readError: true }); result.verify(); assert.equal(result.calls.length, 0);
});

test('notification failure still finishes once', () => {
  const result = execute({ notifyError: true }); result.respond(null, { status: 200 }, body([])); result.verify(false);
});

test('null task rows are skipped and missing progress is explicit', () => {
  const result = execute();
  result.respond(null, { status: 200 }, body([null, 17, 'bad', { taskName: '测试任务' }])); result.verify();
  assert(result.notices[0][2].includes('测试任务: ?/? | 状态未知'));
});

test('server-echoed authorization and bearer payload are redacted', () => {
  const result = execute({ store: { sgxh_token_xh: 'Bearer ' + TOKEN } });
  result.respond(null, { status: 200 }, body([{ taskName: TOKEN + ' Bearer ' + TOKEN + ' https://example.test/?token=' + TOKEN, currentProgressValue: TOKEN, targetProgressValue: 1 }])); result.verify();
});

console.log('PASS Surge read-only diagnostic: ' + scenarios + ' scenarios');
