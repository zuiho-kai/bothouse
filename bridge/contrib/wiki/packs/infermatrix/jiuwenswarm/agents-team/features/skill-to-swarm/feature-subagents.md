---
name: feature-subagents
description: 子代理派发与验证功能概览：同步 task_tool 与异步 sessions_spawn / sessions_list / sessions_cancel、SubagentRail 装配、verification_agent 只读约束与验证步骤
metadata:
  scope: 只收子代理派发与验证的职责、接口入口、配置入口、设计取舍与验证方法（guide）；statusline 构造链、code_agent 共享 rail 与 resume 守卫等实现细节归 feature-depth-subagents
---
# 子代理派发与验证 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-subagents.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/swarm/providers/code_subagents.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/subagent_compat.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Harness.md
- 源页字段（feature）：subagents
- 入口（entry_points）：jiuwenswarm/agents/swarm/providers/code_subagents.py；jiuwenswarm/agents/harness/common/tools/subagent_compat.py
- 源页字段（source_globs）：jiuwenswarm/agents/swarm/providers/code_subagents.py；jiuwenswarm/agents/harness/common/tools/subagent_compat.py；jiuwenswarm/agents/harness/common/rails/*；jiuwenswarm/server/runtime/agent_config_service.py；jiuwenswarm/agents/harness/common/prompt/browser_task_prompt.py
  - jiuwenswarm/agents/harness/common/rails/browser_task_prompt_rail.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/agents/harness/common/tools/multi_session_toolkits.py；jiuwenswarm/common/config.py
  - jiuwenswarm/channels/web/frontend/src/types/subagent.ts；jiuwenswarm/channels/web/frontend/src/components/subagent/Subagent.css；jiuwenswarm/channels/web/frontend/src/components/subagent/SubagentCompactPanel.tsx
  - jiuwenswarm/channels/web/frontend/src/components/subagent/SubagentExpandedPanel.tsx；jiuwenswarm/channels/web/frontend/src/components/subagent/SubagentStatusIcon.tsx；jiuwenswarm/agents/swarm/providers/code_rails.py；jiuwenswarm/server/runtime/agent_adapter/task_tool_events.py
  - jiuwenswarm/channels/web/frontend/src/features/subagent/subagentActivityPresentation.ts；jiuwenswarm/channels/web/frontend/src/features/subagent/subagentStatusPresentation.ts；jiuwenswarm/channels/web/frontend/src/features/historyRestore.ts
  - jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/features/subagent/subagentNormalizer.ts；jiuwenswarm/channels/web/frontend/src/stores/subagentStore.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 子代理能力由 rail 和子代理配置装配，可能采用同步任务或异步会话形式。父代理需要处理结果汇合、取消和验证边界，派发成功不代表工作已完成。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L1–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L1-L255)；
  - [jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L1–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/subagent_compat.py#L1-L54)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 接口与调用入口（API）

- 同步委派使用 task_tool；异步委派使用 sessions_spawn、sessions_list、sessions_cancel，由 SessionToolkit 管理后台状态。代码侧 providers 与 subagent_compat 负责装配和兼容，verification_agent 还受验证 Rail 约束；这些工具接口依赖当前 Agent 配置，不等同于全仓固定 HTTP API。
- 源码与文档：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L1–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L1-L255)；
  - [jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L1–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/subagent_compat.py#L1-L54)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 配置入口与生效条件

- Harness 文档将 subagents 配置与 SubagentRail 自动装配关联，enable_async_subagent 决定同步或异步工具形态。具体宿主还提供预配置子代理和兼容工具；是否暴露给当前模式应核对 providers 的装配结果，不能仅由配置对象存在判断可调用。
- 源码与文档：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L1–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L1-L255)；
  - [jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L1–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/subagent_compat.py#L1-L54)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 设计取舍

- **设计推断**：同步委派便于立即汇合，异步 session tools 允许父代理持续推进但增加查询、取消和结果汇合责任。验证代理受只读与工具范围约束，降低修改自身待验产物的干扰；代价是父代理仍需依据验证结论判断是否满足用户目标。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L1–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L1-L255)；
  - [jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L1–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/subagent_compat.py#L1-L54)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 数据流与关联功能

- 子代理能力由 rail 和子代理配置装配，可能采用同步任务或异步会话形式。父代理需要处理结果汇合、取消和验证边界，派发成功不代表工作已完成。 联调时结合[[feature-harness]]（Agent Loop 与 Rail 装配）、[[feature-planning]]（任务规划与 Todo）、[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L1–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L1-L255)；
  - [jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L1–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/subagent_compat.py#L1-L54)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 怎样验证

- 分别验证同步子任务返回与异步 spawn、list、cancel 的状态关联。检查父代理取消、子代理失败和结果汇合，再验证 verification_agent 不能修改项目文件且能读取变更、执行允许的检查并报告证据。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/swarm/providers/code_subagents.py:L1–L255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/swarm/providers/code_subagents.py#L1-L255)；
  - [jiuwenswarm/agents/harness/common/tools/subagent_compat.py:L1–L54](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/subagent_compat.py#L1-L54)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。
