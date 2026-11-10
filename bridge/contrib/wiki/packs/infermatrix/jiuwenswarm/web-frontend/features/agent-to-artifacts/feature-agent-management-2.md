---
name: feature-agent-management-2
description: 智能体资产管理功能知识入口（下）：AgentDraft/AgentGroupDraft 配置与 pending 安装队列、设计取舍与旧工作区浏览（AgentPanel）的版本差异、数据流与关联功能、验收步骤
metadata:
  scope: 只收配置入口与生效条件、设计取舍、数据流与关联功能、怎样验证四节；职责边界与接口清单归 feature-agent-management-1，实现细节归 feature-depth-agent-management
---
# 智能体资产管理与工作区浏览的职责、接口与配置（2/2）

## 关键事实

- 拆分说明：本页是源页 `feature-agent-management.md` 的第 2/2 部分；第 1 部分 [[feature-agent-management-1]]
- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-agent-management.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01

### 配置入口与生效条件

- 资产编辑使用 AgentDraft 和 AgentGroupDraft 等数据结构，连接、技能和 MCP 选项属于资产定义输入而非任意全局环境变量。目录视图含安装状态与 pending 队列；原工作区浏览组件只预览支持的文件类型并过滤忽略目录，身份和配置文件内容仍以实际工作区为准。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx:L1–L1693](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx#L1-L1693)；
  - [jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L1–L372](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L1-L372)；
  - [jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx:L1–L528](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx#L1-L528)；
  - [docs/zh/智能体.md:L1–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%99%BA%E8%83%BD%E4%BD%93.md#L1-L443)。

### 设计取舍

- **设计推断**：目录、详情和安装队列分层便于管理远端与本地资产，代价是缓存、安装状态和真实可用能力必须同步。工作区文件浏览与可安装模板不是同一类数据；上游智能体文档仍描述浏览页，当前主 App 已装配资产管理页，知识使用时需处理这处文档与界面的版本差异。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx:L1–L1693](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx#L1-L1693)；
  - [jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L1–L372](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L1-L372)；
  - [jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx:L1–L528](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx#L1-L528)；
  - [docs/zh/智能体.md:L1–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%99%BA%E8%83%BD%E4%BD%93.md#L1-L443)。

### 数据流与关联功能

- 选择资产从目录进入详情，再经宿主回调用于对话或团队；创建、更新、导入和安装通过版本化请求返回状态。工作区预览用于查看身份、记忆和运行文件，与模型设置、会话管理及技能安装有各自归属，不能把资产被列出解释成所有依赖已准备好。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx:L1–L1693](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx#L1-L1693)；
  - [jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L1–L372](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L1-L372)；
  - [jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx:L1–L528](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx#L1-L528)；
  - [docs/zh/智能体.md:L1–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%99%BA%E8%83%BD%E4%BD%93.md#L1-L443)。

### 怎样验证

- 检查智能体与团队目录、详情、创建编辑和安装卸载的状态一致性，覆盖 pending 安装与连接依赖。使用资产后核对宿主选中项和实际装配；若启用工作区浏览则检查目录过滤、预览与 session 归属。这些是建议验收步骤，本页未记录上游测试已执行。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx:L1–L1693](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx#L1-L1693)；
  - [jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L1–L372](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L1-L372)；
  - [jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx:L1–L528](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx#L1-L528)；
  - [docs/zh/智能体.md:L1–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%99%BA%E8%83%BD%E4%BD%93.md#L1-L443)。
