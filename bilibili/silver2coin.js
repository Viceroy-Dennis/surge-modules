const NAME='B站银瓜子换硬币';
const cookie=$persistentStore.read('chavy_cookie_bilibili')||'';
if(!cookie){$notification.post(NAME,'没有 Cookie','先启用 B站直播 Cookie 抓取并登录 B站');$done();}
else {
 $httpClient.get({url:'https://api.live.bilibili.com/pay/v1/Exchange/silver2coin',headers:{Cookie:cookie,Origin:'api.live.bilibili.com',Referer:'https://live.bilibili.com/',Accept:'application/json, text/javascript, */*; q=0.01','User-Agent':'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15'}},function(err,resp,body){
  if(err){$notification.post(NAME,'请求失败',String(err));$done();return;}
  try{
   const j=JSON.parse(body||'{}');
   if(j.code===0){const d=j.data||{};$notification.post(NAME,j.message||'兑换成功','兑换 '+(d.coin||'?')+' 硬币；银瓜子 '+(d.silver||'?'));}
   else $notification.post(NAME,j.code===403?'今天不可兑换':'兑换失败',j.message||('code='+j.code));
  }catch(e){$notification.post(NAME,'响应解析失败',String(body||'').slice(0,160));}
  $done();
 });
}
