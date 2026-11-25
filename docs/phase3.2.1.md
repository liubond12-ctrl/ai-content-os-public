# Phase 3.2.1 中文验收报告

使用 Node 24 在项目目录执行 npm run build，随后运行 npm run start -- --hostname 127.0.0.1 --port 3000。已有旧生产服务时需重启以加载新路由。打开 /studio/cases，或从 /studio 的管理入口进入。

## 操作

- 参考库可按技法、形式、目标筛选，关键词支持词面、语义和混合检索。点列表项查看原文、事实备注、方法、适用边界及来源。新建、保存下一版本或确认移除。已有版本不覆盖，过期编辑返回冲突。删除是逻辑移除，仍保留原记录，不再供 RAG 使用。
- Eval 页填写人工标签、评审人、维度、理由、正反例等。问题片段填 JSON，如 `[{"offset":0,"quote":"开头","severe":true}]`；偏移按 JavaScript UTF-16 字符串位置计算，保存时核验与原文一致。AI 建议单独填写，不会自动变为人工标签。未勾选人工确认不能提交；尚未确认的编辑只在页面内存在。
- 独立验收集、待分集、标注历史和全库统计需要人工评审密钥。在本机服务端设置单独的 `STUDIO_EVAL_REVIEW_KEY`，重启后在人工作业页面的密码框输入同一值并查询。不要将此密钥提供给待测 Agent。本项目没有修改用户环境文件。页面不将密钥写入 URL 或浏览器持久存储。
- 可以先确认为“已确认，待分集”，再编辑为开发或独立验收集并保存新版本。已用于开发的 ID、同一原文或同一关联参考不能再分配给独立集。统计按每个 ID 最新版本计数，不累加旧标签。

## 用途隔离与测试基础

创作检索只使用参考表的方法、标签、格式及适用边界，不读取事实备注或 Eval 表。初始四个参考样例均标记 synthetic，没有预置人工 Gold。旧版人工确认记录按开发集读取，新增版本可补录更细的字段。

后续待测端应使用 GET /api/eval-cases?view=inputs。白名单字段仅为案例 ID、版本、集合、原文、形式、目标与四项通用评价规则。待分集不参与。人工端通过 x-review-key 请求 history 或 stats；默认兼容接口仅返回开发标注。追加版本通过 POST /api/eval-cases 提交 `{humanReviewed:true,item:{...}}`。评审时间由服务端写入。

按 (id, version) 对齐将来的预测与已确认标签，可统计一致率；用 issues 的 severe 标记及真实标签统计严重错误漏放，用优秀标签统计优质内容误判；用 offset、quote 匹配问题定位。本轮未生成预测或计算指标。单用户本地服务、数据库文件和评审密钥属于可信人工管理边界；盲测接口不防御直接读取本机数据库的进程。独立案例的 ID、原文本身及外部副本也应由人工检查，避免将答案写入题目或以改写副本跨集泄漏。

## 导入格式

创作案例继续使用 [3.2.0 的单条 JSON 示例](phase3.2.0.md)，可增加 `"synthetic":false` 与 `"facts":"仅供人工查看的原文事实说明"`。新 ID 从版本 1 开始，更新传当前版本加 1。不允许假定训练表现、效果或第三方版权。Eval 项目包含 id、version、source、rights、createdAt、allowExternal、synthetic、content、format、goal、tags、scenario、label、reviewer、dimensions、rationale、locations、issues、positiveExample、negativeExample 和 split；referenceId、suggestion、aiSuggestion 可选。明确原文使用许可后再导入。

## 验证与文件

修改 src/studio/library.ts、两个案例 Route Handler、src/app/studio/page.tsx、tests/general.test.ts 和 README.md；新增 src/app/studio/cases/page.tsx 与本报告。

全量 102/102 测试、ESLint、独立 TypeScript、生产构建通过。生产 HTTP 冒烟验证管理页返回 200、四条样例均为 synthetic、无评审密钥读取标注历史返回 403。未做浏览器逐控件交互验收。DeepSeek 真实调用 0 次，无额外 API 费用。
