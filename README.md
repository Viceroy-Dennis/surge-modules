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

---

## 4. RE0 每日签到 (re0.me)

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/re0.sgmodule
```

| 文件路径 | 说明 |
|---|---|
| `re0.sgmodule` | 模块本体：Action 穿透签到、Cookie/UA抓包、手动测试与体检入口 |
| `re0/re0_task.js` | 每日自动签到（动作 POST 绕开 CF 盾墙，自动处理 428 安全令牌换取） |
| `re0/re0_test.js` | 综合体检与诊断（检查 cf_clearance 通行证、Action ID、UA 绑定） |
| `re0/re0_capture.js` | 登录凭据抓包（捕获 Action ID、真实 UA 与 cf_clearance 盾墙凭证） |

---

## 5. 淘宝淘金币每日签到

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/taobao.sgmodule
```

| 文件路径 | 说明 |
|---|---|
| `taobao.sgmodule` | 模块本体：自动学习 mtop 接口、Cookie池维护、手动测试与体检入口 |
| `taobao/taobao_task.js` | 每日自动签到（原生纯 JS MD5 计算动态签名，Token 过期自动舞步续签） |
| `taobao/taobao_test.js` | 综合体检与诊断（检查接口锁定状态、_m_h5_tk 令牌、金币余额） |
| `taobao/taobao_capture.js` | 接口与凭据抓包（分级锁定 Rank3 核心签到接口，合并 Cookie 池） |

- **使用方法**：
  1. 安装模块开启后，在手机淘宝打开「淘金币」页面，点一次签到。
  2. Surge 弹出通知：`已锁定淘金币签到接口`。
  3. 每天 09:18 自动通过 mtop 动态签名与重放完成签到，抓取成功后可把模块参数 `capture` 改为 `#` 关闭抓包。
