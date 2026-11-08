# 蜂巢 Surge 每日签到

Surge 版使用与用户已确认运行成功的 Quantumult X 版相同的签到流程，默认每天 **09:14（设备本地时区）**执行。

支持 **Surge iOS 5.9.0+ / Surge Mac 5.5.0+**。脚本使用这两个版本提供的关闭自动重定向与自动 Cookie 管理选项，按采集到的域名回放完整 Cookie。

## 安装

在 Surge「模块 → 安装新模块」中粘贴：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/fengchao.sgmodule
```

1. 启用模块、脚本和 MitM，并安装、信任 Surge 的 MitM 证书。
2. 在 Surge 开启时，用 Safari 访问 `https://pting.club/` 并登录。它目前跳转到 `fengchao.chat`。
3. 用同一个 Safari 打开 `https://fengchao.chat/api/auth/me`。显示 JSON 属于正常现象，Surge 应通知「凭据已保存」。
4. 在 Surge 脚本列表运行「蜂巢手动签到」，确认通知结果后即可定时运行。

QX 与 Surge 的本机存储彼此独立，需在 Surge 中单独采集一次凭据。

已有蜂巢模块时，更新该模块和脚本缓存，并检查实际生效的任务为 `cronexp="14 9 * * *"`，只保留一个自动签到任务。旧模块只包含 `pting.club` 的采集规则，需要更新后才能采集当前域名。

## 三个使用入口

- **蜂巢自动签到：** 每天09:14查询今日状态，未签到时才提交签到。
- **蜂巢手动签到：** 立即运行相同签到流程，已签到则跳过提交。
- **蜂巢体检测试：** 只查询登录、今日签到状态、连续天数和蜂蜜余额，不提交签到，也不修改已保存凭据。

模块中的采集参数默认为「蜂巢抓包」。采集完成后可设为 `#` 停用；Cookie 失效后重新启用并采集。

## 接口与结果确认

脚本先使用 `GET /api/auth/me` 检查账户和 `data.surface.checkedInToday`，需要签到时才请求 `POST /api/check-in`，正文为 `{"action":"check-in"}`，随后再次查询当天状态确认结果。

HTTP 200 本身不算成功。业务错误、非 JSON、登录失效和站点验证会明确通知。签到请求超时后只查询确认，不重发 POST；无法确认时提示「签到结果待确认」。奖励为0也是有效返回。

通知按服务端字段展示蜂蜜奖励、蜂蜜余额与连续签到天数。凭据保存在 Surge 本机 `$persistentStore`，不输出 Cookie 日志，不自动输入密码登录。

## 文件

- [模块导入链接](https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/fengchao.sgmodule)
- [脚本直链](https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/fengchao/fengchao_task.js)

## 验证范围

QX 版已由用户确认成功运行。Surge 版已核对原生 API 和模块语法，38 项离线模拟测试全部通过，覆盖原生回调、签到结果确认、凭据隔离、只读诊断及超时完成逻辑；首次安装仍需在 Surge 中运行「蜂巢手动签到」确认实际结果。

在仓库根目录运行 `node tests/fengchao.surge.mock.test.cjs` 可复现离线验证，无真实网络请求。

Surge API 依据官方 [公共 API 文档](https://manual.nssurge.com/scripting/common.html)、[脚本配置](https://manual.nssurge.com/scripting/overview.html)、[模块文档](https://manual.nssurge.com/profile/module.html)。
