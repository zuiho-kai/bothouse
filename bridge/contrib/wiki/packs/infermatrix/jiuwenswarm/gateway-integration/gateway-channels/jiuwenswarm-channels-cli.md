---
name: jiuwenswarm-channels-cli
description: CLI 频道 jiuwenswarm/channels/cli：jiuwenswarm chat 的 connection.ack 握手、chat.send 请求与 agent_ref、SIGINT 与退出码、team/plan 终止判定、human/JSON/JSONL 渲染，基线 f0a6972
metadata:
  scope: 只收根命令 jiuwenswarm 的 CLI 频道（channels/cli）；进程式 CLI 的 REPL 与 worker 归 jiuwenswarm-channels-process-cli，机器模式租约归 jiuwenswarm-process-cli-machine
---
# CLI 频道（jiuwenswarm/channels/cli）

## 现状

- 提供根命令 `jiuwenswarm` 的 CLI 入口和命令行聊天频道：解析参数，通过兼容 `/tui` 的 WebSocket 连接 Gateway，再把流式事件渲染成人类可读、JSON 或 JSONL 输出。交互模式下还负责权限确认和用户输入、Ctrl+C（SIGINT）中断，以及受信目录的持久化和清理。
- 本页源码结论固定在 upstream commit `f0a6972`（f0a69728c96b5961d993449f1a901cbd2f4dac5b），行号见各 GitHub blob 链接。
- **从这里读起**
- `jiuwenswarm/channels/cli/main.py` — 根命令 `jiuwenswarm` 的 CLI 入口 `main()`
- `jiuwenswarm/channels/cli/chat.py` — chat 命令的编排入口：`build_parser` 定义参数，`run_chat` 连接 Gateway 并运行 interactive、json 或 jsonl 循环
- **关键文件**
- `jiuwenswarm/channels/cli/chat.py` — 参数校验、请求构造、spinner、SIGINT 处理（含 Windows 分支）、受信目录状态读写和权限卡片应答
- `jiuwenswarm/channels/cli/gateway_client.py` — `GatewayClient`：兼容 `/tui` 的 WebSocket 客户端，负责 connect、send_request、recv 和 close；`set_mock_ws` 供测试注入
- `jiuwenswarm/channels/cli/render.py` — `HumanRenderer`、`JsonRenderer`、`JsonlRenderer`，分别处理三种输出模式下的 delta、reasoning、tool_call、final 和 error 事件
- `jiuwenswarm/channels/cli/events.py` — 事件判定：内容是否结束、流是否终止、是否需要用户输入，以及事件归类
- `jiuwenswarm/channels/cli/_terminal.py` — 用 `os.write` 实现的终端输出原语；按 docstring 所说，这是终端 UI，不是日志，所以没有走 `logging`（G.LOG.02）

### 连接握手与请求构造

- 默认 Gateway URL 由环境变量拼出 `ws://{GATEWAY_HOST=127.0.0.1}:{GATEWAY_PORT=19001}/tui`；
  - 未指定 `--session` 时本地生成 `cli-YYYYMMDD-HHMMSS-<uuid8>` 形式的会话 ID（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L325-L334)；测试 `TestSessionId::test_generated_id_format`）。
