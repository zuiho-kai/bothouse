---
name: agent-runtime-knowledge
description: 共享 Agent 运行时知识条目（service.py AgentRuntime）：传输无关的生命周期所有者、send_session_message 跨会话消息与能力目录、一次性 Runtime 的预置事务与执行路由、构造参数与进程依赖归属、会话输入单测与 agent_definition AST 断言
metadata:
  scope: 只收 AgentRuntime 的五条知识条目；模块入口与关键文件归 jiuwenswarm-runtime，设计取舍归 agent-runtime-design-tradeoffs
---
# 共享 Agent 运行时（jiuwenswarm/runtime/service.py AgentRuntime）

## 现状

- **传输无关的 Runtime 生命周期所有者**
- AgentRuntime 是共享 Agent 运行时的生命周期所有者：它持有唯一的 AgentManager、PlanModeController、RuntimeSessionProvisioner 和 RuntimeSessionCoordinator，模块文档明确声明它不承载任何传输关注点——AgentServer 与进程式 CLI 各自拥有一份实例并调用其公共操作，WebSocket 帧仍留在 AgentServer。
  - 类文档还规定它是 one-shot 的：close 之后不可再次 start，未终态的 PreparedSessionProvision 会在 close 前被拒绝，避免 finalizer 运行在已拆除的 Runtime 上。
- Sources / 来源：[jiuwenswarm/runtime/service.py:L3–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L3-L8),
  - [jiuwenswarm/runtime/service.py:L296–L328](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L296-L328)
- **跨会话消息与能力目录**
- send_session_message 从持久化元数据解析源/目标会话，要求目标有 channel、属同一 user（否则 PermissionError）、且为 Work/Code Normal 模式，未加载的目标会幂等恢复注册，然后以 SESSION_MESSAGE 工作类型异步排队并返回执行快照——文档说明其异步性是为了避免两会话互等模型执行而死锁。Runtime 还提供模型/模式目录（list/resolve_model_capability、list/resolve_mode_capability）、权限快照与本地 MCP 名称校验，均要求已 start。
- Sources / 来源：[jiuwenswarm/runtime/service.py:L791–L829](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L791-L829),
  - [jiuwenswarm/runtime/service.py:L613–L659](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L613-L659),
  - [.doc_project_maintainer/modules/runtime-session/README.md:L19–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/.doc_project_maintainer/modules/runtime-session/README.md#L19-L22)
- **公共入口：预置事务与执行路由**
- AgentRuntime 是一次性生命周期拥有者：进程式 CLI 每条命令一份、AgentServer 服务生命期一份；close 后不可重启，close 拒绝尚未 commit/abort 的预置事务。prepare_session_create/switch/fork 在 lifecycle 锁内只做计数与 started 检查，真正的 provisioner 调用在锁外执行，prepared 对象在 finally 中加入 _pending_session_provisions；
  - commit_session_provision 仅当结果是 SessionCreateResult 或 SessionSwitchResult 且模式为单 Agent（Work/Code Normal）时才注册会话，fork 结果不注册。
  - 执行入口 invoke/stream 先用 session_work_kind 分类：CONTROL_INPUT 走 _deliver_control，SESSION_INPUT 走 stream_session_input，其余有 work kind 的走协调器 run_unary/run_stream，没有 work kind 的请求绕过协调器直接执行。
- Sources / 来源：[jiuwenswarm/runtime/service.py:L296–L305](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L296-L305),
  - [jiuwenswarm/runtime/service.py:L881–L939](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L881-L939),
  - [jiuwenswarm/runtime/service.py:L941–L976](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L941-L976),
  - [jiuwenswarm/runtime/service.py:L1762–L1839](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1762-L1839)
- **构造参数决定进程依赖与扩展的归属**
- 构造注入决定进程级依赖管理：initializer 为 None 时（默认）_manage_runner 与 _initialize_extensions 均为 True，start() 会获取进程全局 checkpointer/Runner 并初始化扩展；传入自定义 initializer 则只调用该 initializer，不再管理 Runner 与扩展。扩展获取分两种情形：当前不存在 ExtensionRegistry 实例时创建 registry 与 ExtensionManager 并 load_all_extensions（不含传输扩展）；
  - 若 AgentServer/Gateway 已预加载 registry，则仅借用该实例并返回 False，不参与其生命周期、也不加载扩展。模型目录方面，get_default_models 抛错时抛 ModelCatalogError("model catalog is unavailable", code="MODEL_CATALOG_UNAVAILABLE", retryable=True)；条目无法通过 build_model_from_entry 构造时按原位跳过，避免目录选择静默落到 Adapter 默认模型。
- Sources / 来源：[jiuwenswarm/runtime/service.py:L307–L346](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L307-L346),
  - [jiuwenswarm/runtime/service.py:L486–L518](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L486-L518),
  - [jiuwenswarm/runtime/service.py:L204–L262](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L204-L262),
  - [jiuwenswarm/runtime/service.py:L547–L601](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L547-L601)
- **会话输入的行为单元测试与 agent_definition 的 AST 源码断言**
- tests/unit_tests/runtime/test_session_input.py 是针对 AgentRuntime 会话输入（steer 等 input_mode）的既有异步单元测试，使用可控的 GatedAgent 假 Agent：test_new_input_bypasses_busy_lane_without_answer_or_second_agent 断言原执行占用 lane 时补充输入经 invoke/stream 直接派发为 SESSION_INPUT 子执行（child.parent_execution_id 指向根执行），原执行仍 RUNNING、
  - Agent 未被取消；test_close_cancels_inflight_input_and_cannot_reopen_session 断言 close_session 使 in-flight 的根与补充执行均以 CancelledError 结束，且关闭后再 stream 抛 RuntimeStateError。
  - 另一类是 tests/unit_tests/runtime/test_agent_definition.py 的 test_runtime_contract_has_no_execution_or_transport_dependencies：它对 agent_definition.py 源码做 AST 检查，遍历 Import/ImportFrom 语句比对模块名前缀（如 jiuwenswarm.server、websocket）并检查代码中的 ast.Name 标识符（如 AgentManager、AgentRuntime），断言违规列表为空——这是源码结构检查而非运行时行为测试。
  - 此处仅记录入口与断言内容，不代表测试曾被运行或通过。
- Sources / 来源：[tests/unit_tests/runtime/test_session_input.py:L106–L132](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_session_input.py#L106-L132),
  - [tests/unit_tests/runtime/test_session_input.py:L213–L225](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_session_input.py#L213-L225),
  - [tests/unit_tests/runtime/test_agent_definition.py:L288–L320](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_agent_definition.py#L288-L320)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L3-L8；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L296-L328
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L791-L829；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L613-L659
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:.doc_project_maintainer/modules/runtime-session/README.md:L19-L22；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L296-L305
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L881-L939；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L941-L976
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1762-L1839；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L307-L346
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L486-L518；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L204-L262
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L547-L601；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_session_input.py:L106-L132
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_session_input.py:L213-L225；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_agent_definition.py:L288-L320
