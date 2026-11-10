---
name: feature-connectors
description: 连接器市场与 MCP 授权流程功能知识入口：connectorApi 与 ConnectorMarket 的职责、connection_state 取代旧 connected/enabled、mcp.* 方法族与十分钟 hold-open 超时、自定义连接 transport/env/headers 与授权响应字段、设计取舍、OAuth/取消/解绑数据流、验收步骤，并链接 mcp、agent-management、applications
metadata:
  scope: 只收连接器市场与 MCP 授权的功能概览与六个 facet 摘要；mock 兜底移除、waitAuth 与 list 参数默认值、上传导入 Toast 与 marketSearchClient 测试等实现细节归 feature-depth-connectors，Web 前端 owner 级架构归 knowledge-web-frontend
---
# 连接器市场与 MCP 授权流程的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-connectors.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/MCP配置.md；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/AGENTS.md
- 源页字段（feature）：connectors
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/ExtensionPickerPanel.tsx；jiuwenswarm/server/agent_ws_server.py
  - jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/CliAuthModal.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/ConfirmDialog.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/EntityAvatar.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/FormPageLayout.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MarketCard.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MarketplacePage.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/PickerModal.tsx；jiuwenswarm/server/runtime/extension_package_manager.py；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/Toast.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/ConnectTokenModal.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/RegisterMcpPage.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/mcpState.ts
  - jiuwenswarm/server/runtime/mcp/registry.py；jiuwenswarm/server/runtime/mcp/state_store.py；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/McpDetailPage.tsx；jiuwenswarm/channels/web/frontend/src/types/connector.ts；jiuwenswarm/server/runtime/mcp/marketplace.py
  - jiuwenswarm/server/runtime/mcp/paths.py；jiuwenswarm/server/runtime/mcp/skill_installer.py；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/MyMarketCard.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/usePendingConnectorFlow.tsx
  - jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/PluginDetailPage.tsx；jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/UploadFileCreateModal.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/CreatePluginPage.tsx；jiuwenswarm/channels/web/frontend/src/stores/connectorStore.ts
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- 连接器市场把预置、Hub 与自定义 MCP 的目录、详情、安装和连接流程装配成 Web 界面，connectorApi 是请求与响应字段的薄适配层。当前客户端以 connection_state 表达连接状态，忽略旧 connected 与 enabled 镜像；目录中存在一项并不代表其授权和工具装配已经完成。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L1-L278)；
  - [jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L1–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L1-L320)；
  - [docs/zh/MCP配置.md:L1–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/MCP%E9%85%8D%E7%BD%AE.md#L1-L126)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 接口与调用入口（API）

- 客户端方法族是 mcp.list、show、install、uninstall、connect、wait_auth、cancel_connect、disconnect、delete_custom、register_custom 与 save_credentials。list 区分 builtin 与 local；show 内含 tools。CLI OAuth 每一步使用一次 hold-open 的 wait_auth 请求等待后端结果，连接、注册和等待授权均使用十分钟客户端超时。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L1-L278)；
  - [jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L1–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L1-L320)；
  - [docs/zh/MCP配置.md:L1–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/MCP%E9%85%8D%E7%BD%AE.md#L1-L126)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 配置入口与生效条件

- 自定义连接声明 transport、command、args、env、url、headers 与 timeout_s；传输方式对应 stdio、SSE 或 HTTP 类服务。授权响应还携带 credential_kind、fields、step_index 与 auth_url 等字段，凭据提交走 save_credentials。具体字段按连接器返回的 schema 填写；删除自定义记录与断开连接是两个不同请求。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L1-L278)；
  - [jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L1–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L1-L320)；
  - [docs/zh/MCP配置.md:L1–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/MCP%E9%85%8D%E7%BD%AE.md#L1-L126)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 设计取舍

- **设计推断**：把 OAuth 等待交给后端长请求减少前端轮询和跨步骤状态分叉，但客户端必须维持足够超时并支持取消。真实 MCP 调用失败会向调用方抛错；连接器状态不能借用插件目录的模拟兜底来推断，安装、连接与解绑也不能共用一个成功标志。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L1-L278)；
  - [jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L1–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L1-L320)；
  - [docs/zh/MCP配置.md:L1–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/MCP%E9%85%8D%E7%BD%AE.md#L1-L126)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 数据流与关联功能

- 从市场或本地目录打开详情，再安装、连接并按响应完成 token 或 OAuth 步骤；工具清单来自详情响应，后续由 Agent 的 MCP 装配使用。取消连接负责收尾挂起授权，disconnect 解绑而 delete_custom 删除自定义记录；界面应沿 source 和 connection_state 展示可用操作。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L1-L278)；
  - [jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L1–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L1-L320)；
  - [docs/zh/MCP配置.md:L1–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/MCP%E9%85%8D%E7%BD%AE.md#L1-L126)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。

### 怎样验证

- 检查 builtin 与 local 目录、自定义注册、工具详情及安装后的连接状态，分别走 token、分步 OAuth 和取消路径。用后端错误验证界面不会展示假成功，再核对 disconnect 与 delete_custom 的结果，以及慢握手不会被默认短超时误判。本页列出验收入口，未执行上游授权集成。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts:L1–L278](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/connectorApi.ts#L1-L278)；
  - [jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx:L1–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/ConnectorMarket/index.tsx#L1-L320)；
  - [docs/zh/MCP配置.md:L1–L126](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/MCP%E9%85%8D%E7%BD%AE.md#L1-L126)；
  - [jiuwenswarm/channels/web/AGENTS.md:L1–L151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/AGENTS.md#L1-L151)。
- 关联阅读：[[feature-mcp]]（mcp）；[[feature-agent-management-1]]、[[feature-agent-management-2]]（agent-management）；[[feature-applications]]（applications）。
