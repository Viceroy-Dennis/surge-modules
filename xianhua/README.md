# 三国咸话 Surge 每日与每周任务

移植自 [Quantumult X 版](https://github.com/Viceroy-Dennis/quantumultx-scripts)，保留其每日任务、周任务和热力竹领奖流程，使用 Surge 原生 HTTP、存储与通知接口。默认每天 **09:14（运行设备本地时区）**执行。

支持 **Surge iOS 5.9.0+ / Surge Mac 5.5.0+**；脚本使用这些版本提供的关闭自动 Cookie 管理与自动重定向选项。

## 安装和更新

在 Surge「模块 → 安装新模块」粘贴：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/xianhua.sgmodule
```

1. 启用模块、脚本和 MitM，安装并信任 Surge 的 MitM 证书。
2. 在 Surge 开启时，依次打开微信「三国咸话」小程序的**首页、福利页、热力竹页面**，采集微信和 H5 两类凭据。
3. 运行「三国咸话体检测试」，确认社区任务列表可以查询。
4. 运行「三国咸话手动执行」，检查通知中的每日任务、周任务及热力竹档位结果，此后可由每日定时任务执行。

**已有旧版模块也需要更新后重新采集一次。**旧版可能把 H5 凭据存入微信通道；新采集脚本分开保存各通道。QX 与 Surge 本机存储彼此独立，QX 中的凭据不会自动转入 Surge。

更新时刷新模块和脚本缓存，确认自动任务使用 `xianhua/xianhua_task.js`，且时间为 `cronexp="14 9 * * *"`；只保留一个三国咸话自动任务。仓库中的 `_v2`、`_v3` 文件属于历史文件，本模块使用上述统一入口。

模块参数 `capture` 默认是 `咸话抓包`。采集完成后改为 `#` 可停用采集；凭据失效时重新启用并再次打开对应页面。通知有 8 秒节流，短时间内没有再次弹窗不代表没有更新凭据。

## 使用入口

| 入口 | 行为 |
| --- | --- |
| 三国咸话自动任务 | 每天 09:14 执行完整流程。 |
| 三国咸话手动执行 | 立即执行同一流程，会签到、推进任务并领取满足条件的奖励。 |
| 三国咸话任务列表 | 只查询商城任务、商城等级和社区福利三个列表，不执行任务、不领奖。 |
| 三国咸话体检测试 | 只查询社区任务列表，显示每日／每周／一次性任务的进度与状态。 |

主脚本默认执行完整任务；手动配置时，`argument=mode=list` 或 `argument=list` 可进入只读模式。无法识别的参数会停止执行。

## 任务与领奖

- 每日打开小程序、签到，并按查询到的进度补足点赞 10 次、浏览 3 次、分享 1 次。帖子 ID 来自服务端列表。
- 查询并执行「本周查看热力竹」「本周查看每周战报」，最终结果以任务列表复查为准。
- 社区福利使用 `taskProgressId` 领取，商城使用商城任务 ID 领取，热力竹使用档位 ID 领取。
- 热力竹仅领取明确未领取且热力值达标的档位；每领取一档立即复查，确认已领取后再继续。首次领取任务已经完成时，仍会检查后续解锁档位。
- 本轮已尝试过的同一任务奖励不重复提交。热力竹领取失败或结果未确认时停止继续领取，单轮最多确认 20 档。

通知区分「已领取」「待领取」「未完成」及查询失败。HTTP 200 或领奖接口受理本身不能证明任务奖励已到账。缺少 H5 凭据时会提示打开热力竹页面，不会用微信令牌替代 H5 令牌。

主任务在 106 秒后停止派发新请求，116 秒触发结束保护，模块限时 120 秒；时间不足或进度尚未更新时，剩余项目可稍后继续。脚本不会自动重发单次超时的请求。

## 文件与验证

- [模块 raw 链接](https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/xianhua.sgmodule)
- [主任务 raw 链接](https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/xianhua/xianhua_task.js)
- [凭据采集 raw 链接](https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/xianhua/xianhua_capture.js)
- [只读诊断 raw 链接](https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/xianhua/xianhua_test.js)

在仓库根目录运行以下离线验证；测试使用虚构凭据和明确的模拟请求队列，不访问真实业务服务：

```sh
node tests/xianhua.surge.capture.test.cjs
node tests/xianhua.surge.diagnostic.test.cjs
node tests/xianhua.surge.notification.test.cjs
node tests/xianhua.surge.runtime.test.cjs
node tests/xianhua.surge.workflow.test.cjs
```

验证覆盖原生 Surge 回调、凭据通道隔离、只读模式、每日与每周流程、逐档领奖复查、业务失败、超时与重复结束保护。当前验证为离线模拟，首次安装仍需在 Surge 客户端手动运行确认实际结果。

原流程来源：`quantumultx-scripts` 提交 `f9d9fc5f40117c0e6dd3bdb6167bfef708633a94`。原生接口依据 [Surge JavaScript API](https://manual.nssurge.com/scripting/common.html)、[脚本配置](https://manual.nssurge.com/scripting/overview.html) 和 [模块文档](https://manual.nssurge.com/profile/module.html)。
