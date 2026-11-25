# Phase 3.4｜文章编辑与版本管理（Plate）

## 人工验收修复：Eval 同源误拒绝（2026-11-03）

在原 3000 服务（build `studio-c0cf69ce17352243`）复现：Edge 请求 `/api/reviews` 的 URL 为 `http://127.0.0.1:3000/api/reviews`，Host 为 `127.0.0.1:3000`，Origin 为 `http://127.0.0.1:3000`，Referer 为同源 `/studio`，Sec-Fetch-Site 为 same-origin。以空 JSON 重放，不提供文章 ID，不产生审核或模型调用。原逻辑把 Origin 与 Next 重建的 `request.url` origin 比较，返回 403；仅将 Origin 改为 `http://localhost:3000` 就进入参数检查（400），确认内部 origin 为 localhost，而非浏览器地址。原逻辑没有检查 Referer。

仅修复 `src/app/api/reviews/route.ts`：严格限制本机 Host，核对内部端口、Origin、Referer 和 Fetch-Site，不把 localhost 与 127.0.0.1 当作任意可互换的浏览器来源，也不信任 Forwarded/X-Forwarded-Host。保留原有无 Origin 本机程序调用兼容性。没有更改 provider 或审批机制。

区别：跨域问题在路由入口返回 HTTP 403；通用文章云端 Eval 会在 `provider_setup` 被原 provider 拒绝，保存 `failed / SAFETY_ERROR` 及“Eval 仅开放本机推理；当前云端审批不包含审核”，未发送请求。已有写作审批不等于 Eval 云端审批。

新增 `tests/reviews-origin.test.ts`，并增强 `tests/article-editor.test.ts` 的完整路由→云端拒绝测试。190/190 测试、Lint、TypeScript、生产构建通过。隔离 Edge/3016 新构建 `studio-d9382a6170f6f010` 验证：合法同源空请求进入参数校验（400），Host/Origin 不同仍 403；模型调用 0，未修改历史文章。使用前需要重启原 3000 服务加载新构建。

日期：2026-11-03。范围：离线研发、数据流程与真实浏览器交互验收；没有调用真实模型，没有新增 API 费用。

## 现状核实与组件选择

实际代码已超过早期 Phase 3.2.2：具有通用任务审批、Research / Writing、分级可写性、Eval、Budget Guard 和结构化失败记录。开发前回归为 163 项。数据库原有 `versions`、`model_calls`、`reviews`；文章原先嵌在任务快照中。未修改旧业务文件、原任务快照、审批配置或 `.env.local`。

项目使用 Next.js 16.4.3、React 19.2.8、TypeScript 5.9.3。已阅读本机安装版本的 Route Handler、Client Directive、Page 文档。锁定 `platejs@53.5.2`、`@platejs/basic-nodes@53.0.0`，其 React peer 声明包含 React 19，类型检查和生产构建实际通过。复用 MIT 开源核心，不引入付费 Plus、AI kit 或后端编辑服务。

