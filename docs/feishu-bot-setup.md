# AI Content OS 资料助手｜创建与接入单

状态（2026-11-05）：已在当前组织创建企业自建应用「AI Content OS 资料助手」并添加机器人能力，已打开[机器人配置页](https://open.feishu.cn/app/cli_aa61ca5a77b89d3e/bot)核对。App ID 为 cli_aa61ca5a77b89d3e。应用待发布，目标表只读权限、凭证配置及实际同步尚待办理。

| 用途 | 接口或组件 | 本项目用法 |
|---|---|---|
| 获取应用身份凭证 | POST https://open.feishu.cn/open-apis/auth/v3/tenant_access_token/internal | 服务端用 App ID、App Secret 换取短期 tenant_access_token。按响应的有效期续期。现有工作台只接收现成 Token，尚无自动换取与续期。 |
| 读取指定表 | POST https://open.feishu.cn/open-apis/bitable/v1/apps/{app_token}/tables/{table_id}/records/search | Bearer 身份，field_names 仅列标题、方法、更新时间；当前实现每页100条，处理后续页。此 POST 是查询。 |
| 可选的 Agent 工具入口 | 官方 lark-openapi-mcp，本地包 @larksuiteoapi/lark-mcp | 本阶段优先沿用现有 API 的表与字段限制。以后需要对话查询时再配置独立只读工具白名单，并在调用前复核表 ID、字段与用途。仅限制工具名不能限制可读取哪张表。 |

## 开通顺序

1. 用户在 ego 登录预期组织；核对应用归属，创建自建应用并添加机器人能力。机器人本轮用途是资料接入，不需要启用收发消息、群聊事件或 webhook。
2. 在开放平台根据记录查询文档选择满足调用的最小只读权限。按组织要求创建版本并申请发布；需要管理员批准时将具体权限交管理员核对。应用权限与多维表格资源访问权分别核实。
3. 表所有者提供目标表链接和三列的准确列名，为应用身份授予指定资源的读取权。首测推荐新建一张虚构资料表，不使用私人文章或业务明细。
4. 配置在本机服务端；App Secret、Bearer Token 不写入聊天、仓库或记录截图。当前 src/studio/feishu.ts 的 STUDIO_FEISHU_SCOPE 结构示例（下列用途为建议，须由资料所有者确认）：

    {"app":"表格appToken","table":"数据表tableId","fields":{"title":"标题","method":"写作方法","updated":"更新时间"},"permissions":{"store":true,"create":true,"evaluate":false,"external":false}}

5. 将有效只读身份凭证作为 STUDIO_FEISHU_TOKEN 注入服务端。确认授权后用非演示实例读取测试表，对照三列、变更和重复同步；凭证过期后检查错误提示。付费模型、向第三方发送资料及发送飞书消息均需要各自的用途授权。

[记录查询](https://open.feishu.cn/document/server-docs/docs/bitable-v1/app-table-record/search) · [自建应用访问凭证](https://open.feishu.cn/document/server-docs/authentication-management/access-token/tenant_access_token_internal) · [官方 MCP](https://github.com/larksuite/lark-openapi-mcp)
