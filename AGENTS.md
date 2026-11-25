## 第零章：执行铁律（解除保守重构限制）

1. **禁止“打补丁式”微调**：本项目处于体验跃迁期。面对 UI 升级或交互闭环需求时，**优先新建并替换旧展示组件、重构前端展示层 Schema**，严禁为了兼容旧的灰白文本卡片布局而做局部样式修补。
2. **契约先行（Schema-First）**：动任何 UI 代码前，必须先在 `src/types/` 中定义强类型数据结构，并在 `docs/rfc/` 下输出简明字段映射方案。
3. **离线演示一等公民**：任何新增的视觉组件与状态机，必须同步更新 `--demo` 离线演示数据（`scripts/start-production.mjs --demo`），确保在无真实 API Key 环境下也能 100% 完整预览所有新交互与极端状态（如多 Agent 激烈分歧、低分预警等）。
4. **测试随新契约演进**：重构破坏旧 UI 断言时，直接按新交互契约更新 `tests/` 与 `evaluation/` 用例，确保 `npm test` 与 `npm run build` 绿色通过。

<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->
