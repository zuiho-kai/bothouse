---
name: jiuwenswarm-channels-process-cli
description: 进程式 CLI 频道 process_cli：REPL 每命令一个 worker 与斜杠命令、app.run 会话操作（create AFTER_RESULT_DELIVERY、switch/fork BEFORE_RESULT_DELIVERY、delete）、超时与退出码 124，基线 f0a6972
metadata:
  scope: 只收 REPL、worker 生命周期与会话操作；机器模式租约、Agent 绑定与停机顺序归 jiuwenswarm-process-cli-machine，Gateway 侧 CLI 频道归 jiuwenswarm-channels-cli，审查规则归 gateway-channels-rules
---
# 进程式 CLI 频道（process_cli）

## 现状

- 进程式 JiuwenSwarm CLI 频道：交互式 REPL 给每条命令启动一个独立的 Runtime worker 进程；另有两类入口，一类是面向机器的一次性执行（NDJSON 输出，可选双工应答/取消控制），一类是只读查询。所有入口都通过进程内客户端调用共享的 Agent Runtime Public API。
- 本页源码结论固定在 upstream commit `f0a6972`（f0a69728c96b5961d993449f1a901cbd2f4dac5b），行号见各 GitHub blob 链接。
- **入口**
- `jiuwenswarm/channels/process_cli/main.py` — CLI 总入口：main() 与 build_parser()（中文 argparse），处理工作目录切换、stdio 转发和 Windows worker 的中断
- `jiuwenswarm/channels/process_cli/repl.py` — run_repl：交互式启动器，给每条命令拉起 worker 进程，并处理 /new、/resume、/branch、/delete 等斜杠命令
- `jiuwenswarm/channels/process_cli/app.py` — run/execute：单条命令在 worker 进程里的完整生命周期，包括会话创建/切换/分叉/删除、交互应答和事件消费
- `jiuwenswarm/channels/process_cli/machine_entry.py` — execute_source：机器模式的轻量启动入口，先设置好 stdout/cwd 再导入 Runtime，分文档输入和双工输入两种方式
- `jiuwenswarm/channels/process_cli/query_entry.py` — execute_query_source：只读查询的启动入口，先校验输入再导入 Runtime
- **关键文件**
- `jiuwenswarm/channels/process_cli/client.py` — InProcessRuntimeClient：进程内调用共享 Runtime Public API 的客户端，负责会话准备/提交/回滚、流式调用、应答和取消
- `jiuwenswarm/channels/process_cli/protocol/model.py` — 一次性执行的值契约：OneShotRunInput、OneShotEvent、OneShotRunResult、AgentSpec、WorkspaceSpec 等
- `jiuwenswarm/channels/process_cli/protocol/jsonl.py` — 一次性执行记录的严格 NDJSON 编解码，并校验记录身份
- `jiuwenswarm/channels/process_cli/protocol/version.py` — 机器 schema 的版本标记和版本支持校验
- `jiuwenswarm/channels/process_cli/machine.py` — run_machine：通过共享 Runtime 执行一条机器请求，收集结果并清理资源
- `jiuwenswarm/channels/process_cli/machine_io.py` — 机器模式的有界单文档输入读取，以及 OneShotWriter 流式输出
- `jiuwenswarm/channels/process_cli/duplex_control.py` — DuplexController：把单条命令在 stdio 上收到的应答/取消控制路由过去；执行和审批仍由 Runtime 负责
- `jiuwenswarm/channels/process_cli/duplex_protocol.py` — 双工控制记录（answer/cancel）的严格解码，只携带关联 ID 和应答值
- `jiuwenswarm/channels/process_cli/duplex_input.py` — DuplexLineReader：可取消、有长度上限的 stdin 行读取，Windows 与 POSIX 走不同实现
- `jiuwenswarm/channels/process_cli/session_guard.py` — SessionLease：机器模式下同一个 Session 的跨进程所有权租约
- `jiuwenswarm/channels/process_cli/live_input.py` — LiveSessionInputController：TTY 实时补充输入（steer），以及投递回执的分类
- `jiuwenswarm/channels/process_cli/render.py` — EventRenderer：把 Runtime 事件流渲染成 human、JSON 或 JSONL 输出

