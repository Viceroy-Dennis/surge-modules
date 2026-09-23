# surge-modules

Surge 模块与脚本存档（每日自动化任务仓库）。

---

## 1. 哔哩哔哩每日任务

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/bilibili.sgmodule
```

| 文件路径 | 说明 |
|---|---|
| `bilibili.sgmodule` | 模块本体：主站+直播+漫画任务、Cookie 抓包、手动测试入口 |
| `bilibili/bilibili_main.js` | 主站每日任务（观看/分享/投币/大会员签到） |
| `bilibili/bilibili_test.js` | 全任务综合测试与诊断（账号/经验/任务状态/接口连通体检） |
| `bilibili/live_task.js` | 直播签到+粉丝牌任务 |
| `bilibili/silver2coin.js` | 银瓜子换硬币 |
| `bilibili/manga_task.js` | 漫画签到（兼 Cookie 抓包） |
| `bilibili/capture_live.js` | 直播 Cookie 抓包（降噪版） |

---

## 2. 三国咸话每日任务

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/xianhua.sgmodule
```

| 文件路径 | 说明 |
|---|---|
| `xianhua.sgmodule` | 模块本体：自动任务、凭据抓包、手动测试与体检入口 |
| `xianhua/xianhua_task.js` | 每日自动任务（打开小程序 + 每日签到 + 浏览3次 + 自动领奖） |
| `xianhua/xianhua_test.js` | 综合体检与诊断（检查凭据有效性/时间戳/任务列表状态） |
| `xianhua/xianhua_capture.js` | 登录凭据抓包（微信进入小程序自动抓，降噪仅更新时通知） |

---

## 3. 蜂巢每日签到 (pting.club)

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/fengchao.sgmodule
```

| 文件路径 | 说明 |
|---|---|
| `fengchao.sgmodule` | 模块本体：每日签到、Cookie 抓包、手动测试与体检入口 |
| `fengchao/fengchao_task.js` | 每日自动签到（每天 09:14 执行，记录连续天数与积分） |
| `fengchao/fengchao_test.js` | 综合体检与测试（检查 Cookie 状态、接口连通性、当前积分） |
| `fengchao/fengchao_capture.js` | 登录 Cookie 抓包（自动剔除临时 WAF，捕获成功弹通知） |

- **凭据获取**：安装模块并开启后，在 Safari 中登录并访问 `https://pting.club/` 任意页面即可自动捕获凭据
- **抓包开关**：捕获成功后可将模块参数 `capture` 改为 `#` 关闭抓包
- **手动测试**：在 Surge 脚本列表可直接点击「蜂巢手动签到」或「蜂巢体检测试」
