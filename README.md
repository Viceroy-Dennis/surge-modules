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

## 2. 三国咸话每日与每周任务

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/xianhua.sgmodule
```

| 文件路径 | 说明 |
|---|---|
| `xianhua.sgmodule` | 每天09:14自动任务、凭据采集、手动执行和只读查询入口 |
| `xianhua/xianhua_task.js` | Surge原生主任务：每日签到/点赞/浏览/分享、周战报、热力竹逐档领奖及状态复查 |
| `xianhua/xianhua_test.js` | 只读社区任务诊断，不执行任务或领取奖励 |
| `xianhua/xianhua_capture.js` | 只读请求头，独立保存微信与H5凭据，通知节流 |
| `xianhua/README.md` | 安装、更新、重新采集凭据及各入口说明 |
| `tests/xianhua.surge.*.test.cjs` | 原生回调、完整工作流、凭据隔离、通知及超时的离线验证 |

支持 **Surge iOS 5.9.0+ / Mac 5.5.0+**。安装或更新后依次打开小程序**首页、福利页、热力竹页面**重新采集凭据，再运行「三国咸话手动执行」。请更新模块和脚本缓存，确认自动任务使用 `xianhua_task.js` 且为每天 **09:14（设备本地时区）**。QX与Surge存储独立；旧版Surge混存的H5凭据也需要重新采集。

---

## 3. 蜂巢每日签到 (fengchao.chat / pting.club)

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/fengchao.sgmodule
```

每天 **09:14（设备本地时区）**执行。支持 Surge iOS 5.9.0+ / Mac 5.5.0+，使用与已确认运行成功的 QX 版相同的查询、提交、复查流程。

| 文件路径 | 说明 |
|---|---|
| `fengchao.sgmodule` | 每日签到、凭据采集、手动签到和只读状态查询入口 |
| `fengchao/fengchao_task.js` | Surge 原生统一脚本；状态确认、超时不重发、蜂蜜奖励/余额与连续天数 |
| `fengchao/README.md` | 安装、更新及凭据采集说明 |
| `tests/fengchao.surge.mock.test.cjs` | 原生 Surge 回调与业务流程的离线模拟验证 |

在 Surge 开启时用 Safari 登录蜂巢，再打开 `https://fengchao.chat/api/auth/me` 采集凭据。QX 与 Surge 存储独立，需单独采集。已有模块请更新模块与脚本缓存，并检查实际任务为 `cronexp="14 9 * * *"`。体检入口传入 `argument=diagnose`，只查询状态，不签到、不修改凭据。

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

---

## 6. 途虎养车每日签到

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/tuhu.sgmodule
```

| 文件路径 | 说明 |
|---|---|
| `tuhu.sgmodule` | 模块本体：双签任务、Token 与设备风控抓包、手动测试与体检入口 |
| `tuhu/tuhu_task.js` | 每日自动签到（每天 07:17 自动执行 App+微信小程序双签，积分抵现计算） |
| `tuhu/tuhu_test.js` | 综合体检与诊断（检查 Token 存活状态、车主昵称、实时积分余额） |
| `tuhu/tuhu_capture.js` | 凭据抓包（自动保存 Authorization 数组与 blackbox 设备风控凭证） |

- **使用方法**：
  1. 安装模块开启后，打开「途虎养车」App 或微信小程序。
  2. Surge 弹出通知：`[途虎抓包] Token 获取成功 🎉`。
  3. 每天 07:17 自动完成双签并汇报可抵扣现金，捕获成功后可将模块参数 `capture` 改为 `#` 关闭抓包。

---

## 7. 蜗牛 I 4K 每日签到 (wn4k.com)

**模块安装 URL**（Surge → 模块 → 安装 → 粘贴）：
```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/wn4k.sgmodule
```

| 文件路径 | 说明 |
|---|---|
| `wn4k.sgmodule` | Cookie 采集、每天 09:14 自动签到、手动签到和本地诊断 |
| `wn4k/wn4k_checkin.js` | 基于当前 QX 版改写的 Surge 原生多账号签到脚本 |
| `wn4k/README.md` | 安装、采集凭据、更新和诊断说明 |
| `tests/wn4k.surge.checkin.test.cjs` | Surge 原生回调、多账号及超时的离线验证 |

支持 **Surge iOS 5.9.0+ / Mac 5.5.0+**。安装后启用 MITM 并信任证书，用 Safari 登录 wn4k.com，再打开会员中心或签到页面采集 Cookie。多账号逐个登录采集后，运行一次“蜗牛4K手动签到”；之后每天 **09:14（设备本地时区）**自动执行。

自动脚本 raw 链接：

```text
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/wn4k/wn4k_checkin.js
```

签到采用空请求体 `POST /user/checkin.html`，按账号独立保存凭据及日期；本地诊断不发送网络请求。QX 和旧 Surge 版用户需重新采集凭据，当前模块不使用账号密码参数。更新时刷新模块与脚本缓存，确认入口指向 `wn4k_checkin.js`。详见 [安装说明](wn4k/README.md)。

---