### REPL：每命令一个 worker 与斜杠命令

- run_repl 只拥有 UI；每条非斜杠输入用 `python -m jiuwenswarm.channels.process_cli.main --_interactive-worker --_prompt-file …` 拉起全新 worker（prompt 写临时文件、绝不进 argv），worker 环境固定 `PYTHONIOENCODING=utf-8`，
  - Windows 上加 `CREATE_NEW_PROCESS_GROUP` 以便投递 CTRL_BREAK_EVENT（[repl.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L105-L153)；测试 `test_repl_runs_every_instruction_in_a_new_worker_and_reuses_session`）。
- 斜杠命令分三组：本地控制命令 `/model`（model.list/model.resolve，把 selection_key 记到下一轮 worker）、`/plan`（仅 agent.* 模式，切换 `agent.{work_mode}.{plan|normal}`）、`/status`（session.get）、`/permissions`（permission.get）不启动 worker；
  - `/skills list` 和有状态操作 `/new [--persist|--persist-session]`、`/resume [id]`、`/branch`、`/delete <id>` 各跑一个带 `--_operation` 的 worker；`/sessions` 打开分页选择器（limit 1..200、搜索词 ≤200 字符）选中后走
  - switch（[repl.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L766-L931)；测试 `test_repl_unknown_slash_and_idle_cancel_do_not_start_worker`、`test_repl_session_lifecycle_commands_use_workers_and_update_state`）。
- 父 REPL 只在 worker-result.json 的 `operation` 与本轮一致时采纳其中的 session_id/mode/work_mode/project_dir；chat 在没有有效 worker-result 时还可从旧 `session-id.txt` 恢复 session_id（见 JIUWENSW-I39）；
  - 有状态操作退出码 0 但没有结果文件时改为 1 并输出诊断，退出码 130 一律回到输入循环（[repl.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L444-L487)；
  - 测试 `test_successful_stateful_worker_without_result_is_reported_as_failure`、`test_stateful_worker_result_restores_mode_work_mode_and_project`）。
- 中断升级有界：live `/cancel` 或 Ctrl+C 先发 CTRL_BREAK_EVENT/SIGINT 等 15 秒，再 `terminate()` 等 5 秒，最后 `kill()` 等 5 秒；
  - `cancel_requested` 置位时返回码强制 130，且 130 不附带 worker 诊断（[repl.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L297-L330)、
  - [L407-L414](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L407-L414)；测试 `test_worker_interrupt_has_bounded_terminate_and_kill_fallback`、`test_live_cancel_returns_interrupt_code_without_worker_diagnostics`）。
  - 任务运行中其他斜杠命令被拒绝，提示先 `/cancel`。

### worker 生命周期与会话操作（app.run）

- `app.run` 对每条命令恰好拥有一个 Runtime：chat 操作先 `create_or_resume_session(channel_id="process_cli", …)`，随后立刻写结果文件，再构造 `AgentRequest`（CHAT_SEND、is_stream=True；`supports_user_interaction` 仅在 interactive worker 或 human 输出 + TTY 时为真，`--_model-selection` 透传为 model_name），
  - 按需启动 LiveSessionInputController（REPL 转发用 PipeLineReader，本机 TTY 用 TtyLineReader）后进入 `_consume`（[app.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L798-L853)）。
- 失败映射：`--timeout` 到期（`asyncio.timeout` 包住整个 execute）→ 先发有界 `CHAT_CANCEL` 再渲染超时错误事件、退出码 124；`CancelledError` → 取消 + `renderer.interrupted()` 后重新抛出（父进程显示为中断）；其他异常 → 渲染错误事件（`SessionProvisionError` 的 code 进 metadata）、退出码 1。
  - finally 里 chat 操作先 `cleanup_session` 再 `client.close()`，两步各限 5 秒，取消也不能跳过 close（[app.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L855-L929)）。
