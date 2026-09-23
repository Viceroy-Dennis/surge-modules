# surge-modules

Surge 模块与脚本存档（每日任务自动化）。

## 哔哩哔哩每日任务

安装：Surge → 模块 → 安装 → 粘贴 URL：

```
https://raw.githubusercontent.com/Viceroy-Dennis/surge-modules/main/bilibili/bilibili.sgmodule
```

| 文件 | 说明 |
|---|---|
| bilibili.sgmodule | 模块：主站+直播+漫画任务、Cookie 抓包、手动测试入口 |
| bilibili_main.js | 主站每日任务（观看/分享/投币/大会员签到） |
| live_task.js | 直播签到+粉丝牌任务 |
| silver2coin.js | 银瓜子换硬币 |
| manga_task.js | 漫画签到（兼 Cookie 抓包） |
| capture_live.js | 直播 Cookie 抓包（降噪版） |

- Cookie 抓包：装模块后在 B 站 App 内刷新一次即可，与直播脚本共用 `chavy_cookie_bilibili` 池
- 投币参数 `coin_count`：0=不投币，1-5=每天投 N 枚（投满 5 枚得 50 投币经验）
- 模块参数值改成 `#` 可关闭对应抓包脚本
