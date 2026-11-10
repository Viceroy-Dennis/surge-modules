# 蜗牛4K每日签到（Surge）

根据 `quantumultx-scripts/scripts/wn4k.qx.checkin.js` 的签到流程改写，使用 Surge 原生 `$httpClient`、`$persistentStore` 和 `$notification`。支持 **Surge iOS 5.9.0+ / Mac 5.5.0+**，以便关闭请求的自动重定向和 Cookie 管理，按账号分别发送凭据。

## 安装与使用

1. Surge → 模块 → 安装新模块，粘贴模块 raw 链接：

   ```text
   https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/wn4k.sgmodule
   ```

2. 启用模块及 Surge MITM，确认 MITM 证书已安装并信任。模块会追加 `wn4k.com` 和 `www.wn4k.com`。
3. 在 Surge 开启时，用 Safari 登录 `https://wn4k.com`，然后打开会员中心或 `https://wn4k.com/user/checkin.html`。收到“已保存签到请求”通知后即完成采集。多账号请逐个切换登录，并分别打开该页面。
4. 在 Surge 脚本列表运行“蜗牛4K手动签到”确认结果。之后每天 **09:14（运行设备本地时区）**自动执行。

自动脚本 raw 链接：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/wn4k/wn4k_checkin.js
```

模块已包含自动任务，不需要再添加一条重复的定时任务。脚本也能单独设为 cron 或 generic 运行，但首次使用仍需通过模块采集凭据。

## 行为与诊断

- 采集阶段只保存 Cookie 和必要请求头，不在页面请求中发起后台签到，也不修改网页内容。
- 与 QX 版一致，使用空请求体 `POST /user/checkin.html`，附带 AJAX 请求头。访问签到页面的 GET 请求不会作为签到动作重放。
- 按 Cookie 中的 `user_id`（无该字段时按 `user_name`）保存账号，并分别记录北京时间的签到日期。当日已成功的账号会跳过。
- 仅在确认成功或服务端明确表示今日已签到后记录日期。HTTP 200、HTML 页面或未知 JSON 均不会直接当作成功。
- 遇到网络错误或临时服务器错误，最多尝试三次并遵守 `Retry-After`。单次 HTTP 超时 10 秒，整次运行预算 100 秒；预算不足的账号保留到下次执行。
- “蜗牛4K本地诊断”只检查本地账号数量、Cookie、账号匹配和请求信息，不发送网络请求，不签到，也不修改数据。
- 日志不输出账号名、Cookie、密码或服务端响应正文。Cookie 过期时，在 Safari 重新登录并打开会员或签到页面更新。

## 从 QX 或旧 Surge 版本更新

QX 与 Surge 的存储不共享。旧脚本 `wn4k_task.js` 的 `WN4K_CREDS` / `WN4K_CRED` 也不会自动迁移；请在 Surge 中逐个重新采集账号。当前模块使用 `wn4k_checkin.js`，不使用旧模块的 `account` 账号密码参数；已有旧模块请更新模块和脚本缓存，确认四个入口都指向此脚本，并移除自行添加的重复签到任务。

本版本仍保留旧脚本文件，现有独立引用不会被覆盖。新模块的“本地诊断”与旧 `wn4k_diag.js` 的联网体检不同，请以模块提供的入口为准。

## 离线验证

```sh
node --check wn4k/wn4k_checkin.js
node tests/wn4k.surge.checkin.test.cjs
```

测试通过模拟 Surge 原生 API 验证采集、多账号、状态判断、重试、超时、只读诊断及模块配置，不使用真实账号请求。实际签到结果以设备运行后的通知为准。
