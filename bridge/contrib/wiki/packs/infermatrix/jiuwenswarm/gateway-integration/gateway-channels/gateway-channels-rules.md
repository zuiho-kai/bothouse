---
name: gateway-channels-rules
description: Process CLI 频道审查规则 JIUWENSW-I32、I36、I37、I39、I41 与 JW-PCLI-FLUSH-1a：prepare/abort 配对、Team 流终止、live_input 顺序、worker 结果文件、Duplex 控制令牌、退出前 flush session_writes
metadata:
  scope: 只收 jiuwenswarm/channels/process_cli 的审查规则；架构说明归 jiuwenswarm-channels-process-cli，机器模式归 jiuwenswarm-process-cli-machine，设计取舍归 gateway-channels-design-tradeoffs
---
# Process CLI 频道（jiuwenswarm/channels/process_cli）审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-09
- 来源（sources）：PR #7782
- [JIUWENSW-I32] 会话 prepare 必须在 finally 中配对 _abort_prepared_session，且 abort 不得覆盖主错误
  - 调用 `prepare_session_create`、`prepare_session_switch` 或 `prepare_session_fork` 时，必须在 `try` 之前写 `prepared = None`，在 `finally` 中写 `await _abort_prepared_session(client, prepared, sys.exception())`。新增会话操作也要照这个写法。
  - 不要把 prepare 挪到 `try` 外，也不要删掉 `finally`。否则，取消或异常落在 prepare 与 commit 之间时，还处于 PREPARED 的租约会遗留给 `client.close()`。
  - `jiuwenswarm/channels/process_cli/app.py::_abort_prepared_session` 只在 `prepared.state is SessionProvisionState.PREPARED` 时调用 abort。abort 自身抛出的 `Exception` 只记日志；只有没有主错误时，才重新抛出 `CancelledError`。改动后，abort 失败不能盖掉主操作的错误，已 commit 的会话也不能再被 abort。
- [JIUWENSW-I36] Team 流一轮结束后不会 EOF：_consume 靠终止事件返回，close 要先停掉 Team 流任务
  - Team 模式的 Runtime 流在一轮结束后会继续存活。`_consume` 靠 `_is_terminal_team_event` 返回，判定条件是 `chat.processing_status`，且 `is_processing is False`、`is_complete is True`。如果改了这个判定或事件字段，或删掉 694 行的检查，Team 命令会一直挂到超时，返回 124。
  - `InProcessRuntimeClient.close` 必须先调用 `cancel_all_team_stream_tasks`，再调用 `self._runtime.close()`。两步各自包在 try 里，都跑完后再抛出第一个错误。不要改成先 close，也不要遇到错误就提前返回。
- [JIUWENSW-I37] LiveSessionInputController 的 pause/observe/render/resume 顺序，以及递归 _consume 的所有权
  - 有 `live_input` 时，根流事件和 `client.answer_interaction` 返回的事件走同一个顺序：遇到交互事件或 `is_complete` 事件，先 `await live_input.pause()`，然后 `observe`，最后经 `render_root_event` 渲染。不要直接调用 `renderer.render`。
  - `handle_interaction` 要先 `pause()` 再显示提示。有 `live_input` 时，答案必须用 `live_input.read_interaction_line()` 读取，不能用 `_interaction_answer`：后者直接调用 `sys.stdin.readline()`，会和 live reader 抢 stdin。继续流或发送答案之前，要先调用 `resume_after_event()`。
  - 中断恢复时递归调用 `_consume`，必须传 `owns_live_input=False`。只有根 `_consume` 在 `finally` 里对控制器调用 `close()`，否则恢复流一结束，控制器就会被提前关闭。
- [JIUWENSW-I39] _write_worker_result 是 worker 与父 REPL 之间的接口，字段和写入时机都不能随意改
  - worker 和父 REPL 之间没有传输层，只通过 `_session_result_file`（内容只有 session_id）和 `_worker_result_file`（JSON，字段为 `operation`、`session_id`、`mode`、`work_mode`、`project_dir`）交换已提交的状态。改字段名、删字段、换编码，都会破坏父进程这一侧的解析。
  - chat 在 `create_or_resume_session` 之后、构建请求和开始流之前，就写结果文件，这样后续失败或超时时，父进程仍然能拿到会话 ID。不要把这一步挪到流结束之后。
  - delete 写入和返回的是当前会话 `args.session`，不是被删掉的 `target`。改成 `target` 会让父 REPL 切到已删除的会话上。
- [JIUWENSW-I41] Duplex 控制输入：严格绑定当前运行，一次性令牌，出错时不回显输入
  - 每条控制消息的 `request_id` 必须等于 `writer.request_id`；如果带了 `session_id`，也必须等于 `writer.session_id`。回答只能按 `_register_interaction` 发出的 uuid 令牌路由，而不是 Runtime 的 request_id。令牌 `pop` 一次后就失效，重放会被拒绝。
  - 任何控制错误都经 `_terminate`，并使用固定文案，不回显请求内容。`_terminate` 以第一次失败为准，`stop_input` 之后调用会被忽略。不要在 message 里拼接用户输入。
  - 输入 EOF 时如果还有待答交互，必须以 `INPUT_CLOSED` 按取消处理（退出码 130）。`harness.activate_interaction` 以及没有定位符的交互会被拒绝，报 `INTERACTION_UNSUPPORTED`；待答交互数量上限是 `_MAX_PENDING`。
- [JW-PCLI-FLUSH-1a] 持有 session 的单次 CLI 必须在退出前等待两个写入队列
  - 触发：修改 `channels/process_cli/machine.py` 的 cleanup 和单次调用完成结果。
  - 强制：runtime_close 之后，只有持有 session_id 的运行追加 session_writes；并发等待 history 与 metadata 独立队列，在 shutdown 期限内留正安全余量。任一返回值不是 True 或发生异常，记录 session_writes 清理失败并以 SHUTDOWN_FAILED 返回。
  - 验收：测试 runtime-closed → session-writes → asyncio-shutdown 顺序、短期限的正超时、两个队列同时启动和任一队列失败；无 session 允许省略此步骤。^[PR #7782]

## 决策与踩坑

- [JW-PCLI-FLUSH-1a] 禁止：持有 session 时跳过 flush；串行消耗两个完整超时窗口；把未落盘的单次调用报告为成功。
