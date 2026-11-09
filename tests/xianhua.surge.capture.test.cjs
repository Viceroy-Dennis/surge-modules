'use strict';
// Offline checks using only fictitious credentials; no network APIs are exposed.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../xianhua/xianhua_capture.js'), 'utf8');
const NOW = 1800000000000;
const SECRET = { wx: 'fixture-wx-token', xh: 'fixture-xh-token', h5: 'fixture-h5-token', cookie: 'fixture-cookie-token', body: 'fixture-password' };
let scenarios = 0;

function test(name, fn) {
  try { fn(); scenarios++; }
  catch (error) { error.message = name + ': ' + error.message; throw error; }
}

function execute(request, options = {}) {
  const store = { ...(options.initial || {}) }, writes = [], logs = [], notices = [], done = [];
  const before = request && { url: request.url, method: request.method, headers: JSON.stringify(request.headers) };
  const sandbox = {
    $persistentStore: {
      read: key => { if (options.readFailure) throw Error(SECRET.wx); return store[key] || ''; },
      write: (value, key) => {
        writes.push({ key, value });
        if (key === options.throwKey) throw Error(SECRET.wx);
        if (key === options.failKey) return false;
        store[key] = value;
        return true;
      }
    },
    $notification: { post: (...args) => { if (options.notifyFailure) throw Error(SECRET.wx); notices.push(args); } },
    $done: value => done.push(value),
    console: { log: (...args) => logs.push(args.join(' ')) },
    Date: { now: () => options.now === undefined ? NOW : options.now },
    decodeURIComponent
  };
  if (request !== undefined) sandbox.$request = request;
  vm.runInNewContext(source, sandbox, { filename: 'xianhua_capture.js', timeout: 1000 });
  assert.equal(done.length, 1, 'one completion');
  assert.equal(JSON.stringify(done[0]), '{}', 'request must pass through unchanged');
  if (request) assert.deepEqual({ url: request.url, method: request.method, headers: JSON.stringify(request.headers) }, before);
  const text = JSON.stringify([logs, notices]);
  for (const value of Object.values(SECRET)) assert(!text.includes(value), 'credentials must not enter logs or notifications');
  assert(writes.every(write => !write.key.startsWith('sgxh_confirmed_reward')), 'no reward probing');
  return { store, writes, logs, notices, done };
}

function request(host, headers, suffix = '/api/profile', method = 'GET') {
  return { url: 'https://' + host + '.sanguosha.cn' + suffix, method, headers };
}
const wx = () => request('wxforum', { Authorization: SECRET.wx });

test('wxforum capture never reads body', () => {
  const input = wx();
  Object.defineProperty(input, 'body', { get() { throw Error('body must not be read'); } });
  const result = execute(input);
  assert.equal(result.store.sgxh_token_wx, SECRET.wx);
  assert.equal(result.store.sgxh_token, SECRET.wx);
  assert.equal(result.store.sgxh_capture_time, String(NOW));
  assert.equal(result.notices.length, 1);
  assert.equal(result.notices[0][1], '登录凭据已更新');
});

test('api-xh preserves H5 and sanitizes headers', () => {
  const result = execute(request('api-xh', {
    Authorization: SECRET.xh, 'App-System': 'weixin', Host: 'ignored', 'Content-Length': '99',
    'Accept-Encoding': 'gzip', 'App-Code': '[object Null]', Bad: null, NullValue: 'null', Newline: 'one\r\ntwo', 'client-id': 'fixture-client'
  }), { initial: { sgxh_token_h5: SECRET.h5 } });
  assert.equal(result.store.sgxh_token_xh, SECRET.xh);
  assert.equal(result.store.sgxh_token_h5, SECRET.h5);
  const headers = JSON.parse(result.store.sgxh_headers_xh);
  assert.deepEqual(headers, { authorization: SECRET.xh, 'app-system': 'weixin', 'client-id': 'fixture-client' });
});

test('H5 header capture cannot overwrite either WeChat or legacy channel', () => {
  const initial = { sgxh_token_xh: SECRET.xh, sgxh_token_wx: SECRET.wx, sgxh_token: SECRET.wx, sgxh_headers: 'legacy', sgxh_headers_xh: 'wechat' };
  const result = execute(request('api-xh', { Authorization: 'Bearer ' + SECRET.h5, 'App-System': 'h5' }, '/task/heatValue/progress'), { initial });
  assert.equal(result.store.sgxh_token_h5, 'Bearer ' + SECRET.h5);
  for (const key of Object.keys(initial)) assert.equal(result.store[key], initial[key]);
  assert(!result.writes.some(write => ['sgxh_token', 'sgxh_headers', 'sgxh_token_xh', 'sgxh_headers_xh', 'sgxh_token_wx'].includes(write.key)));
});

test('official H5 GET entry captures query credential only', () => {
  const result = execute(request('xh', {}, '/h5/energy?token=' + SECRET.h5 + '&c=2'), { initial: { sgxh_token_xh: SECRET.xh } });
  assert.equal(result.store.sgxh_token_h5, SECRET.h5);
  assert.equal(result.store.sgxh_token_xh, SECRET.xh);
  assert(!result.writes.some(write => write.key === 'sgxh_token'));
});

