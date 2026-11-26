# 创作者工作台复验

## 入口

| 入口 | 常用操作 |
| --- | --- |
| 今日待办 | 待审稿件、待发布成品、待填发布表现、可升级规则、最近编辑 |
| 写稿与精修 | 单篇、批量和自由文章，精修、配图与分发 |
| 历史文章 | 文章清单、需求草稿、任务搜索、历史批次与队列 |
| 热点与巡航 | 今日热点、巡航筛选结果及早报 |
| 账号与素材 | 账号、写作规范、质量标准、素材、飞书资料和发布复盘 |
| 系统机房 | 运行检查、内容检查效果、巡航与费用、资料使用、提案存档、模型分工、飞书通知、备份与验收 |

## 十五项检查

| 检查 | 对应行为 |
| --- | --- |
| 自动判断 | 审核发现事实风险或仍待处理的分歧时主动打开；常规检查收为状态胶囊。 |
| 按需展示 | 选题、正文、待办与发布操作优先。清单、实验与历史记录按需打开。 |
| 代办 | 飞书高分审批自动备稿，定稿冻结发布前预期；保留作者复制与发布控制。 |
| 全局一致 | 主导航按创作者任务归属，操作采用「替换原文」「复制成品」「粘贴到图位」。 |
| 即时反馈与可收回 | 写入成功后才显示修改已保存。忽略先显示 5 秒撤销；失败时建议留在原处。 |
| 不打断 | 正常检查收起，首页无空卡。定位保留右栏独立滚动。 |
| 常用易做、危险难误碰 | 分歧方案优先给替换；归档或清空图位先确认，旧稿件或图片可从记录找回。 |
| 文案自明 | 读者端使用「发布前预期」「搜索与问答可读性」「资料使用记录」。 |
| 表达变化 | 正文保存后原段淡出，新段出现暖光；忽略和采纳把卡片收起。 |
| 统一节奏 | 微交互 140 ms，展开和滑动 220 ms，统一缓动。 |
| 克制 | 初始首页背景动效关闭，可通过显示设置开启。 |
| 跟手可打断 | 标签切换与位置定位无需等待一段动画结束，正在保存时阻止重复发送。 |
| 性能记录 | 同一 Edge 页用连续 rAF 采集空白页与长稿定位各 90 个间隔。 |
| 布局与减少动态 | 保留长稿两栏或单列的原有布局，减少动态时使用即时终态。 |
| 屏宽与主题 | 1440×900、390×844 分别检查亮色、暗色，并覆盖正常与减少动态。 |

## 持久启动

在 PowerShell 中运行以下命令。

```powershell
Set-Location D:/demo-public-release
$env:STUDIO_NEXT_DIST_DIR = '.next/creator-ux-release'
$env:PORT = '3908'
$env:STUDIO_DEMO_MODEL_PORT = '3907'
$env:STUDIO_DATA_DIR = Join-Path $env:LOCALAPPDATA 'AIContentOS/creator-workbench-release'
npm run build
node scripts/start-production.mjs --demo
```

关闭终端后，用同一环境和同一数据目录重新运行启动命令可保留演练稿。避开同一端口的重复启动。演练只使用本机替身。首次完整复现用新数据目录，按顺序运行 `verify-v1-readiness.mjs`、`verify-phase1-review.mjs`、`verify-sprint2-channels.mjs`、`verify-creator-workspace.mjs`。各脚本在开头列出 URL 和证据目录变量，后一个脚本读取前三个脚本写入的 JSON。复现脚本会改动本机演练稿。


## 导航与今日概览复验

桌面左栏底部常驻系统机房。手机用顶部工作空间菜单，点击入口后收起，缩短视口时仍可在菜单内继续滚动。首页四卡在桌面横排，在窄屏两列，显示实际计数并沿用原跳转目标。显示设置在系统机房，主题和背景偏好在本机浏览器中保存。

可沿用上面的启动方式，将 `STUDIO_NEXT_DIST_DIR` 改为 `.next/navigation-refresh-final`、端口改为 3958（模型端口 3957），并将 `STUDIO_DATA_DIR` 指向 `%LOCALAPPDATA%/AIContentOS/navigation-refresh-final`。使用已有早报、待发成品、复盘和校准样例的隔离 Demo 执行：

```powershell
$env:STUDIO_NAV_URL = 'http://127.0.0.1:3958'
$env:STUDIO_NAV_EVIDENCE = Join-Path $env:TEMP 'navigation-refresh-final'
node scripts/verify-navigation-refresh.mjs
```
