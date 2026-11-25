# AI Content OS

面向日常写作的内容工作台。在同一个输入区描述写作需求、粘贴资料或附加文件，然后查看初稿、审核意见和版本。

## v1.0 工作台

- 单篇、批量和自由文章，支持专题、分章、素材积木与同题撞车预检。
- 多角色会诊、正式版本、三端派生与人工风控复核。
- 分镜提示词、粘贴或拖入 PNG / JPEG / WebP、正式文字和配图的 ZIP。
- 夜间巡航、画像初筛、人民币估算预算、飞书早报、审批快车道和台账。
- 发布盲预测、T+3d 复盘、规则排序校准、System Doctor 与离线治理对比。

## 本地运行

推荐 Node.js 24。在仓库根目录执行：

```sh
npm ci
npm run dev
```

打开 [本地工作台](http://localhost:3000)。如需体验带后台生成队列的离线演示，执行：

```sh
npm run build
node scripts/start-production.mjs --demo
```

打开 [离线演示](http://127.0.0.1:3588)。演示使用独立 SQLite、虚构内容和本机替身。普通热点页也返回本机样例。演练目录与真实启动目录有双向检查。

演示启动器拒绝 Node 进程通过受检查的 HTTP、Fetch、DNS 和 TCP API 访问非回环地址。演练工具可分别拦截并记录浏览器上下文的请求，详见[自查与十分钟验收](docs/v1-release-audit.md)。

## 本机模型与可选联调

将自己的配置保存在被忽略的 `.env.local`。本机生成配置 `STUDIO_MODEL` 和 `STUDIO_MODEL_URL`，URL 指向 `127.0.0.1`。构建后按下列方式启动真实本机工作台：

```sh
node --env-file=.env.local scripts/start-production.mjs
```

- 巡航初筛使用 `STUDIO_LIGHT_MODEL_ROUTE`。`STUDIO_AUTOMATION_PRICES` 为按模型 ID 配置的输入、输出每百万 Token 人民币估算单价。缺少轻量路由或适用单价时，对应自动请求停止。
- `STUDIO_MODEL_ROUTES` 可另外声明任务分工和并发上限。`STUDIO_PYTHON_BGE_HEALTH` 可指向本机 Python BGE 健康接口，返回 `{"ready":true,"backend":"bge"}`。内置语义检索使用本机 ONNX。初始化可用 `python -m pip install pypdf`、`python scripts/index-knowledge.py`、`node scripts/download-embedding.mjs` 和 `npm run index:vectors`。
- 已获授权的真实飞书接入另启 `node --env-file=.env.local scripts/feishu-notifier.mjs --live`。通知和只读资料、台账写入使用不同配置和权限。具体前提见[联调清单](docs/v1-release-audit.md)。
- `node scripts/start-production-real.mjs` 是限定原创虚构稿的历史 DeepSeek 验收入口。它读取 `STUDIO_MODEL_KEY` 并走真实付费 API，仅在另行授权后使用。

公开版的账号和附带资料均为虚构示例。实际部署时可按自己的业务资料和账号规则配置。

## 测试

运行 `npm test`、`npm run build`、`npx tsc --noEmit`。先构建可生成项目需要的 Next.js 路由类型。依赖原部署历史数据库的回放测试在无该数据时会跳过。治理对比可从「工具与设置」打开，样本在 `evaluation/readiness-cases.json`。