test('query token accepts percent encoded base64 punctuation', () => {
  const token = 'fixture+encoded/token==';
  const result = execute(request('xh', {}, '/h5/energy?token=' + encodeURIComponent(token)));
  assert.equal(result.store.sgxh_token_h5, token);
});

for (const url of [
  'https://evil.example/h5/energy?token=' + SECRET.h5,
  'https://evil.xh.sanguosha.cn/h5/energy?token=' + SECRET.h5,
  'https://xh.sanguosha.cn.evil/h5/energy?token=' + SECRET.h5,
  'https://evil@xh.sanguosha.cn/h5/energy?token=' + SECRET.h5,
  'https://xh.sanguosha.cn:443/h5/energy?token=' + SECRET.h5
]) test('rejects unsupported authority ' + url.split('?')[0], () => {
  assert.equal(execute({ url, headers: { Authorization: SECRET.wx } }).writes.length, 0);
});

test('query credentials from other paths and methods are ignored', () => {
  for (const [suffix, method] of [['/h5/other?token=' + SECRET.h5, 'GET'], ['/h5/energy?token=' + SECRET.h5, 'POST']]) {
    assert.equal(execute(request('xh', {}, suffix, method)).writes.length, 0);
  }
});

test('query token from ordinary API request is ignored', () => {
  assert.equal(execute(request('wxforum', {}, '/api/profile?token=' + SECRET.wx)).writes.length, 0);
});

test('malformed and duplicate query tokens do not save', () => {
  for (const query of ['token=%zz', 'token=' + SECRET.h5 + '&token=' + SECRET.h5, 'token=short', 'token=null', 'token=%20' + SECRET.h5]) {
    assert.equal(execute(request('xh', {}, '/h5/energy?' + query)).writes.length, 0);
  }
});

test('Cookie merge preserves existing values and supports token fallback', () => {
  const result = execute(request('wxforum', { Cookie: 'one=new; token=' + SECRET.cookie + '; two=' }), { initial: { sgxh_cookie: 'one=old; two=keep' } });
  assert.equal(result.store.sgxh_token_wx, SECRET.cookie);
  assert.equal(result.store.sgxh_cookie, 'one=new; two=keep; token=' + SECRET.cookie);
});

test('invalid header credentials do not save', () => {
  for (const token of ['null', 'undefined', '[object Null]', 'bad\nfixture-token', 'short']) {
    assert.equal(execute(request('wxforum', { Authorization: token })).writes.length, 0);
  }
});

test('same token refreshes headers without notification', () => {
  const result = execute(wx(), { initial: { sgxh_token_wx: SECRET.wx, sgxh_headers_wx: '{}' } });
  assert.equal(result.notices.length, 0);
  assert.equal(JSON.parse(result.store.sgxh_headers_wx).authorization, SECRET.wx);
});

test('notifications are throttled for eight seconds', () => {
  const result = execute(wx(), { initial: { sgxh_notify_ts: String(NOW - 7999) } });
  assert.equal(result.notices.length, 0);
  assert.equal(result.store.sgxh_token_wx, SECRET.wx);
});

test('notification is allowed at eight second boundary', () => {
  assert.equal(execute(wx(), { initial: { sgxh_notify_ts: String(NOW - 8000) } }).notices.length, 1);
});

test('future or invalid notification timestamps do not disable notifications', () => {
  for (const timestamp of [String(NOW + 10000), 'invalid']) {
    assert.equal(execute(wx(), { initial: { sgxh_notify_ts: timestamp } }).notices.length, 1);
  }
});

for (const fault of ['failKey', 'throwKey']) test('storage ' + fault + ' restores prior channel and reports failure', () => {
  const initial = { sgxh_token_wx: 'old-token', sgxh_headers_wx: 'old-headers', sgxh_token: 'old-legacy', sgxh_headers: 'old-legacy-headers' };
  const result = execute(wx(), { initial, [fault]: 'sgxh_headers_wx' });
  for (const key of Object.keys(initial)) assert.equal(result.store[key], initial[key]);
  assert.equal(result.notices.length, 1);
  assert.equal(result.notices[0][1], '凭据保存失败');
  assert(!JSON.stringify(result.notices).includes('已更新'));
});

test('notification timestamp write failure also prevents a success claim', () => {
  const result = execute(wx(), { failKey: 'sgxh_notify_ts' });
  assert(!result.store.sgxh_token_wx);
  assert.equal(result.notices[0][1], '凭据保存失败');
});

test('storage read error cannot break intercepted request', () => {
  const result = execute(wx(), { readFailure: true });
  assert.equal(result.writes.length, 0);
  assert.equal(result.notices[0][1], '凭据保存失败');
});

test('notification error cannot break intercepted request', () => {
  const result = execute(wx(), { notifyFailure: true });
  assert.equal(result.store.sgxh_token_wx, SECRET.wx);
});

test('request without credentials and missing request pass through', () => {
  assert.equal(execute(request('wxforum', {})).writes.length, 0);
  assert.equal(execute(undefined).writes.length, 0);
});

test('exact uppercase hostname is accepted', () => {
  assert.equal(execute({ url: 'https://WXFORUM.SANGUOSHA.CN/api/profile', headers: { Authorization: SECRET.wx } }).store.sgxh_token_wx, SECRET.wx);
});

console.log('PASS Surge credential capture: ' + scenarios + ' scenarios');
