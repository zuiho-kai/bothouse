---
name: jiuwenswarm-runtime
description: 共享 Agent Runtime（jiuwenswarm/runtime）：传输层无关的 AgentRuntime，请求规范化、会话 create/switch/fork/delete、Plan 模式、模型/权限/MCP 目录；列出 service、request、session_provisioner、session_delete、agent_definition 等关键文件与改动路由
metadata:
  scope: 只收 jiuwenswarm/runtime 顶层模块的入口、关键文件与相关文档；runtime/session 协调器归 jiuwenswarm-runtime-session-1 与 jiuwenswarm-runtime-session-2，逐文件接口记录归 agent-runtime-contracts-01
---
# 共享 Agent Runtime（jiuwenswarm/runtime）

## 现状

- 本模块是与传输层无关的共享 Agent Runtime。AgentServer 和进程式 CLI 各持有一个 `AgentRuntime`，用它完成请求规范化，处理会话的创建、切换、分叉和删除，编排 Plan 模式，并查询模型、模式、权限和 MCP 引用；WebSocket 帧、连接锁和请求/线路翻译仍由 AgentServer 负责。
- **从这里读起**
- `jiuwenswarm/runtime/service.py` — `AgentRuntime` 负责 Runtime 的生命周期，对外提供会话、目录查询、Plan 控制器和准入控制等公共操作
- `jiuwenswarm/runtime/request.py` — 规范化请求：解析项目目录和模式，准备对话轮次（`prepare_chat_turn`），并处理准入（`admit_request`）和取消（`cancel_request`）
- `jiuwenswarm/runtime/context.py` — 按任务取当前的 Runtime 和 AgentManager（`get_current_runtime` / `get_current_agent_manager`）
- **关键文件**
- `jiuwenswarm/runtime/session_provisioner.py` — 会话 create/switch/fork 的分阶段 prepare/commit/abort 契约，以及 `session.delete` 的业务事务
- `jiuwenswarm/runtime/session_lifecycle.py` — 会话生命周期事件、activity/delete 参与者协议和 `RuntimeParticipantRegistry`
- `jiuwenswarm/runtime/session_delete.py` — 永久删除会话的结果类型、会话锁和团队删除锁，以及 `TeamDeletionGate`
- `jiuwenswarm/runtime/session_catalog.py` — 只读的会话查询接口 `get_session` / `list_sessions`，含分页和会话 ID 校验
- `jiuwenswarm/runtime/agent_definition.py` — 根 Agent 定义的声明式校验、指纹计算，以及 `prepare_agent_execution`
- `jiuwenswarm/runtime/plan.py` — `PlanModeController`：AgentServer 和 CLI 共用的 Plan 模式状态同步、进入和退出
- `jiuwenswarm/runtime/host_services.py` — 宿主可选注入的能力，包括 push 和 wake handler、xiaoyi channel provider；CLI 不设置这些
- `jiuwenswarm/runtime/events.py` — `RuntimeEvent`：Runtime 向外发出的事件，与传输层无关
- `jiuwenswarm/runtime/interaction.py` — `InteractionAnswerInput`：把对交互的回答转成 `AgentRequest`，可恢复被中断的轮次
- `jiuwenswarm/runtime/model_catalog.py` — 不含凭据的模型目录（`build_model_catalog`）和模型选择解析（`resolve_model_selection`）
- `jiuwenswarm/runtime/permission_catalog.py` — 按会话读取权限层、工具和规则的只读快照
- `jiuwenswarm/runtime/mcp_references.py` — 对 Runtime 引用的 MCP server 做只读校验，并返回每个引用的状态
- **相关文档**
- `docs/zh/MCP配置.md` — 改动 `mcp_references.py` 的 MCP 引用校验，或需要确认 MCP server 的配置来源时读
- `docs/zh/AgentTeam.md` — 改动 `session_delete.py` 里的团队删除闸门或团队执行控制时，用它了解 Agent Team 的行为
- `TESTING.md` — 给 Runtime 补测试时参考；其中有过期路径，要先对照 tests/ 下已有的用例
- **改动路由**
- `jiuwenswarm/runtime/agent_definition.py`
- `jiuwenswarm/runtime/context.py`
- `jiuwenswarm/runtime/events.py`
- `jiuwenswarm/runtime/evolution.py`
- `jiuwenswarm/runtime/host_services.py`
- `jiuwenswarm/runtime/interaction.py`
- `jiuwenswarm/runtime/mcp_references.py`
- `jiuwenswarm/runtime/mode_catalog.py`
- `jiuwenswarm/runtime/model_catalog.py`
- `jiuwenswarm/runtime/permission_catalog.py`
- `jiuwenswarm/runtime/plan.py`
- `jiuwenswarm/runtime/request.py`
- `jiuwenswarm/runtime/service.py`
- `jiuwenswarm/runtime/session_catalog.py`
- `jiuwenswarm/runtime/session_delete.py`
- `jiuwenswarm/runtime/session_input.py`
- `jiuwenswarm/runtime/session_lifecycle.py`
- `jiuwenswarm/runtime/session_provisioner.py`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/jiuwenswarm-runtime.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
