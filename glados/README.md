# GLaDOS 多账号签到 · Surge

GitHub 仓库中的配套文件为 `glados.sgmodule` 和 `glados/glados-checkin.js`。适用于 **Surge iOS 5.9+ / Surge Mac 5.5+**，每天 **09:14，运行设备本地时区** 执行。脚本按账号保存登录凭据，汇总签到结果、积分和剩余天数。

## 安装

### 通过 URL 安装

在 Surge 的模块管理中选择通过 URL 安装，粘贴：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/glados.sgmodule
```

模块已经引用以下脚本地址，无需另行修改 `script_url`：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/glados/glados-checkin.js
```

启用模块后，开启 MITM，安装并信任 Surge CA 证书，再按下文添加账号。更新时同时刷新模块和脚本缓存。

### 本地文件方式

1. 下载模块和 `glados-checkin.js`，放进 **Surge 当前配置文件所在目录**。将模块参数 `script_url` 改为 `glados-checkin.js`；相对路径以配置目录为基准。
2. 在 Surge 的模块管理中添加并启用本地模块。聊天压缩包中的模块文件名为 `glados-checkin.sgmodule`，与仓库中的 `glados.sgmodule` 内容相同。
3. 在 Surge 中启用 **MITM**，按应用指引安装并信任其 CA 证书。iOS 安装描述文件后，还需在系统「设置 → 通用 → 关于本机 → 证书信任设置」启用该证书的完全信任。
4. 确认模块的捕获脚本和定时脚本均已启用，允许 Surge 发送通知。

iOS 若不方便把文件放进配置目录，直接使用上面的 URL 安装方式即可。

### 自行托管方式

1. 将 `glados-checkin.js` 放到你能管理的 HTTPS 托管位置，取得直接返回 JavaScript 内容的 **Raw 地址**，不能使用代码预览页面地址。
2. 编辑模块的 `#!arguments=` 行，将 `script_url:` 后的默认地址替换为你托管的真实 Raw 地址。
3. 将修改后的模块也托管为 HTTPS 原始文件，在 Surge 模块管理中通过该模块 URL 安装并启用。
4. 完成上述 MITM 证书、信任与通知设置。

脚本和模块均不需要写入真实 Cookie 或 Authorization；账号凭据会在登录捕获时存入本地。

## 添加账号并验证

1. 保持 Surge 运行并接管浏览器流量，在你当前可用的 GLaDOS 域名登录第一个账号。
2. 打开并刷新该站点的 `/console/checkin` 页面。页面请求 `/api/user/status` 且返回有效账号身份时，脚本会保存登录凭据。
3. 等待「已添加账号」通知，确认显示的账号编号与脱敏邮箱。
4. 为其他账号重复操作。同一邮箱重新登录后会更新已有账号的凭据；没有邮箱时，以同域名的账号 ID 匹配。
5. 在 Surge 的脚本列表手动运行 **GLaDOS-Checkin**，查看汇总通知及脚本日志，确认所有账号都能签到或明确显示「今日已签到」。此操作会实际发起签到请求。

建议使用不同浏览器或彼此独立的浏览器会话登录多个账号。**退出登录可能使之前捕获的会话失效**；添加完后应再次核对第一个账号的签到结果。Cookie 和 Authorization 的有效期由网站决定，脚本不能保证它们长期有效。

支持捕获的域名：`glados.network`、`glados.rocks`、`glados.one`、`glados.space`、`glados.cloud`、`glados.vip`、`glados-facility.com`。此列表表示脚本允许处理这些域名，不代表每个域名当前都在线。每个账号使用最近一次有效捕获的域名发请求。

没有添加通知时，先检查 MITM 是否生效、CA 证书是否已信任、浏览器流量是否经过 Surge，以及页面是否真正请求了 `/api/user/status`。未登录、非 JSON 响应或缺少账号身份的响应不会入库。可以在已登录的同一浏览器中打开该域名下的 `/api/user/status` 验证；不要把包含账号信息的响应公开分享。

## 定时与通知

模块中默认任务为：

```ini
cronexp="14 9 * * *"
```

时间随设备本地时区变化。设备需能运行 Surge 并访问 GLaDOS；`wake-system=true` 不能保证关机、应用不可运行或系统限制下仍按时完成。

