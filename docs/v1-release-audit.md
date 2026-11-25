# v1.0 发布自查与联调

这里的验收使用本机示例、独立 SQLite 与 Edge。正式版本始终由作者控制；派生完成代表可审阅和复制，发布仍由作者操作。工作流与状态契约见 [v1.0 RFC](rfc/v1-production-readiness.md)。

## 十分钟人工验收

准备 Node.js 24，安装依赖后先构建：

```powershell
npm ci
npm run build
npx tsc --noEmit
node scripts/start-production.mjs --demo
```

1. **0–2 分钟** 打开 [工作台](http://127.0.0.1:3588) 和 [System Doctor](http://127.0.0.1:3588/studio/settings/doctor)。探活主模型和轻量模型，核对 Python BGE、飞书链路和权限证据的「模拟」标记。打开「今日热点」，应看到本机素材。
2. **2–4 分钟** 打开 [夜间巡航](http://127.0.0.1:3588/studio/settings/autopilot)。保留画像初筛 75 和默认预算，点「模拟夜间巡航」，后台会载入虚构来源和演示账号。展开画像初筛记录，核对低分条目和早报候选，查看预算余额。对于要复验的预算熔断，先产生估算费用，再将日上限调到 0.001 元（最低值）并保存，核对「已暂停」和模拟预算卡。
3. **4–6 分钟** 模拟审批一篇评分至少 85 且无未决分歧的候选，返回首页「今日统一作战台」，点进「已派生待发三端包」。查看各平台标签页、风险提示和 GEO。重复审批仍只生成一套绑定版本的派生稿。
4. **6–8 分钟** 进入一篇有分歧的长稿，滚动桌面审核栏并从末段分歧定位正文；把视口改为 390 px 再定位一次。从文章工具打开分镜，切换公众号头图、小红书轮播和抖音比例；用自备 PNG 回填单个图位并下载包。
5. **8–10 分钟** 打开 [账号校准](http://127.0.0.1:3588/studio/settings/calibration)，载入五条历史样本，模拟第六篇到期并查看复盘队列。在 [治理对比](http://127.0.0.1:3588/studio/settings/governance) 展开逐项样本，核对分母与结果。历史样本是模型替身演练数据。

审批、长稿、多渠道和分镜也可用同一隔离 Demo 的脚本提前准备。另开一个终端，指定证据目录和运行中的 Demo；每个种子脚本应在新的数据目录上运行一次。Edge 需已安装。

```powershell
$env:STUDIO_V1_URL = 'http://127.0.0.1:3588'
$env:STUDIO_V1_EVIDENCE = Join-Path $env:TEMP 'public-v1-audit'
node scripts/verify-v1-readiness.mjs

$env:STUDIO_SPRINT2_URL = $env:STUDIO_V1_URL
$env:STUDIO_SPRINT2_EVIDENCE = Join-Path $env:STUDIO_V1_EVIDENCE 'sprint2'
node scripts/verify-sprint2-channels.mjs

$queue = (Invoke-RestMethod "$env:STUDIO_V1_URL/api/production").queue
$env:STUDIO_V1_LONG_TASK = ($queue | Where-Object topic -Like '*长文演练*' | Select-Object -First 1).id
$env:STUDIO_V1_NET_LOG = Join-Path $PWD 'data-production-demo/network-guard.jsonl'
node scripts/audit-v1-browser.mjs

$env:STUDIO_SPRINT5_URL = $env:STUDIO_V1_URL
$env:STUDIO_SPRINT5_EVIDENCE = Join-Path $env:STUDIO_V1_EVIDENCE 'sprint5'
node scripts/verify-sprint5-workspace.mjs
python scripts/audit-public-release.py --output (Join-Path $env:STUDIO_V1_EVIDENCE 'sensitive-after.json')
```

自定义 `STUDIO_DATA_DIR` 时，将 `STUDIO_V1_NET_LOG` 指向该目录下的同名日志。Playwright 默认通过系统 Edge 运行，校验范围见下面的自查项。

## 六维自查

| 维度 | 核验方法与改动 | 复核产物 |
| --- | --- | --- |
| 公开发布 | 扫描当前跟踪的路径及本分支可达历史 Git blobs，核对环境文件、SQLite、凭证格式、个人绝对路径与忽略配置。仅输出规则、路径和对象短 ID。扫描覆盖已实现的模式及原始字节。 | `sensitive-after.json` |
| 协作与配额 | 跑队列领取、过期未知回执、旧版本落盘、图位版本锁、卡片 resolve 和 409 重放、8 跳转人工、预算并发预留和 BlindPrediction 不可覆盖的回归。异步派生提交时在事务内重新检查母稿，自动派生也锁定预测。普通任务接口拒绝客户端写入前序摘要快照。 | 对应测试和 Sprint 5 验收 |
| Demo 隔离 | 模式双向拒绝错用 SQLite；热点使用本机来源。Node 的常用出站 API 在演练子进程拦截，测试单独验证阻断日志。浏览器演练路由拦截所有非回环 HTTP 请求及阻止 Service Worker。 | `readiness.json`、`ui-and-network.json` 及独立数据目录中的 `network-guard.jsonl` |
| 构建与测试 | 升级 Next.js 安全补丁；修正缺少可执行候选判断导致的首页误计数，避免动态文件路径触发过宽构建追踪。分别运行测试、生产构建和独立 TypeScript 检查。 | 命令输出与 `readiness.json` 中的构建标识 |
| 响应式 | 两个实际 CSS 视口分别检查首页、热点、长文、审核分歧定位、分发、配图、校准与治理。检查右栏独立滚动、选区居中、宽度、切页、可达按钮及页面异常。修正带账号参数直达校准页时的 React 水合错误。 | 每个视口的 PNG、`ui-and-network.json` |
| 文档和配置 | 更新 README、总计划、示例环境变量和本清单；核查生成物及证据位于工作树外或忽略路径。 | Git 提交及工作树状态 |

本轮生产构建采用 Next.js 16.4.6。`npm test` 通过 342 项，既有历史数据库回放跳过 1 项；生产构建及独立类型检查通过。18 张截图对应 1440×900 与 390×844 CSS 视口。最终浏览器演练记录 565 次本机请求、零外部请求尝试、零页面异常，四个 Node 子进程启用守卫且无阻断事件。

出站验证是浏览器应用流量检查与 Node API 守卫，未做操作系统包捕获。治理样本使用冻结的模拟单 Agent 基线；全链路离线执行实际守卫、装配与雷达。风控残留统计的是已知风险样稿中的未提示份额，没有发布实绩或真实线上效果数据。

## 已授权的真机联调

用独立测试账号、测试会话与测试表。真实模式使用新数据目录；在 Git 忽略的 `.env.local` 填真实值。一切授权经管理员在对应平台核对后再启动。

- 本机模型配置 `STUDIO_MODEL`、`STUDIO_MODEL_URL`，按需配置 `STUDIO_MODEL_KEY`。巡航至少还需 `STUDIO_LIGHT_MODEL_ROUTE` 和 `STUDIO_AUTOMATION_PRICES`。独立路由可用 `STUDIO_MODEL_ROUTES`。Python BGE 用 `STUDIO_PYTHON_BGE_HEALTH` 指向本机服务；探活只读其就绪状态。
- 飞书接收使用同一 `FEISHU_CARD_WORKER_KEY` 和本机 `FEISHU_CARD_WORKBENCH`，并准备 `FEISHU_CARD_APP_ID`、`FEISHU_CARD_APP_SECRET`、已批准接收者 `FEISHU_CARD_OWNER` 与应用长连接。允许真实连接需 `FEISHU_CARD_LIVE_APPROVED=1`。只有已授权投递时才开启 `FEISHU_MORNING_SEND_APPROVED` 或 `FEISHU_RETRO_SEND_APPROVED`。在测试会话核对 `im:message:update`、收到的卡片状态与重复回调处理。
- 飞书只读灵感单独配置 `STUDIO_FEISHU_SCOPE` 与 `STUDIO_FEISHU_TOKEN`。仅在获准写入测试多维表后配置 `FEISHU_LEDGER_WRITE_SCOPE`、`FEISHU_LEDGER_WRITE_TOKEN`、`FEISHU_LEDGER_WRITE_APPROVED=1`，核对映射和回执。配置齐全仅代表有联调前提。

```powershell
node --env-file=.env.local scripts/start-production.mjs
node --env-file=.env.local scripts/feishu-notifier.mjs --live
# 仅验证独立台账时，用下列命令代替 --live
node --env-file=.env.local scripts/feishu-notifier.mjs --ledger-only
```

工作台与通知进程在各自终端中运行。验收期间仅用本机替身，不发送真实飞书消息、不写入真实台账，也不调用付费模型。生产凭证与真实发布效果仍待授权验证。