- `GatewayClient.connect` 要求服务端第一帧必须是 `{"type":"event","event":"connection.ack"}`：连接后提前关闭、非 JSON 或非 ack 帧都收敛为 `ConnectionError`，
  - 随后 `_run_chat` 的 10 秒连接超时/`ConnectionError`/`OSError` 统一打印 `jiuwenswarm-start app` 启动提示并返回退出码 3（[gateway_client.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/gateway_client.py#L49-L77)、
  - [chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L1093-L1105)；测试 `TestGatewayClient::test_connect_rejects_non_ack`）。
  - WebSocket 参数：优先 `websockets.legacy` 客户端，`close_timeout=2.0`、`max_size=8MiB`、`ping_interval=20`、`ping_timeout=60`（[gateway_client.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/gateway_client.py#L14-L32)）。
- `_build_request` 发送 `method="chat.send"`、`is_stream=True`，params 携带 session_id、content+query（同值）、mode、cwd、project_dir、trusted_dirs 和 `agent_ref={"mode": <mode>, "id": "default"}`：V2 显式 agent_ref 让 Gateway 按 (channel, scope, agent_ref) 注册，
  - 同 session 切 mode 后旧 agent 的延迟 chunk 不会错路由（源码注释；[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L422-L463)；测试 `TestBuildRequest::test_minimal_request`、`test_with_session`）。
  - trusted_dirs 缺省取 project_dir，并把 config.yaml 中已持久化的信任目录合并进请求。

### 中断、超时与退出码

- 交互循环里 SIGINT 分两段：第一次设标志并提示，第二次在 POSIX 上直接 `os.kill(SIGTERM)`；Windows 没有 `loop.add_signal_handler`，退回 `signal.signal` 处理器，第二次 Ctrl+C 只置 force-exit 标志（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L547-L583)）。
  - 触发中断时发送 `chat.interrupt`（`intent:"cancel"`、带 session_id 和 mode，3 秒 `wait_for`，异常吞掉）并返回 130（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L596-L618)）。
- human 输出循环中的 `--timeout` 是总响应预算：循环用 `time.monotonic()` 维护 deadline，每次 recv 与 sleep 竞速的时长为 `max(min(remaining, 0.3), 0.01)`，无 deadline 时用 1 秒空闲超时，并把 recv 与短 sleep 竞速，
  - 让 Windows ProactorEventLoop 上也能约 1 秒内响应 Ctrl+C（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L488-L501)、
  - [L638-L654](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L638-L654)）。
- human 循环的退出码约定：2 = 参数错误（非法 mode、`--json`+`--jsonl`、timeout≤0、空 prompt）；3 = 连不上 Gateway；4 = recv `OSError`（提示用 `--session` 重连）或收到交互事件但本调用不支持交互；5 = 其他 recv 异常（指向 full.log/gateway.log）；1 = `chat.error`、超时或 team.error；
  - 130 = 用户中断（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L405-L419)、
  - [L698-L711](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L698-L711)）。
  - `--json`/`--jsonl` 模式下请求永远带 `supports_user_interaction=False`，所以交互事件在这两种模式必然以 4 退出（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L1107-L1113)）。
  - JSON/JSONL 的循环没有接收 `args.timeout`，不能把 human 的总预算、recv 异常映射和 SIGINT 处理推广到这两种输出（[L1000-L1043](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L1000-L1043)、
  - [L1121-L1135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L1121-L1135)）。

### 交互应答分流

- 四种中断恢复源（confirm/permission/ask_user/evolution `_interrupt`）且 `request_id` 非空时用新的流式 `chat.send` 应答（params 带 request_id、answers、source，query 为空）才能恢复被暂停的任务；
  - 其他交互事件走非流式 `chat.user_answer`（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L277-L282)、
  - [L834-L868](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L834-L868)）。
- 权限卡片答案只绑定唯一一张不透明卡片：questions 必须恰好一条且带非空 `card_id`（≤128 字符），
  - 答案形如 `{"selected_options":[..],"custom_input":..,"card_id":..}`（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L285-L309)；测试类 `TestPermissionCardAnswer`）。选项支持序号或标签（大小写不敏感）映射到 option value。

### 终止判定与 team/plan 语义

- `is_terminal_event`：`chat.error` 恒终止；`chat.final` 仅在内层 `event_type` 为空/同为 `chat.final`（真内容）或 `team.error` 时终止；`chat.processing_status` 仅在 `is_processing=False` 时终止。
  - Gateway 把没有 EventType 映射的控制事件（keepalive、chat.llm_usage、team.runtime_ready 等）装进 chat.final 信封传输，它们不能当终止（[events.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/events.py#L10-L30)；测试 `test_is_terminal_chat_final_keepalive`）。
- Team 模式里 leader 的 chat.final 只是轮次边界：真正结束流的是 `processing_status(is_processing=False)` 或 team.error；
  - 若 leader 回复后没建任务、服务端 team-completion 不触发，客户端用 3 秒空闲窗口检测停顿并在 TTY 上直接提示下一轮输入（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L506-L517)、
  - [L882-L936](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L882-L936)）。
