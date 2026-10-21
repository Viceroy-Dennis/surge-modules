// 三国咸话 Surge v3.6 反向移植回归测试：stub Surge 环境验证任务脚本端到端
const fs = require('fs');
const vm = require('vm');
const path = require('path');

const BASE = path.resolve(__dirname, '..');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockBody(url) {
  if (/openMiniApp|signIn/.test(url)) return '{"code":0,"message":"成功","data":{}}';
  if (/\/likes$|\/share$/.test(url)) return '{"code":0,"message":"成功","data":{}}';
  if (/topics\?page/.test(url)) return '{"code":0,"data":[{"id":"12906766","title":"帖子A"},{"id":"12905506","title":"帖子B"}]}';
  if (/topics\/\d+$/.test(url)) return '{"code":0,"data":{"id":"12906766"}}';
  if (/sgxh-task\/taskList/.test(url)) return JSON.stringify({ code: 1000, message: "操作成功", data: [
    { taskId: 1001, taskDesc: "今日点赞10次", taskProgressId: 109666111, currentProgressValue: 10, targetProgressValue: 10, progressStatus: 1, rewardInfos: [] },
    { taskId: 1003, taskDesc: "今日浏览帖子3次", taskProgressId: 109666222, currentProgressValue: 3, targetProgressValue: 3, progressStatus: 2, rewardInfos: [] },
    { taskId: 1004, taskDesc: "今日分享帖子1次", taskProgressId: null, currentProgressValue: 0, targetProgressValue: 1, progressStatus: -1 },
  ]});
  if (/getReward/.test(url)) return '{"code":1000,"message":"操作成功","data":{},"success":true,"failed":false}';
  if (/postings|act-user-task|cert-status|shop/.test(url)) return '{"code":1000,"message":"操作成功","data":{}}';
  if (/updateTaskProgress/.test(url)) return '{"code":1000,"message":"操作成功","data":{}}';
  return '{"code":0,"message":"ok","data":{}}';
}

async function runOne(relFile, label, storeInit = {}, noCred = false) {
  const notifies = [], doneLog = [], logs = [];
  const store = Object.assign({
    sgxh_token_wx: 'wx-token-abc123456789',
    sgxh_headers_wx: '{"authorization":"Bearer wx-token-abc123456789","app-code":"[object Null]"}',
    sgxh_token: 'wx-token-abc123456789',
    sgxh_headers: '{"authorization":"Bearer wx-token-abc123456789","app-code":"[object Null]"}',
  }, storeInit);

  const mkHttp = (method) => (opts, cb) => setTimeout(() => cb(null, { status: 200, statusCode: 200 }, mockBody(opts.url)), 25);
  const sandbox = {
    $persistentStore: {
      read: (k) => (k in store ? store[k] : null),
      write: (v, k) => { store[k] = String(v); return true; },
    },
    $httpClient: { get: mkHttp('GET'), post: mkHttp('POST'), put: mkHttp('PUT') },
    $notification: { post: (t, sub, m) => notifies.push(`${t} | ${sub} | ${String(m).replace(/\n/g, ' / ').slice(0, 200)}`) },
    $done: (r) => doneLog.push(r === undefined ? '(undefined)' : JSON.stringify(r).slice(0, 40)),
    console: { log: (...a) => logs.push(a.join(' ')), error: (...a) => logs.push('ERR ' + a.join(' ')), warn: () => {} },
    setTimeout, clearTimeout, Date, Math, JSON, Promise, Object, Array, String, Number, RegExp, Error, parseInt, parseFloat, encodeURIComponent, decodeURIComponent,
  };

  const code = fs.readFileSync(path.join(BASE, relFile), 'utf8');
  try {
    vm.runInContext(code, vm.createContext(sandbox), { filename: relFile, timeout: 30000 });
  } catch (e) {
    console.log(`❌ ${label} 加载/执行抛错: ${e.message}`);
    return;
  }
  await sleep(6000);
  console.log(`\n=== ${label} ===`);
  console.log(`   $done 调用: ${doneLog.length} 次`);
  console.log(`   通知: ${notifies.length} 条`);
  notifies.forEach((n) => console.log(`     📣 ${n}`));
  const key = logs.filter((l) => /getReward|自检|脏/.test(l));
  key.slice(0, 6).forEach((l) => console.log(`     · ${l.slice(0, 150)}`));
  // 关键断言
  const n = notifies.join('\n');
  const checks = noCred ? [
    ['无凭据提示', /未检测到凭据/.test(n)],
  ] : [
    ['st1 任务领取', /领取\[今日点赞10次\]: (操作成功|领取成功)/.test(n)],
    ['st2 已领跳过', !/领取\[今日浏览帖子3次\]/.test(n)],
    ['未完成跳过', !/领取\[今日分享帖子1次\]/.test(n)],
    ['凭据自检', /凭据自检/.test(n)],
  ];
  checks.forEach(([name, ok]) => console.log(`   ${ok ? '✅' : '❌'} ${name}`));
}

(async () => {
  await runOne('xianhua/xianhua_task_v3.js', 'Surge v3.6 全流程');
  await runOne('xianhua/xianhua_task_v3.js', '无凭据提示', {
    sgxh_token_wx: '', sgxh_token: '', sgxh_token_xh: '',
  }, true);
})();