可在模块参数中修改 `notify`：

| 参数 | 签到汇总通知 |
| --- | --- |
| `always` | 每次执行后发送，默认值 |
| `failure` | 存在失败、未确认、未执行或附加查询警告时发送 |
| `off` | 关闭签到汇总通知，结果仍写入脚本日志 |

该参数只控制签到汇总。账号捕获、手动管理、没有账号及配置错误仍会通知。通知最多展示前 12 个账号，完整结果在 Surge 脚本日志中。

## 手动管理账号

在你可编辑的配置文件 `[Script]` 段添加单独的管理脚本；如果已有该段，只添加条目。`type=generic` 不会定时执行，需要从 Surge 脚本列表手动运行。

查看账号编号：

```ini
[Script]
GLaDOS-Accounts = type=generic, script-path=https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/glados/glados-checkin.js, argument="mode=list", timeout=10
```

删除编号为 `1` 的本地账号：

```ini
[Script]
GLaDOS-Remove = type=generic, script-path=https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/glados/glados-checkin.js, argument="mode=remove&id=1", timeout=10
```

先运行列表确认编号，再将 `id=1` 改为要删除的编号并手动运行一次，随后移除删除条目。本地文件方式可将上述 `script-path` 改为 `glados-checkin.js`。**不要把 `mode=remove` 放进定时签到任务。** 删除只移除本机保存的该账号，不删除网站账号；其余编号保持不变。若再次登录并触发捕获，该账号会重新添加。

## 执行行为与常见结果

- 每个账号先请求 `/api/user/checkin/challenge`，按返回的 nonce 计算 SHA-256，再等待约 2.7 秒；确认 challenge 仍在有效期内才提交签到。没有有效 challenge 时会停止该账号的签到并报告原因。
- 账号串行处理，先让全部账号尝试签到，再为已成功或已签到的账号查询状态与积分。一个账号异常不会阻止其他账号。
- 单次 HTTP 请求最多等待 12 秒，整轮执行预算为 160 秒，模块超时为 180 秒。账号较多或网络缓慢时，预算不足的账号会明确标为「未执行」；可稍后手动运行。
- 「未确认」表示请求可能已经被服务端处理，但客户端未获得足够信息确认结果。请先检查网页签到记录，再决定是否重试。
- 「登录凭据失效」需要重新登录并刷新页面捕获。HTTP 403 也可能是访问验证页面；请在浏览器检查。
- HTTP 429 表示请求过于频繁，应稍后再运行。重定向、验证页面、网站接口变化会被报告，脚本不会自动把登录凭据转发到另一个域名。
- 签到成功后，积分或剩余天数查询失败会单独显示警告，不能据此断定签到失败。

账号数据保存在 Surge 本地 `$persistentStore` 的 `glados_multi_accounts` 项中。脚本不打印 Cookie、Authorization 或完整邮箱；存储导出仍包含登录凭据，请勿公开分享。若存储格式损坏，脚本会停止并保留原数据，不会自动清空账号。

尚未使用真实账号在 Surge 设备上实测。交付前的本地仿真用于检查脚本分支与请求隔离，不能替代安装后的首次手动验证；网站接口也可能继续变化。

## 参考资料

- [Surge JavaScript API](https://manual.nssurge.com/scripting/api.html)
- [Surge 脚本总览](https://manual.nssurge.com/scripting/overview.html)
- [Surge 模块与参数](https://manual.nssurge.com/profile/module.html)
- [Surge HTTP Response 脚本](https://manual.nssurge.com/scripting/http-response.html)
- [Surge Cron 脚本](https://manual.nssurge.com/scripting/cron.html)
- [Surge MITM](https://manual.nssurge.com/http/mitm.html)
- [社区 GLaDOS 签到实现](https://github.com/Walvez/glados-auto-checkin)
- [社区 challenge 适配实现](https://github.com/lankerr/2026-glados-checkin/blob/main/checkin.py)、[PR #31](https://github.com/lankerr/2026-glados-checkin/pull/31)、[PR #33](https://github.com/lankerr/2026-glados-checkin/pull/33) 与 [问题讨论 #28](https://github.com/lankerr/2026-glados-checkin/issues/28)。这些是社区适配依据，不是 GLaDOS 官方接口契约。