官方依据：[安装](https://platejs.org/docs/installation/manual)、[编辑器](https://platejs.org/docs/editor)、[基础块](https://platejs.org/docs/basic-blocks)、[仓库与许可证](https://github.com/udecode/plate)。使用当前 `platejs/react`、`usePlateEditor`、`PlateContent`、`withComponent` API，没有沿用旧 `@udecode/plate-*` API。

## 实现范围

- Studio 原始文章下增加“编辑文章与版本（含最新人工版本）”，进入 `/studio/editor?taskId=任务ID`。
- 标题独立输入；Plate 正文支持段落、两级标题、加粗、单层无序列表、引用。
- 800ms 防抖自动保存草稿，显示等待、保存中、已保存或失败。失败保留当前输入，可重试、导出 JSON、重新载入；未保存离开有浏览器提示。请求 15 秒超时。
- 显式保存追加正式文章；历史列表、纯文本差异、恢复旧版（创建新版）。恢复前提示当前草稿会被替换。
- 展示所选正式版本的 Eval 记录、原因、建议、引用和用量。精确核对原句与 UTF-16 偏移后定位；草稿变化时只定位正式原文片段，不误选草稿，不沿用已通过结论。新版本可通过原有审核入口请求审核。
- 没有 AI 自动改稿、接受/拒绝模型修改、多 Agent、联网发布、第三方写作规则、Plate Plus。没有扩展云端审核权限。

## 数据结构与兼容性

三个编号互不替代：

| 编号 | 含义 |
|---|---|
| `Task.revision` / `versions.rev` | 原任务执行快照；人工编辑不推进它 |
| `ArticleSnapshot.version` | 正式文章版本，Eval 的 `articleVersion` 指向它 |
| `Review.version` | 同一任务、同一文章版本的第几次审核 |
| `ArticleDraft.revision` | 草稿并发控制号，不是正式历史版本 |

新增两张表（与任务同一个 SQLite 文件，支持 `STUDIO_DB`）：

- `article_snapshots(task_id, version, payload)`：标题、Plate document、body、formatVersion、researchVersion、sourceTaskRevision、citations、origin、parentVersion、restoredFrom、createdAt、reviewLabel。`origin` 区分 model / human / restore；人工版本不记录成新模型生成。INSERT-only，数据库触发器拒绝 UPDATE / DELETE。
- `article_drafts(task_id, revision, payload)`：baseVersion、title、document、updatedAt。每个任务一个最新草稿。

按需 `CREATE TABLE IF NOT EXISTS` 增量建表，不执行旧数据重写。旧文章从其原任务快照兼容读取为虚拟正式版本，纯文本精确保留；第一次编辑才存新草稿或新版本。旧版本号继续有效。新正式编号取现有文章版本及任务快照最大值 + 1，避开已有编号；新文章保存不创建任务快照。当前任务完成后不会重新生成原文章，未来若增加重新生成能力，必须继续共用文章编号分配规则。

`sourceTaskRevision` 保存不可变来源任务，研究及引用随来源继承。Eval 读取独立文章版本并结合来源任务的研究/资料；不读取未提交草稿。历史版本恢复保留来源关联，同时记录恢复自哪个版本、父版本是谁。限定范围文章人工编辑后仍标记“限定范围草稿，待人工审核（人工编辑）”。

所有写入在 SQLite `BEGIN IMMEDIATE` 事务中比较草稿 revision 和当前正式 baseVersion。多窗口、过期自动保存、重复正式提交返回 HTTP 409，不静默覆盖，也不产生重复正式版本。响应丢失后重试可能收到 409：保留/导出输入，再重新载入确认服务器是否已保存。不会猜测合并。

## 富文本与纯文本契约 v1

- 标题单独保存，不拼进 `body`。审核 `field=title/body` 继续各自定位。
- 允许块：p、h1、h2、blockquote、li；块内 text leaf 可带 bold。
- Plate 53 内置引用使用嵌套段落；本版通过 Plate 自定义基础块实现扁平单段引用与列表，避免额外换行及偏移歧义，不支持嵌套引用。
- 块内 leaf 文本直接连接，块之间加一个 LF。列表圆点、引用边线、标题样式不进入正文文本。
- 空块、连续空行、尾部换行、原始 CR 字符、中文、emoji 均不 trim、不 Unicode 归一化。旧正文按 LF 切块，再拼接可得到完全相同的字符串。
- Plate 临时节点 id 不存储。正式 body 必须由服务端从 document 提取，客户端不能单独伪造 body。
- 审核和引用验证均使用正式 title/body，偏移采用 JavaScript UTF-16；文档位置由相同转换规则映射。引用不完全一致则不高亮、不猜位置。
- 差异是标题 + LF + body 的确定性公共前后缀比较，显示中间增删；不是语义差异，也不显示样式差异。

## 安全边界

`/api/articles` 写入要求本机 Origin 与 Host 对应、端口一致、同源 Referer / Sec-Fetch-Site；不信任代理头。只存本机内容，无模型调用。跨源请求拒绝。现有生成审批、Budget Guard、来源过滤、Gold 隔离均未改变。

现有 provider 明确限制：普通文章 Eval 只支持本机模型，固定 safe-eval 云端验收是另一条专用审批。编辑保存不授予 DeepSeek 权限；当前配置若是 DeepSeek，普通文章点击审核会明确失败并记录原因。不能把此限制描述成“新文章可直接云端审核”。

## 验证与复现

自动化新增 `tests/article-editor.test.ts`，覆盖旧文精确导入、草稿重读、CAS、追加/恢复、数据库不可变、非法文档、中文/emoji/列表/换行/重复句定位、接口来源拒绝、审核版本与云端边界。全部 174/174 测试通过；ESLint、TypeScript 和生产构建通过。

运行：

```powershell
npm test
npm run lint
npx tsc --noEmit
npm run build
node scripts/verify-article-editor.mjs
```

浏览器脚本使用独立临时 SQLite、原创虚构文章和明确标注的模拟审核记录；启动 127.0.0.1:3015 的短期生产服务，禁用模型配置，关闭后不影响现有服务。端口可通过 `EDITOR_TEST_PORT` 调整。使用本机 Microsoft Edge（Playwright），无需下载 Chromium。脚本要求已有生产构建。

浏览器结果及截图：`docs/evidence/phase3.4-browser.json`、`docs/evidence/phase3.4-editor.png`、`docs/evidence/phase3.4-review.png`。实际通过：旧文载入、重复句准确定位、草稿保存/刷新、格式编辑、正式保存、网络失败保留与重试、双窗口冲突、差异/恢复和审核隔离。浏览器未出现页面异常；临时数据库模型调用为 0。这些证明界面及持久化流程，不证明任何真实模型的审核质量。模拟数据没有进入原始业务数据库。

## 使用与故障恢复

1. 重启实际工作台服务，确认 `/api/version` 为新构建；不要仅刷新旧进程。
2. 在 `/studio` 打开已有生成文章的任务，点击“编辑文章与版本”。
3. 修改标题或正文，等待“已保存”；刷新验证草稿恢复。显式点击“保存正式版本”才进入历史。
4. 切换历史查看只读正文、对应 Eval 和差异。恢复会创建新版本，不删除旧版本。
5. 发生网络失败可重试；发生 409 先导出本窗口输入，再重新载入。不自动覆盖其他窗口。浏览器关闭前未保存输入仍可能丢失，导出是手动备份手段。
6. 新版本审核须符合原有模型和授权条件，审核结果不代表自动可发布。

限制：单层列表、无媒体/表格/协同合并；没有离线本地缓存；历史差异不包含样式；页面读取全部版本，海量长文需要后续分页；数据库文件仍采用现有本机权限模型，非多用户登录系统。编辑器可保留任意用户文字，但不会自动为新增事实补来源，仍需人工审核与既有 Eval。

## 修改入口

- `src/studio/article-document.ts`：格式契约、文本提取、定位、差异。
- `src/studio/article-store.ts`：兼容读取、独立草稿、事务/CAS、正式快照和审核解析。
- `src/app/api/articles/route.ts`：文章读取/保存接口与本机来源校验。
- `src/app/studio/editor/page.tsx`、`src/components/ArticleWorkspace.tsx`、`article-editor.css`：编辑与版本界面。
- `src/components/ArticleReview.tsx`、`src/studio/eval.ts`：版本绑定和引用定位最小接入。
- `src/app/studio/page.tsx`：编辑入口；保留原始生成版本显示。
- `tests/article-editor.test.ts`、`scripts/verify-article-editor.mjs`：离线及浏览器验收。
- `package.json`、`package-lock.json`：锁定 Plate 和浏览器测试依赖；README 与本报告。
