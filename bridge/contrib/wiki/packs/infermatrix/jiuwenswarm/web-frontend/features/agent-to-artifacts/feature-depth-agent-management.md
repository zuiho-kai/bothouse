---
name: feature-depth-agent-management
description: 智能体资产管理实现深读：installDefinition 的 auth_required 与 AgentInstallPendingError 契约、listSkillOptions 渐进式团队市场与默认 options、client 对 agentCatalogStore 的失效调用、标签补全 allSettled 降级、node:test 用例断言
metadata:
  scope: 收 AgentManagementPanel 客户端（client.ts）实现级证据与设计推断，来源另含 agentCatalogStore.ts、index.tsx；功能概览、接口清单与验收步骤归 feature-agent-management-1、feature-agent-management-2，Web 前端 owner 级架构归 knowledge-web-frontend
---
# 智能体资产管理与工作区浏览：实现深读

## 现状

- [[feature-agent-management-1]]、[[feature-agent-management-2]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **installDefinition 的结果契约** client.installDefinition 返回带 kind 字段的结果：调用方 handleInstall 在 result.kind === 'auth_required' 时抛出 t('agentManagement.states.authRequired') 中止流程；当安装因连接器未就绪抛出 AgentInstallPendingError 时，错误对象携带 pendingConnectors 列表，面板据此把任务入队等待连接完成后重试。调用方义务是捕获该错误类型而非当作普通失败。
- 来源：[jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx:L984–L1004](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx#L984-L1004)
- **listSkillOptions 在 includeTeamMarketplace 且提供回调时先返回基础列表，后台再拉团队市场** listSkillOptions 先以 with_installed:true 调 skills.list，过滤 source!=='mcp' 后归一化；
  - 当 includeTeamMarketplace 且传入 onTeamMarketplaceLoaded 时立即返回基础列表，并在 setTimeout(0) 中请求 skills.swarmskillshub.recommend（top_k:500、cache_mode:'prefer_cache'、timeoutMs:30000），success 非 false 才回调合并列表与 cache。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L166–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L166-L207)
- **listSkillOptions 默认 options={}：未传 includeTeamMarketplace 不请求 Hub** options 默认为空对象：未传 includeTeamMarketplace 时直接返回 skills.list 的归一结果，不发起 Hub 请求；传了它但未传 onTeamMarketplaceLoaded 时保持旧的同 await 合并路径，且 teamMarketplace.success===false 时只返回本地列表。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L166–L187](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L166-L187)
- **client 依赖 agentCatalogStore：删除/安装 webRequest 成功后失效目录，导入仅在 payload.id 非空时** client.ts 导入 invalidateAgentCatalog，并在 'agent_templates.delete' 与 'agent_templates.install' 的 await webRequest 成功后调用，store 随即置 catalog=null、status='idle' 并递增 revision；'
  - agent_templates.import_local' 仅当 payload.id 非空才失效，为空则抛 code 'agent_import_empty' 的 AgentManagementError 并跳过失效。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L1–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L1-L45),
  - [jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L327–L349](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L327-L349),
  - [jiuwenswarm/channels/web/frontend/src/stores/agentCatalogStore.ts:L35–L42](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/agentCatalogStore.ts#L35-L42)
- **标签补全失败时 allSettled 丢弃失败项，卡片按原 tags 原样返回** 触发：某卡片 tags 为空且 agent_templates.show 抛错（或返回空 template，抛 code 'agent_detail_empty'）；守护分支：Promise.allSettled 仅收 status==='fulfilled' 且 tags.length>0 的结果；恢复：未补全卡片保持原 tags（如 []）返回，不向上抛错。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L83–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L83-L108),
  - [jiuwenswarm/channels/web/frontend/tests/agentManagementClient.test.mjs:L42–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/agentManagementClient.test.mjs#L42-L51)
- **渐进式团队市场让选择器即刻可用，代价是 Hub 失败被静默吞掉** 设计推断（非作者历史意图）：
- 收益（推断）：基础列表先返回，慢速 Hub 不阻塞选择器（与 189 行注释一致）；成本（推断）：该路径 Hub 请求失败只进 .catch(() => {})，onTeamMarketplaceLoaded 收不到失败通知，调用方无法区分『无市场数据』与『市场故障』。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L182–L203](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts#L182-L203)
- **node:test 用例运行 esbuild 打包后的真实 client 并断言标签降级保留** 用例先以 esbuild 打包 src/features/agentManagement/client.ts 与 services/webClient.ts 并动态导入，把 webClient.request stub 为 detail 请求抛 'Remote detail is unavailable'，断言 listCatalog({enrichTags:true}) 仍返回 items[0].id==='cached'、tags 深等于 [] 且 cache 元数据保留。
- 来源：[jiuwenswarm/channels/web/frontend/tests/agentManagementClient.test.mjs:L4–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/agentManagementClient.test.mjs#L4-L16),
  - [jiuwenswarm/channels/web/frontend/tests/agentManagementClient.test.mjs:L42–L51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/agentManagementClient.test.mjs#L42-L51)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-agent-management.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx:L984-L1004
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L166-L207
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L166-L187
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L83-L108
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/agentManagementClient.test.mjs:L42-L51
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L182-L203
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/agentManagementClient.test.mjs:L4-L16
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L1-L45
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts:L327-L349
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/stores/agentCatalogStore.ts:L35-L42
- 源页字段（feature）：agent-management
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts；jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/components/AgentManagementPanel/index.tsx；jiuwenswarm/channels/web/frontend/src/features/agentManagement/client.ts；jiuwenswarm/channels/web/frontend/src/components/AgentPanel/index.tsx
