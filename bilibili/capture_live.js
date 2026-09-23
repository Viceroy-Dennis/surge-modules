/* B站直播 Cookie 抓取（Surge）：仅当请求携带含 bili_jct 的完整登录 Cookie 时保存，其余静默跳过 */
const KEY = 'chavy_cookie_bilibili';
try {
  const h = $request.headers || {};
  const cookie = h.Cookie || h.cookie || '';
  if (!cookie) {
    console.log('[B站直播] 请求未携带 Cookie，跳过');
  } else if (!/(?:^|;\s*)bili_jct=/.test(cookie)) {
    console.log('[B站直播] 未检测到 bili_jct（可能未登录），跳过');
  } else {
    const old = $persistentStore.read(KEY) || '';
    if (old !== cookie) {
      $persistentStore.write(cookie, KEY);
      $notification.post('B站直播', 'Cookie 获取成功', '已保存直播签到、粉丝牌与银瓜子兑换凭据');
    } else {
      console.log('[B站直播] Cookie 未变化');
    }
  }
} catch (e) {
  console.log('[B站直播] 抓取异常 ' + e);
}
$done({});
