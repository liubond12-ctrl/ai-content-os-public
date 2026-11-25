# Phase 3.2.0 离线交付

在 /studio 选择默认的「通用创作」，输入主题与图文文章、口播稿或短视频脚本，可选填受众、目标、风格或特殊要求。启动资料准备后可展开每个命中的方法、适用与不适用场景以及来源。取回旧任务仍使用原任务编号。显式切换历史实验账号可继续使用原页面能力。

## 数据与执行路径

旧账号流程继续使用原 Phase 1 装配器和业务 RAG。通用任务可以不传账号，服务端保存独立 general 配置；通用规则、任务字段和哈希构成上下文。通用初检及研究补查均使用独立的 general 参考库，只将方法摘要送进证据包。文章原文留在案例浏览端。文件、索引、旧版本和 SQLite 任务日志无需迁移。safe-demo 仍需原场景、哈希与人工审核。

参考集包含四个原创虚构样本，分属出行、烹饪、手工和零售表达。结构包括稳定 ID、版本、标题、原文、形式、创作目标、多选技法、可迁移方法、适用/不适用场景、质量标签、来源、使用权限、创建时间及外发标志。通用库是一个固定的独立工作区，不能通过请求指定业务知识库路径、其他工作区或任意数据源。没有建设多用户认证界面。

Keyword 复用词面检索；Semantic 使用本机 BGE 为方法、标签等编码；Hybrid 采用既有 RRF 对语义与关键词排名融合。之后以格式、目标和技法匹配调整候选排序。明确匹配的形式也能形成弱候选，即列表不等于每条都适合当前选题。来源标记为 expression-rule，verified 为 false。Research 可继续在同一工作区检索，Writing 使用已有研究版本和引用校验。考试日期等事实不足时会阻塞。没有外部行业事实来源，不能将新工作台理解为开放领域事实问答。

行业、公司、品牌及账号扩展契约只保留 kind、workspaceId、collectionId、version；当前启用列表为空。通用任务不能获得 DeepSeek 云端授权，即便单条案例标记 allowExternal 为 true 也不构成任务授权。本机模型生成代码可用，质量尚未做真实联调。

## 导入与验证

以下是单条原创参考案例 JSON 文件示例。在工作台展开「导入一条原创或获许可的参考案例」选择文件。也可 POST 到 /api/references，GET 浏览案例。新数据保存在 data/content-library.sqlite；重复 ID 与版本被拒绝，增版本保留旧行，检索使用每个 ID 的最新版本。

```json
{
  "id":"museum-opening","version":1,"title":"缺了一角的展签",
  "content":"观众先看到缺口，才注意到展签上的修复记录。","format":"口播稿",
  "goal":"引发好奇","tags":["开头钩子","悬念"],
  "method":"先写可以观察到的异常，再提出能在下文回答的问题。",
  "applies":"展览导览与故事开场","avoid":"没有核实来源的历史细节",
  "quality":["正面示例"],"source":"自编虚构练习","rights":"原创",
  "createdAt":"2026-11-02T00:00:00Z","allowExternal":false
}
```

真实优质内容需先确认原文使用权、记录出处、人工提炼可迁移方法、分别注明适用和不适用情境。导入声明由录入者负责，软件未验证第三方版权。当前授权类型仅支持原创和已获许可。

Eval 使用独立 eval_cases 表与 /api/eval-cases 路由。GET 读取，POST 接收 `{humanReviewed:true,item:{...}}`。item 的共同字段为 id、version、content、source、rights、createdAt、allowExternal；评审字段为 reviewer、label（优秀/普通/不合格）、dimensions、rationale、locations、positiveExample、negativeExample、scenario、tags，可附 referenceId。引用只作关联，不会将评审理由或标签带入 RAG。首次安装没有预填人工标准答案。声明并不认证评审者身份，当前用途为本机人工维护。

## 修改与验收

新增 src/studio/library.ts（契约、原创样例、独立存储与检索）、src/app/api/references/route.ts、src/app/api/eval-cases/route.ts、tests/general.test.ts。调整 tasks.ts 和 agents.ts 分派通用装配/检索，safe-demo.ts 明确历史兼容 persona 类型，src/rag/search.ts 复用证据打包，/studio 表单增加形式与导入。更新 README 和 SQLite 文件忽略规则。

离线验证使用真实任务 Route Handler 和本地 BGE：跨行业口播任务按「开头钩子」找到方法；业务索引与业务规则装配器调用次数为零；案例原文未进入研究证据；云端生成被拒绝；人工 Eval 测试样本独立读写，三种模式检索均未读到测试标签。测试使用的人工评审数据为临时测试夹具，不作为正式金标准。

验证命令为 npm test、npm run lint、node node_modules/typescript/bin/tsc --noEmit --incremental false、npm run build。100 项自动化测试通过，其中 98 项是原有回归。未调用真实 DeepSeek，也未做浏览器点击或真实文章质量验收。小型语义索引按查询计算，较大资料库需要后续缓存、去重及独立检索质量评估。