- Plan 模式里 chat.final 不一定是结束：没收到 `plan.mode_exited`、也不是审批恢复（source=confirm_interrupt 的应答）时，视为 agent 抛出文本问题，TTY 上提示 follow-up 并继续同一条连接（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L519-L543)、
  - [L940-L975](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L940-L975)）。发出恢复/追问后，`awaiting_resume` 只跳过遇到的第一个终止事件，然后立即清零；它不通过请求 ID 判定该事件属于旧流还是新流。
- REPL（无 prompt 且 TTY）每轮 `asyncio.run` 新建一条连接；退出码 130 时留在 REPL 继续下一轮而不是退出（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L1210-L1264)）。
  - Team 模式无 prompt 时例外：先读一行进入同一个持久交互会话，避免每轮重连丢 team 状态（[chat.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/chat.py#L1158-L1177)）。

### 渲染输出

- `JsonlRenderer` 每个事件一行 `{"type":"event","event":<type>,"payload":<payload>}`；
  - `JsonRenderer` 攒完所有事件后输出单个对象，content 取最后一个非空 content，任一事件带 error 则 `ok=false` 并报最后一个错误（[render.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/render.py#L204-L250)）。
- `HumanRenderer` 流式打印 delta，相邻 delta 间隔超过 0.5 秒插入空行；spinner 每 0.2 秒 tick 一次、动词每 5 秒轮换、空闲超过 3 秒变红。
  - final 只打印一次并复用 TUI 的 chooseFinalAssistantContent 策略：final 是 streamed 的延续时只补后缀，是子集时不再打印，完全不同时只在内部保留更长版本，绝不重刷已流出的终端文本（[render.py](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/render.py#L21-L29)、
  - [L167-L196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/cli/render.py#L167-L196)；测试类 `TestHumanRenderer`）。

### 怎样验证

- 焦点测试文件：`tests/unit_tests/channels/cli/test_chat.py`（[upstream 链接](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channels/cli/test_chat.py)），另有 test_gateway_client.py、test_render.py、test_events.py。按主题的精确选择器：
  - 请求与会话：`TestSessionId::test_generated_id_format`、`TestBuildRequest::test_minimal_request`、`test_with_session`
  - 握手：`TestGatewayClient::test_connect_waits_for_ack`、`test_connect_rejects_non_ack`、`test_connect_rejects_invalid_json`
  - 终止判定：`test_is_terminal_chat_final`、`test_is_terminal_chat_final_keepalive`、`test_is_terminal_processing_done`
  - 渲染：`TestHumanRenderer`、`TestJsonRenderer`、`TestJsonlRenderer`、`TestPermissionCardAnswer`
- 验证边界：以上是固定 commit 下源码与单测断言的结论，未实际运行；gateway 侧对 `agent_ref` 三元组的注册行为、team/plan 服务端配合属于 Gateway/Runtime 实现，本页只描述客户端假设。
- **相关文档**
- [[jiuwenswarm-runtime-session-1]]、[[jiuwenswarm-runtime-session-2]]（Runtime Session 协调器） — chat.send/chat.interrupt 在服务端的准入、lane 调度与取消语义。
- [[jiuwenswarm-runtime]]（共享 Agent Runtime） — 会话 provision 与请求规范化契约。
- `docs/zh/Quickstart.md` — 想了解用户通常怎样启动和使用命令行时读
- `README_CN.md` — 需要项目总体介绍，或核对 CLI 在整体架构里的位置时读
- `docs/zh/FAQ.md` — PR 改动连接提示、报错文案或常见使用问题时读
- `TESTING.md` — PR 新增或修改 CLI 测试时参考；其中有过期路径，要先对照 tests/ 下已有的用例
- **改动路由**
- `jiuwenswarm/channels/cli/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/jiuwenswarm-channels-cli.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/chat.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/gateway_client.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/events.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/cli/render.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channels/cli/test_chat.py
