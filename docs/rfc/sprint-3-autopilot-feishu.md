# Sprint 3 夜间预生产与飞书台账契约

| 数据 | 存储与边界 |
| --- | --- |
| 巡航策略 | 一天一个定时槽，使用 Asia/Shanghai。默认停用定时，最低 70 分，限账号数、请求数和 Token 数。手动和定时共用队列与当天任务预算。 |
| 选题 | 从 AIHOT 与仍获准本地创作的飞书写法参考挑选。按账号名、受众、业务说明或默认参考匹配，以账号和来源去重。同一批次的同一灵感只分配一次。无人值守使用本地模型或离线模拟器。 |
| 早报 | 绑定 Asia/Shanghai 日期、任务、母稿版本、草稿修订和完成的审核。分数取真实角色未处理项计算值。过滤低分、未核事实、硬阻断和失败。保留可供人工取舍的非阻断分歧。 |
| 审批 | 复用通知 outbox、回调 inbox。每篇有独立动作和消息绑定，操作者、回执、版本、有效期同时校验。通过记账并显示原母稿分发入口。打回按原输入走生产队列，使用单独预算并限制次数。 |
| 台账 | 定稿/审批和台账事件同事务记录。每篇母稿映射一个远端记录，字段白名单为 article_id、母稿版本、标题、账号、三端派生状态、排期、写入指纹。派生有更新时增量同步。 |
| 传输 | 台账专用写入 scope 和凭证。明确失败可退避重试，发送前记录未知状态，未知结果按 article_id 和指纹核对。无明确回执时停止创建重试。Demo 使用本地模拟表与通知。 |

排期可空，作者在台账中填写实际时间。审批通过不自动生成渠道内容或发布。实时策划、视觉分镜与矩阵防撞车沿用总规划。

生产后台处理实际任务。通知后台每隔约三秒检查当日时间槽，工作台与通知后台同时在线时，到达指定时间后的首次检查会运行。真实通知需配置现有飞书私聊应用、允许的唯一接收者和 `FEISHU_MORNING_SEND_APPROVED=1`。定时策略默认关闭。

台账读取和写入都用独立凭证。工作台读取 `FEISHU_LEDGER_WRITE_APPROVED=1`、`FEISHU_LEDGER_WRITE_TOKEN` 与 `FEISHU_LEDGER_WRITE_SCOPE`。Scope 包含目标 `app`、`table`，以及 `fields` 下七个互不相同的列名映射。使用文本列存储 `articleId`、`title`、`account`、`channels` 和 `fingerprint`，数字列存储 `articleVersion`，日期列存储可空的 `scheduledAt`。凭证须有权查询目标表和创建、更新记录。现有通知进程可以分发台账，也可通过 `node scripts/feishu-notifier.mjs --ledger-only` 单独消费台账，仍需现有本机后台地址和密钥。收到飞书回执后会记录表内记录 ID。无法确认写入时，保持待核对状态并阻止该稿件后续事件覆盖未确认写入。

网页定稿或采纳当前正式版本的分歧意见，同事务追加 `resolve` 通知事件。事件按任务和原版本幂等。相同版本的卡片停止接收决定；已发出的消息使用原消息 ID 去掉操作按钮，更新为「已在工作台处理」。主动从飞书采纳原有 A/B 卡保留其独立回执。

同一自动任务链最多消耗八跳。首次生成、每轮正式审核、每次自动修订分别记账。同一轮分角色和同一阶段的安全重入共用一跳，剩余请求仍受现有模型预算约束。打回重跑继承根链。在第八跳完成后需要第九跳时，提交队列熔断及转人工通知，不调模型；已有产物可供人工处理。

巡航文本与来源标识通过只读 `sourceMaterials` 作为用户数据序列化。热点线索和飞书写法参考不进入系统控制指令。每次调用前重新核对被选中的飞书参考许可和启用账号；模型由服务端回环配置决定。

## 离线复验

在公开版工作树用 PowerShell 启动隔离演练。使用新的临时数据目录会复位当日巡航和审批记录。

```powershell
$env:STUDIO_NEXT_DIST_DIR = '.next/sprint3-final'
$env:PORT = '3718'
$env:STUDIO_DEMO_MODEL_PORT = '3717'
$env:STUDIO_DATA_DIR = Join-Path $env:TEMP 'public-sprint3-fresh'
npm run build
node scripts/start-production.mjs --demo
```

打开 `http://127.0.0.1:3718/studio/settings/autopilot`。从「模拟夜间巡航」查看候选、摘要和淘汰原因，分别通过、打回两篇稿件。通过后打开指定版本的分发面板，生成一份渠道稿，再回台账保存排期。重跑后从工作台处理新稿的分歧，可在飞书卡片预览查看原卡按钮消失。

自动复验需要本机 Edge，以及尚未触发过巡航的离线数据库。在另一终端运行：

```powershell
$env:STUDIO_SPRINT3_URL = 'http://127.0.0.1:3718'
$env:STUDIO_SPRINT3_DB = Join-Path $env:TEMP 'public-sprint3-fresh/studio.sqlite'
$env:STUDIO_SPRINT3_EVIDENCE = Join-Path $env:TEMP 'public-sprint3-evidence'
node scripts/verify-sprint3-autopilot.mjs
```
