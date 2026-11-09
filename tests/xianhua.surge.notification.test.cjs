'use strict';
// Offline native Surge notification regression. All endpoints are explicitly
// queued; no real network, QX globals, or fallback success response is exposed.
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const code=fs.readFileSync(path.join(__dirname,'../xianhua/xianhua_task.js'),'utf8');
const tasks=[1001,1003,1004,1006,3028,3014].map((id,i)=>({taskId:id,taskDesc:['今日点赞10次','今日浏览帖子3次','今日分享帖子1次','本周查看1次热力竹','本周查看1次每周战报','领取一次热力竹奖励'][i],taskType:i<3?1:i<5?2:3,progressStatus:2,currentProgressValue:1,targetProgressValue:1,taskProgressId:7000+i,jumpPageUrl:id===1006?'/pages/webview/webview?src=https://xh.sanguosha.cn/h5/energy&fullscreen=1&c=2&token=1':''}));
async function run(hasH5){
 const calls=[],logs=[],notices=[],store={sgxh_token_xh:'fixture-wx-authorization',sgxh_token_wx:'fixture-wx-authorization',...(hasH5?{sgxh_token_h5:'fixture-h5-authorization'}:{})};
 const WX='https://wxforum.sanguosha.cn/api',XH='https://api-xh.sanguosha.cn';
 const queues=new Map(),errors=[],timers=new Set();
 let done=0,finish,active=0,watchdog;const completion=new Promise(r=>finish=r);
 function add(method,url,data,count=1,body){
  queues.set(`${method} ${url}`,Array.from({length:count},()=>({data,body})));
 }
 add('GET',`${WX}/shop/taskList`,[],3);
 add('GET',`${WX}/shop/taskForever`,[],3);
 add('GET',`${XH}/task/sgxh-task/taskList`,tasks,3);
 add('POST',`${WX}/openMiniApp`,{},1,{flag:1});
 add('POST',`${WX}/user/signIn`,{},1,{});
 add('GET',`${WX}/topics?page=1&category_id=1`,[{id:80001}]);
 if(hasH5)add('GET',`${XH}/task/heatValue/progress`,{heatValue:3940,currentRewardId:null,rewards:[{id:37,heatThreshold:3600,received:true}]});
 function request(method,options,callback){
  const call=JSON.parse(JSON.stringify(options));call.method=method;calls.push(call);
  let definition;
  try{
   assert.equal(typeof callback,'function','Surge transport requires a callback');
   assert.equal(call['auto-cookie'],false,'disable automatic cookie handling');
   assert.equal(call['auto-redirect'],false,'disable redirects');
   assert(!Object.prototype.hasOwnProperty.call(call,'opts'),'QX nested options are not native Surge options');
   assert(Number.isInteger(call.timeout)&&call.timeout>0&&call.timeout<=6,'native HTTP timeout is in rounded-up seconds');
   const queue=queues.get(`${method} ${call.url}`);
   assert(queue&&queue.length,'unexpected endpoint, method, or repeated request');
   definition=queue.shift();
   if(definition.body!==undefined)assert.deepEqual(JSON.parse(call.body),definition.body,'daily action body');
   else assert.equal(call.body,undefined,'query must not have a request body');
  }catch(error){errors.push(error);setImmediate(()=>callback('mock request rejected',undefined,undefined));return;}
  active++;
  setImmediate(()=>{
   active--;
   callback(null,{status:200,headers:{}},JSON.stringify({code:1000,success:true,message:'操作成功',data:definition.data}));
  });
 }
 const sandbox={
  $persistentStore:{read:key=>store[key]||'',write:()=>{throw Error('no writes expected');}},
  $httpClient:Object.fromEntries(['get','post','put'].map(method=>[method,(options,callback)=>request(method.toUpperCase(),options,callback)])),
  $notification:{post:(...args)=>notices.push(args)},
  $done:()=>{done++;finish();},
  console:Object.fromEntries(['log','warn','error'].map(name=>[name,(...args)=>logs.push(args.join(' '))])),
  setTimeout:(fn,ms,...args)=>{
   // The run guard stays later than the host watchdog; only short sleeps and
   // request timers are accelerated. Normal completion cancels every timer.
   const delay=ms>=100000?8000:ms>=2000?500:0;
   const timer=setTimeout(()=>{timers.delete(timer);fn(...args);},delay);timers.add(timer);return timer;
  },
  clearTimeout:timer=>{timers.delete(timer);clearTimeout(timer);},
  encodeURIComponent,decodeURIComponent,URL
 };
 try{
  const result=vm.runInNewContext(code,sandbox,{filename:'xianhua_task.js',timeout:1000});
  await Promise.race([
   Promise.all([completion,result]),
   new Promise((_,reject)=>{watchdog=setTimeout(()=>reject(Error('$done deadline exceeded')),3000);})
  ]);
  await new Promise(resolve=>setImmediate(resolve));
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(timers.size,0,'normal completion must clear the run guard and request timers');
 }finally{
  clearTimeout(watchdog);
  for(const timer of timers)clearTimeout(timer);
 }
 assert.equal(errors.length,0,'every request must match a queued response');
 assert.equal(active,0,'$done must follow all native callbacks');
 assert([...queues.values()].every(queue=>queue.length===0),'all expected requests must run');
 assert.equal(done,1);assert.equal(notices.length,1);const text=notices[0][2];
 assert(!/凭据自检|头字段|375位|api-xh=|wx=/.test(text),'日常弹窗不应包含凭据自检');
 assert(!/0\/0/.test(text),'已完成任务不应显示0/0');
 assert.equal((text.match(/今日点赞/g)||[]).length,1,'点赞结果只显示一次');
 assert.equal((text.match(/今日浏览/g)||[]).length,1,'浏览结果只显示一次');
 assert(logs.some(x=>x.includes('凭据自检')),'凭据自检保留在日志');
 assert(!/fixture-/.test(text),'通知不能泄漏凭据');
 for(const token of Object.values(store))assert(![...logs,...notices.flat()].join('\n').includes(token),'logs and notifications must not expose stored credentials');
 if(hasH5){assert(calls.some(c=>c.url.endsWith('heatValue/progress')));assert(text.includes('热力竹档位'),'展示档位检查结果');assert(!text.includes('未检查'));}
 else {assert(!calls.some(c=>c.url.includes('heatValue')||c.url.includes('/h5/energy')),'缺H5凭据时不使用微信授权或占位符发送请求');assert(text.includes('热力竹档位：未检查'),'区分周任务已领与档位未检查');assert(text.includes('打开一次热力竹页面'));assert(notices[0][1].includes('需检查'));}
 assert(text.length<650,'日常通知应保持紧凑');
}
(async()=>{for(const h5 of [true,false]){await run(h5);console.log('PASS notification '+(h5?'valid_h5':'placeholder_without_h5'));}})().catch(e=>{console.error(e.message);process.exitCode=1;});
