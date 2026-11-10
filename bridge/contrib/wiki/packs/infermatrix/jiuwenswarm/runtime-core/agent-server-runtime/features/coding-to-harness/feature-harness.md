---
name: feature-harness
description: Agent Loop 与 Rail 装配功能入口：Harness 的 Agent 循环、工具与生命周期 rail 组合、get_runtime_tool_session_id/init_permission_engine/build_model_from_entry 等入口、PLAYWRIGHT_RUNTIME_MCP_ENABLED 等环境变量名、设计推断、与模式/Hooks/子代理的关联及验证步骤
metadata:
  scope: 只收该功能的职责、接口、环境变量、设计取舍、关联功能与验证六节；实现级证据归 feature-depth-harness
---
# Agent Loop 与 Rail 装配 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-harness.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Harness.md
- 源页字段（feature）：harness
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_deep.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/agents/harness/common/rails/*；jiuwenswarm/agents/harness/common/rails/avatar_rail.py；jiuwenswarm/runtime/service.py；jiuwenswarm/agents/harness/common/rails/execution_guard/circuit_breaker_rail.py
  - jiuwenswarm/server/runtime/agent_adapter/interface_code.py；jiuwenswarm/agents/harness/code/rails/__init__.py；jiuwenswarm/agents/harness/code/rails/code_agent_mode_rail.py；jiuwenswarm/agents/harness/code/prompt/__init__.py
  - jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py；jiuwenswarm/agents/harness/code/spec.py；jiuwenswarm/agents/harness/common/rails/runtime_prompt_rail.py；jiuwenswarm/agents/harness/common/prompt/prompt_builder.py；jiuwenswarm/agents/harness/common/tools/__init__.py
  - jiuwenswarm/server/runtime/agent_adapter/interface.py；jiuwenswarm/agents/harness/common/rails/interrupt/interrupt_helpers.py；jiuwenswarm/agents/harness/common/rails/permissions/permission_interrupt_rail.py；jiuwenswarm/server/agent_ws_server.py
  - jiuwenswarm/agents/harness/common/tools/mcp_toolkits.py；jiuwenswarm/agents/harness/common/rails/permissions/network_scope.py；jiuwenswarm/server/runtime/agent_adapter/output_handoff.py；jiuwenswarm/agents/harness/common/rails/permissions/permission_interaction.py
  - jiuwenswarm/server/runtime/agent_adapter/permission_rail_group.py；jiuwenswarm/common/permission_tools.py；jiuwenswarm/agents/harness/common/rails/__init__.py；jiuwenswarm/agents/harness/common/plugins/rail_manager.py
  - jiuwenswarm/agents/harness/common/rails/response_prompt_rail.py；jiuwenswarm/runtime/events.py；jiuwenswarm/runtime/context.py；jiuwenswarm/runtime/host_services.py；jiuwenswarm/runtime/interaction.py；jiuwenswarm/runtime/session/coordinator.py
  - jiuwenswarm/server/runtime/session/session_manager.py；jiuwenswarm/runtime/session/work_scheduler.py；jiuwenswarm/agents/harness/common/prompt/shell_environment.py；jiuwenswarm/agents/harness/common/rails/stream_event_rail.py；jiuwenswarm/agents/swarm/providers/builtin_rails.py
  - jiuwenswarm/agents/swarm/providers/code_rails.py；jiuwenswarm/agents/harness/team/team_manager.py；jiuwenswarm/agents/swarm/providers/member_rails.py；jiuwenswarm/agents/swarm/registry.py；jiuwenswarm/agents/swarm/providers/runtime_tools.py
  - jiuwenswarm/agents/swarm/config_specs.py；jiuwenswarm/agents/swarm/providers/code_subagents.py；jiuwenswarm/agents/harness/common/rails/symphony/retrieval_context_processor.py；jiuwenswarm/agents/harness/common/rails/symphony/tool_stream_events.py
  - jiuwenswarm/agents/harness/common/prompt/priority_registry.py；jiuwenswarm/agents/harness/team/team_runtime_inheritance.py；jiuwenswarm/agents/harness/common/rails/permissions/tool_binding.py
  - jiuwenswarm/agents/harness/common/rails/permissions/_auto_permission/invocation_context.py；jiuwenswarm/agents/harness/common/rails/permissions/tool_permission_context.py；jiuwenswarm/agents/harness/common/tool_progress_context.py
  - jiuwenswarm/agents/harness/work/prompt/work_plan_prompts.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- Harness 通过 Agent 循环、工具与生命周期 rail 组合运行行为。一个能力是否可用取决于装配参数、宿主 backend、权限与运行环境。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `get_runtime_tool_session_id()`；`init_permission_engine()`；`build_model_from_entry(mcc, mco)`；`parse_int(value, default)`；`parse_optional_int(value)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 配置入口与生效条件

- 实现中直接读取的环境变量名称包括 `PLAYWRIGHT_RUNTIME_MCP_ENABLED`、`BROWSER_RUNTIME_MCP_ENABLED`、`BROWSER_DRIVER`、`VISION_API_KEY`、`VISION_BASE_URL`；名称与实际部署值分开核对。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 设计取舍

- **设计推断**：Rail 按生命周期组合规划、权限、上下文和工具，便于独立扩展执行能力；代价是注册顺序、重复注册、卸载和宿主服务注入会影响组合效果。源码有 Rail 类型并不代表当前模式或已安装 agent-core 提供了该能力。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 数据流与关联功能

- Harness 通过 Agent 循环、工具与生命周期 rail 组合运行行为。一个能力是否可用取决于装配参数、宿主 backend、权限与运行环境。 联调时结合[[feature-modes]]（Agent、Code 与 Team 模式）、[[feature-hooks]]（生命周期 Hooks 与扩展）、[[feature-subagents]]（子代理派发与验证）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 怎样验证

- 用最小 Agent 跑一轮模型与工具调用，核对生命周期事件和工具集合。按模式验证 rail 装配与卸载，覆盖缺少 backend、依赖版本不匹配及重复注册；再检查取消后的工具和资源清理。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L1–L19672](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L1-L19672)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。