- 会话操作提交时机不同：create 用 `AFTER_RESULT_DELIVERY`（终态输出和父结果文件先落盘，延迟 KVC 提交失败只记日志、不改写已交付的成功，finally 只 abort 仍处 PREPARED 的租约）；switch/fork 用 `BEFORE_RESULT_DELIVERY`；delete 不走 prepare，直接 `delete_session`。
  - 所有目标会话先经 `_owned_session_descriptor` 校验 descriptor 的 channel_id 必须是 `process_cli`，否则按 NOT_FOUND 拒绝——别的频道的会话不能在这里切换/分叉/删除（[app.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L208-L227)、
  - [L299-L327](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L299-L327)）。create 刻意传 `project_dir=""`（projectless 工作区，cwd 仍是执行位置），is_swarm/team_hint 由 team 模式推导。
- 交互应答分流与 Gateway CLI 一致：四种 `_interrupt` 恢复源且交互 request_id 非空时用新的流式 CHAT_SEND（query 置空、带 request_id/answers/source）恢复暂停任务，其余走 CHAT_ANSWER；
  - 取消请求复用原 request_id 构造 CHAT_CANCEL，因为取消目标是 Runtime 里在飞的那个请求本身（[app.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L530-L582)）。

### 机器执行与停机

- 机器调用的准入、会话租约、根 Agent 指纹、结果判定与清理顺序见[[jiuwenswarm-process-cli-machine]]（机器执行专题）。

### 怎样验证

- 焦点测试文件：`tests/unit_tests/process_cli/`（test_agent_session_guard.py、test_machine.py、test_repl.py 等，[upstream 链接](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/process_cli/test_machine.py)）。按主题的精确选择器：
  - 租约与绑定：`test_session_lease_is_exclusive_and_reusable`、`test_binding_survives_new_process_and_rejects_identity_change`、`test_session_guard_busy_preserves_safe_retry_message`、`test_session_guard_conflict_preserves_safe_error_message`
  - 机器执行/清理：`test_one_command_owns_one_runtime_and_returns_result_after_close`、`test_timeout_covers_start_allocation_and_stream_with_precise_cancel`、`test_external_task_cancellation_is_a_terminal_result_after_cleanup`、`test_broken_output_cancels_and_closes_without_retrying_output`
  - REPL/worker：`test_worker_command_uses_a_fresh_process_entry_and_runtime_session`、`test_windows_worker_sigbreak_runs_async_cleanup_and_exits_130`、`test_repl_interrupts_only_current_worker_and_continues`
- 验证边界：以上选择器来自固定 commit 的源码与既有单测断言，本页未实际运行；`system_tests/test_process_cli_*_live.py` 的 live 行为、双工端到端与 Windows 信号路径未在本轮核对，不据此下结论。审查本模块改动时另见 [[gateway-channels-rules]]（审查规则）。
- **相关文档**
- [[jiuwenswarm-runtime]]（共享 Agent Runtime（jiuwenswarm/runtime）） — create_or_resume_session、provision 提交时机与请求规范化契约在 Runtime 侧的实现。
- [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（Runtime Session 协调器） — CHAT_SEND/CHAT_CANCEL 的服务端准入、lane 调度与取消语义。
- `docs/zh/Quickstart.md` — 想了解用户怎样启动和使用 JiuwenSwarm 时读；本模块的机器协议字段以 protocol/ 下的源码为准
- `TESTING.md` — 为 CLI 改动补测试时参考；其中有过期路径，要先对照 tests/ 下现有的用例
- **路由**
- `jiuwenswarm/channels/process_cli/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/jiuwenswarm-channels-process-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/app.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/machine.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/session_guard.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/process_cli/test_agent_session_guard.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/process_cli/test_machine.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/process_cli/test_repl.py
