---
name: jiuwenswarm-process-cli-machine
description: 进程式 CLI 机器模式：SessionLease 跨进程会话租约、bind_agent 根 Agent 指纹、INCOMPLETE_RUN/INTERACTION_REQUIRED 等结果状态与 control_input 到 runtime_close 的清理顺序
metadata:
  scope: 只收一次性机器调用的准入、租约、结果判定与停机；REPL worker 与会话操作归 jiuwenswarm-channels-process-cli，设计取舍归 gateway-channels-design-tradeoffs
---
# 进程式 CLI 机器执行、会话租约与停机

## 现状

### 职责和边界

- 说明一次性机器调用如何取得会话租约、绑定根 Agent、判定完成并按顺序清理；REPL worker 和交互会话操作见[[jiuwenswarm-channels-process-cli]]（进程式 CLI 主页面）。

### 机器模式：会话租约与 Agent 绑定

- `_MachineRun.execute` 的准入顺序：调用方带 session_id 时先 `SessionLease(session_id).acquire()` 再 `client.start()`；`describe_session` 找不到报 SESSION_NOT_FOUND；即使调用方给了新 mode 也要 `resolve_mode_capability(descriptor.mode)` 校验既有会话的根；自定义 Agent 在会话创建前先 `validate_agent_definition`；
  - 新会话在 `create_or_resume_session` 返回后立刻补租约，随后 `bind_agent` 固定指纹（[machine.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine.py#L159-L198)；测试 `test_custom_agent_is_validated_before_session_and_uses_stream_agent`）。
- `SessionLease` 用 portalocker 独占锁文件（sessions 目录 `.process_cli_locks/<sha256(session_id)>.lock`，`LOCK_EX|LOCK_NB`、timeout=0）实现跨进程互斥：冲突抛 `SESSION_BUSY`（retryable=True），
  - 释放后可重用（[session_guard.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/session_guard.py#L28-L58)；测试 `test_session_lease_is_exclusive_and_reusable`）。
- `bind_agent` 把会话钉在声明的根 Agent 指纹上：绑定文件 `.process_cli_bindings/<sha256(session_id)>.json` 存 `{"schema":1,"fingerprint"}`；指纹不一致或绑定文件损坏分别抛 `AGENT_DEFINITION_SESSION_CONFLICT` / `AGENT_BINDING_INVALID`；已有消息（`message_count>0`）的未绑定会话不能事后采纳自定义 Agent；
  - 写入走临时文件 + fsync + `os.replace`（[session_guard.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/session_guard.py#L61-L116)；测试 `test_binding_survives_new_process_and_rejects_identity_change`，指纹 64 字符）。
- 恢复（resume）语义：未指定 mode 时继承会话 descriptor 的 mode（全新会话才回退默认 `agent.code.normal`）；
  - workspace 字段省略表示继承持久化绑定而不是用调用方当前目录覆盖，只有显式给出的 cwd/project_dir/trusted_dirs 才进 params（[machine.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine.py#L96-L120)、
  - [L176-L179](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine.py#L176-L179)；
  - 测试 `test_resume_omissions_inherit_runtime_mode_and_do_not_replace_workspace`、`test_missing_or_foreign_resume_never_allocates_or_cleans_session`）。

### 机器模式：结果与停机顺序

- 结果状态机：流结束但没有任何完成证据（`event.ok` 且 `is_complete`/chat.final）→ `INCOMPLETE_RUN`；无控制通道的运行遇到 `chat.ask_user_question`/`plan.approval_required`/`harness.activate_interaction` → `INTERACTION_REQUIRED`（绝不代答）；超时 → TIMEOUT/124；取消 → CANCELLED/130；
  - 输出管道断裂 → OUTPUT_CLOSED（[machine.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine.py#L233-L263)、
  - [L362-L396](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine.py#L362-L396)；测试 `test_stream_without_completion_evidence_is_not_success`、`test_interaction_never_grants_approval_and_stops_stream`）。
- 清理按 control_input → cancel → control_streams → stream_close → cleanup_session → runtime_close 的顺序尝试，每个已执行步骤限 5 秒：control 步骤仅在双工时执行；cancel 仅在已有主错误且已构造 request 时执行（双工时 target_request_id 置空，取消整个会话范围）；stream_close 和 cleanup_session 也分别要求已有 stream/session。某步失败记名并继续后续步骤；
  - 任一步失败且没有主错误时记 `SHUTDOWN_FAILED`，已有主错误则保留并附加 cleanup_errors；
  - 清理中首次收到 CancelledError 可设 CANCELLED/130，清理期间命令信号被延迟（`defer_command_signals`），租约在整个清理完成后才释放（[machine.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine.py#L265-L328)、
  - [L397-L404](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/machine.py#L397-L404)；
  - 测试 `test_every_cleanup_stage_is_bounded_and_later_stages_still_run`、`test_each_cleanup_exception_turns_otherwise_successful_run_into_failure`）。

### 怎样验证

- 源码固定在 f0a69728c96b5961d993449f1a901cbd2f4dac5b。租约、绑定、超时与清理的测试选择器见[[jiuwenswarm-channels-process-cli]]（主页面的验证入口；源锚点 #怎样验证）；静态断言不能替代双工端到端、真实模型端点或 Windows 信号验证。

### 相关文档

- [[jiuwenswarm-channels-process-cli]]（进程式 CLI 的 REPL 与 worker 生命周期）
- [[jiuwenswarm-runtime-control]]（Runtime 交互输入、执行取代与取消）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/jiuwenswarm-process-cli-machine.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/machine.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/session_guard.py
