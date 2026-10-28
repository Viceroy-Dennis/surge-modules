/*
 * NodeSeek 每日签到 · 浏览器内注入版 v5.1 · Surge
 * 作者：Linda for Dennis
 *
 * 原理：CF 对 www.nodeseek.com 的 /api/* 路径是 managed challenge（cf-mitigated: challenge），
 * 代理栈（$httpClient / $task.fetch）打过去一律 403 Just a moment；
 * 而同一个 IP、同一批 cookie，浏览器页面内 fetch 过去是 500 USER NOT FOUND（业务层拒的，已过 CF）。
 * 差别只在 TLS/HTTP2 指纹和 JS 能力 —— 换账号密码也没用，/signIn.html 一样 403。
 *
 * 所以这个脚本自己不签，只往 HTML 页面塞一段 JS，让 Safari 去签。
 * 规则匹配全域但只处理 text/html，JS/CSS/JSON/图片一律放行。
 *
 * [Script] 见 nodeseek.sgmodule
 * [MITM]   hostname = %APPEND% www.nodeseek.com
 */

const NAME = "NodeSeek签";
const MARK = "ns-qd-v5";
const DAY_KEY = "ns_qd_v5";

/* 注入到页面里的那段 JS：只用单引号，不出现 </script>、反引号和 ${} */
const INJECT = `(function(){
  var K='${DAY_KEY}';
  var day=new Date(Date.now()+288e5).toISOString().slice(0,10);
  try{ if(localStorage.getItem(K)===day) return; }catch(e){}

  function tip(msg,ok){
    try{
      var el=document.createElement('div');
      el.textContent=msg;
      el.style.cssText='position:fixed;left:50%;bottom:92px;transform:translateX(-50%);z-index:2147483647;'+
        'padding:10px 18px;border-radius:12px;font-size:14px;line-height:1.45;color:#fff;'
        +'background:'+(ok?'rgba(22,163,74,.95)':'rgba(185,28,28,.95)')+';'
        +'box-shadow:0 8px 28px rgba(0,0,0,.3);opacity:0;transition:opacity .25s;'
        +'pointer-events:none;max-width:78vw;text-align:center;font-family:-apple-system,sans-serif;';
      document.body.appendChild(el);
      setTimeout(function(){ el.style.opacity='1'; },20);
      setTimeout(function(){ el.style.opacity='0'; setTimeout(function(){ if(el.parentNode) el.parentNode.removeChild(el); },350); },3400);
    }catch(e){}
  }

  function done(msg,ok){
    try{ localStorage.setItem(K,day); }catch(e){}
    tip(msg,ok);
  }

  function go(){
    fetch('/api/attendance?random=true',{
      method:'POST',
      credentials:'include',
      headers:{'Content-Type':'text/plain;charset=UTF-8'},
      body:''
    }).then(function(r){
      return r.text().then(function(t){ return {s:r.status,t:t}; });
    }).then(function(x){
      var j=null;
      try{ j=JSON.parse(x.t); }catch(e){}
      var msg=String((j&&(j.message||j.msg))||'');

      if(j&&j.success){ done('NodeSeek 签到成功'+(msg?' · '+msg:''),true); return; }
      if(/已完成签到|已经签到|请勿重复/.test(msg)){ done('NodeSeek 今日已签',true); return; }
      if(/USER NOT FOUND|未登录|请登录|login/i.test(msg)) return;
      if(x.s===403||x.s===401) return;
      tip('NodeSeek 签到未完成：'+(msg||('HTTP '+x.s)),false);
    }).catch(function(){});
  }

  function start(){ setTimeout(go,1500); }
  if(document.readyState==='complete') start();
  else window.addEventListener('load',start);
})();`;

function inject(body) {
  const tag = `<script id="${MARK}">${INJECT}</scr` + `ipt>`;
  if (String(body || "").indexOf(MARK) >= 0) return null; // 已经注入过
  const b = String(body || "");
  if (/<\/body>/i.test(b)) return b.replace(/<\/body>/i, tag + "</body>");
  return b + tag;
}

/* ------------------------------ response 分支 ------------------------------ */

function headerOf(headers, name) {
  if (!headers) return "";
  const want = String(name).toLowerCase();
  for (const k of Object.keys(headers)) {
    if (String(k).toLowerCase() === want) return headers[k];
  }
  return "";
}

if (typeof $response !== "undefined") {
  try {
    const body = String($response.body || "");
    const ct = String(headerOf($response.headers || {}, "content-type") || "");

    // 只处理 HTML：规则放宽到全域匹配后，JS/CSS/JSON/图片都会进这里，别乱塞
    const isHtml = /text\/html/i.test(ct) || (!ct && /<!doctype html|<html[\s>]/i.test(body.slice(0, 400)));
    if (!isHtml) {
      $done({});
    } else {
      const next = inject(body);
      if (next === null) {
        console.log(`[${NAME}] 已有注入标记，跳过`);
        $done({});
      } else {
        console.log(`[${NAME}] 注入成功，原长 ${body.length} → ${next.length}`);
        $done({ body: next });
      }
    }
  } catch (e) {
    console.log(`[${NAME}] 注入异常：${e}`);
    $done({});
  }
} else {
  // 被当成定时任务误跑了
  try {
    if (typeof $notify === "function") $notify(NAME, "这条是页面注入脚本", "它挂在下发响应上，不需要定时运行。打开一次 www.nodeseek.com 首页即可。");
    if (typeof $notification !== "undefined") $notification.post(NAME, "这条是页面注入脚本", "打开一次 www.nodeseek.com 首页即可。");
  } catch (e) {}
  try {
    if (typeof $done === "function") $done({});
  } catch (e) {}
}
