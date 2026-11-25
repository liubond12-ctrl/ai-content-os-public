# Sprint 4 · 盲预测、发布复盘与写作积木

| 契约 | 键与状态 |
| --- | --- |
| BlindPrediction | task + 正式 articleVersion。定稿或进入派生时锁定，冻结标题、正文、账号、规则版本及完成会诊的来源版本。优先同版会诊；在定稿版引用最近已完成祖先会诊时明确标记依据版本。缺少会诊显示暂不能锁定；已登记发布的版本不可事后补预测。 |
| Publication / Retro | 同版首次登记发布创建不可改发布时间和 `later: +72h`。待期不运行模型。时钟到期由现有飞书进程连同后续通知处理，模拟到期仅在 Demo 可用。复盘在到期后追加，观测时刻不早于到期，锁定时刻必须早于发布与实绩。每次观测保存播放或阅读、赞、藏、评论、转化五个非负整数与来源。更正追加，不修改历史。 |
| Rubric Bump Proposal | 账号至少有五篇不同任务的已复盘稿件才进入 calibration，否则为 cold-start。样本每任务取最新合格版本的末次观测。候选规则使用标题和定稿正文的确定性表达维度打分，不向评分器传入实绩、预测、样本名次或差值。候选本身与对应 Diff、预测偏差和历史重打结果一起存储。 |
| 排序闸门 | 同账号历史池全量重打。枚举所有可比样本对，实绩同量的对排除。预测分并列为未命中。严格同序数／可比对数 ≥80% 才能合并，任何分母为 0 的情况都阻断。留存每对冲突。提交时在事务中复算账号最新规则版本和样本池指纹。有新观测、稿件或规则变更须重新验证。新规则以实体版本追加，替换旧校准规则，其他写作规则继续有效。 |
| AtomicBrick | 稳定 ID + 不变版本。可从人工定稿、高分（至少 80）、到期复盘并跑赢锁定流量上界的同账号稿件中提取，或从参考库明确标记「爆款」且仍允许本地使用的可识别版本提取。真人案例需已核验的原句依据；参考库案例须明确标记真实且非虚构。内容必须可定位到来源原文。保留来源、标签、观测胜率与归属，缺乏实绩的参考库记录无胜率。 |
| 装配 | 草稿仅保存积木 ID 与版本。预检、队列提交和模型调用前重验归属及来源许可。已提交任务冻结文本和版本；引用文本仍是只读资料。默认只在本地账户使用，禁止未授权外发。 |
| 模型路由 | 按 research、long-form、quick-review、distribution、default 声明模型、回环目标和并发上限，跨工作进程使用 SQLite 租约。在模型请求预算之外约束同时在途请求。已有云端审批保持原目标与模型。dry-run 仅返回计划，不触发请求。 |

流量层级由会诊评分映射为固定起步区间，属于待验证假设。复盘归因将流量偏差、互动偏差和初稿到定稿的改动并列记录，供人工复核。排序闸门只衡量历史排序，不解释因果。

有盲预测的稿件登记发布时要求填写实际发布时间。若锁定时间晚于或等于申报的发布时间，该版保留发布记录和锁定预测，但不进入校准样本池。历史上只有日期、缺少完整时钟且没有盲预测的稿件也可以保留发布记录。账号的既有规范保持有效；新的校准提案只替换该账号上一版校准规则。

真实飞书复盘提醒另需 `FEISHU_RETRO_SEND_APPROVED=1` 和 Sprint 3 已授权的接收者。模型路由由服务器启动环境 `STUDIO_MODEL_ROUTES` 声明，例如 `{"research":{"model":"local-reasoner","url":"http://127.0.0.1:11434/v1/chat/completions","concurrency":1}}`。备用本地模型不会收到旧目标的授权头。路由无配置时沿用现有模型。

## 离线复验

在公开版工作树中启动一套独立数据。选用此前未使用的临时目录。

```powershell
$env:STUDIO_NEXT_DIST_DIR = '.next/sprint4-release'
$env:PORT = '3748'
$env:STUDIO_DEMO_MODEL_PORT = '3747'
$env:STUDIO_DATA_DIR = Join-Path $env:TEMP 'public-sprint4-fresh'
npm run build
node scripts/start-production.mjs --demo
```

打开 `http://127.0.0.1:3748/studio/settings/calibration`，载入离线校准样例。五篇带模拟实绩，一篇等待 T+3d。分别重打「结构」和「互动引导」，对照通过与拦截，展开冲突。用「模拟 T+3d 到期」查看飞书卡片，再录入五项实绩。发布复盘页可以萃取素材；进入新建内容，选「离线校准样例」账号，在输入框的＋菜单搜索并选择积木。路由预演显示配置和并发上限。

也可以用本机 Edge 运行隔离复验脚本。脚本要求尚未载入样例的演练数据库。

```powershell
$env:STUDIO_SPRINT4_URL = 'http://127.0.0.1:3748'
$env:STUDIO_SPRINT4_DB = Join-Path $env:TEMP 'public-sprint4-fresh/studio.sqlite'
$env:STUDIO_SPRINT4_EVIDENCE = Join-Path $env:TEMP 'public-sprint4-evidence'
node scripts/verify-sprint4-calibration.mjs
```
