---
name: feature-agent-management-1
description: 智能体资产管理（AgentManagementPanel）功能知识入口（上）：目录/详情/创建/安装视图与 client.ts 归一化的职责边界，agent_templates.* 请求清单与 onUseAgent/onUseAgentGroup 回调
metadata:
  scope: 只收职责与边界、接口与调用入口两节；配置入口、设计取舍、数据流与验收步骤归 feature-agent-management-2，installDefinition 与 listSkillOptions 等实现细节归 feature-depth-agent-management
---
# 智能体资产管理与工作区浏览的职责、接口与配置（1/2）

## 关键事实

- 拆分说明：本页是源页 `feature-agent-management.md` 的第 1/2 部分；第 2 部分 [[feature-agent-management-2]]
- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-agent-management.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/智能体.md
- 源页字段（feature）：agent-management
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts；jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts；jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx
  - jiuwenswarm/channels/web/frontend/src/components/AgentAvatar/index.tsx；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/MessageItem.tsx；jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/CatalogPage.tsx
  - jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionCard.tsx；jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionDetailPage.tsx
  - jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/DefinitionFilePreview.tsx；jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupUploadDialog.tsx
  - jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentUploadDialog.tsx；jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentEditor.tsx；jiuwenswarm/scripts/generate-agent-folders.js；jiuwenswarm/scripts/watch-folders.js
  - jiuwenswarm/server/runtime/extension_package_manager.py；jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/GroupCard.tsx；jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/GroupCatalogPage.tsx
  - jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupDetailPage.tsx；jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupEditor.tsx
  - jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentGroupMemberPicker.tsx；jiuwenswarm/resources/agent/workspace/skills/agent-group-creator/scripts/register_group.py
  - jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/SelectionPagination.tsx；jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/AgentTagPicker.tsx；jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/init_template.py
  - jiuwenswarm/resources/agent/workspace/skills/agent-creator/scripts/register_template.py；jiuwenswarm/server/runtime/agent_config_service.py；jiuwenswarm/channels/web/app_web.py；jiuwenswarm/server/runtime/skill/skill_manager.py；jiuwenswarm/channels/web/frontend/vite.config.ts
  - jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/useDialogFocusTrap.ts；jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewPanel.css；jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewPanel.tsx
  - jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/filePreviewShared.ts；jiuwenswarm/channels/web/frontend/src/components/ui/FilePreviewPanel/FilePreviewTree.tsx；jiuwenswarm/server/runtime/agent_adapter/interface.py
  - jiuwenswarm/resources/agent/workspace/skills/plugin-creator/scripts/register_plugin.py；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/agents.ts；jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts
  - jiuwenswarm/channels/web/frontend/src/components/AgentPanel/FileViewer.tsx；jiuwenswarm/channels/web/frontend/src/stores/agentCatalogStore.ts；jiuwenswarm/channels/web/frontend/src/stores/agentGroupCatalogSeed.ts；jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
  - jiuwenswarm/channels/web/frontend/src/features/agentManagement/groupClient.ts；jiuwenswarm/channels/web/frontend/src/features/agentManagement/port.ts；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx
  - jiuwenswarm/channels/web/frontend/src/features/agentManagement/adapter.ts；jiuwenswarm/channels/web/frontend/src/features/agentManagement/limits.ts；jiuwenswarm/channels/web/frontend/src/features/agentManagement/tagOptions.ts
  - jiuwenswarm/channels/web/frontend/src/features/agentManagement/pendingInstallQueue.ts；jiuwenswarm/channels/web/frontend/src/features/agentManagement/upload.ts；jiuwenswarm/channels/web/frontend/src/features/agentIdentity.ts
  - jiuwenswarm/channels/web/frontend/src/features/catalogCache.ts；jiuwenswarm/channels/web/frontend/src/features/equipmentListRequest.ts；jiuwenswarm/channels/web/frontend/src/features/equipmentMarketplace.ts；jiuwenswarm/channels/web/frontend/src/features/historyFilePreview.ts
  - jiuwenswarm/channels/web/frontend/src/features/agentManagement/selection.ts
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- 当前 Web App 装配 AgentManagementPanel，提供智能体及团队资产的目录、详情、创建与安装等视图；client.ts 负责请求和响应归一化。文档中的工作区文件浏览对应 AgentPanel 的目录树与预览实现，它与资产配置编辑是不同边界，是否挂载该旧浏览入口需沿宿主 App 核对。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx:L1–L1693](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx#L1-L1693)；
  - [jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L1–L372](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L1-L372)；
  - [jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx:L1–L528](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx#L1-L528)；
  - [docs/zh/智能体.md:L1–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%99%BA%E8%83%BD%E4%BD%93.md#L1-L443)。

### 接口与调用入口（API）

- 资产客户端使用 agent_templates.list、show、file.list、file.read、create、update、delete、import_local、install 与 uninstall 等请求。团队资产另由 group client 管理，面板通过 onUseAgent 与 onUseAgentGroup 将选择交给宿主；工作区浏览组件的 sessionId 与文件路径不是模板资产的 id。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx:L1–L1693](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx#L1-L1693)；
  - [jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L1–L372](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L1-L372)；
  - [jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx:L1–L528](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx#L1-L528)；
  - [docs/zh/智能体.md:L1–L443](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%99%BA%E8%83%BD%E4%BD%93.md#L1-L443)。
