---
name: gateway-channels-knowledge
description: 进程式 CLI 频道知识卡：验证入口（test_process_cli_session_runtime_live）、run_repl 入口与 worker 结果契约、会话 create/switch/fork/delete 与 /cancel 梯度中断、_worker_environment 与 _MODE_TARGETS 常量
metadata:
  scope: 只收进程式 CLI REPL、worker 与会话操作的知识卡；完整架构归 jiuwenswarm-channels-process-cli，机器模式归 jiuwenswarm-process-cli-machine，审查规则归 gateway-channels-rules
---
# 进程式 CLI 频道（process_cli）：REPL、worker 与会话操作

## 现状

- **验证入口**
- 维护者文档列出确定性 Runtime Session 测试与真实模型门禁：tests/system_tests/test_process_cli_session_runtime_live.py 覆盖 Work/Code 两轮恢复，以及 chat 与 Goal ask_user 首轮流结束后由回答恢复确切交互并得到终止响应；该文档自述 2026-09-10 全量受影响范围验证通过（四个配置模型门禁与 AgentServer/Gateway WebSocket 路由等）。
  - 代码内注释另指出 _run_worker 对无 stdout 读取器的“轻量进程替身”做了兼容，说明存在依赖该替身的频道生命周期测试。以上均为文档与代码可见证据，本轮输入未运行任何测试。
- Sources / 来源：[.doc_project_maintainer/project/flows/runtime-session-reference-chain.md:L66–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/.doc_project_maintainer/project/flows/runtime-session-reference-chain.md#L66-L70),
  - [.doc_project_maintainer/modules/runtime-session/README.md:L42–L45](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/.doc_project_maintainer/modules/runtime-session/README.md#L42-L45),
  - [jiuwenswarm/channels/process_cli/repl.py:L371–L379](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L371-L379)
- **入口与结果契约**
- 公开入口是 repl.run_repl(args) -> int，内部循环读取提示词并分发。_run_worker 返回 (return_code, next_session)：worker 退出码非 0/130 时向 stderr 输出含日志尾部的诊断；130（用户中断）由 repl.py 中 cancel_requested 或 CancelledError 分支赋值，app.run 遇到 CancelledError 则渲染中断事件后重新抛出而非返回 130。
  - 本地命令注册表由 commands.py 的 SLASH_COMMANDS 提供，parse_slash_command 把名称规范化为不带参数解释的 ParsedSlashCommand。
- Sources / 来源：[jiuwenswarm/channels/process_cli/repl.py:L407–L414](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L407-L414),
  - [jiuwenswarm/channels/process_cli/repl.py:L484–L487](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L484-L487),
  - [jiuwenswarm/channels/process_cli/commands.py:L75–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/commands.py#L75-L116)
- **会话操作与运行中输入**
- REPL 支持会话 create/switch（/resume、别名 /continue）/fork（/branch、别名 /fork）/delete：/delete 需交互确认，成功删除当前会话后清空 state.session_id；/sessions 打开分页浏览（n/p 翻页、s 搜索、序号选择）。chat 运行期间父进程把非斜杠输入作为补充转发到 worker stdin，并用 LiveTurnLayout 在单一 prompt 应用中展示请求、补充（含回执标记）、通知与模型输出；
  - /cancel 通过 SIGINT（Windows 为 CTRL_BREAK_EVENT）→ terminate → kill 的梯度中断 worker。
- Sources / 来源：[jiuwenswarm/channels/process_cli/repl.py:L228–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L228-L275),
  - [jiuwenswarm/channels/process_cli/repl.py:L297–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L297-L330),
  - [jiuwenswarm/channels/process_cli/repl.py:L738–L763](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L738-L763),
  - [jiuwenswarm/channels/process_cli/live_layout.py:L23–L61](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/live_layout.py#L23-L61)
- **Fixed worker environment, mode-target table, and interrupt grace constants**
- Configuration here is implemented constants and internal branch defaults rather than external settings. `_worker_environment()` copies the parent environment and forces `PYTHONIOENCODING=utf-8` and `PYTHONUTF8=1` so the parent/worker stdio pipes share one explicit wire encoding.
  - Interrupt handling uses fixed escalation timeouts: `_INTERRUPT_GRACE_SECONDS = 15.0` after SIGINT (CTRL_BREAK_EVENT on Windows, where the worker is launched with CREATE_NEW_PROCESS_GROUP), then `_TERMINATE_GRACE_SECONDS = 5.0`, then `_KILL_GRACE_SECONDS = 5.0`.
  - Mode selection is governed by the `_MODE_TARGETS` table in commands.py, which normalizes aliases like `agent`, `code.team`, or `team.normal` to canonical `*.normal` Runtime modes (e.g. `team` → `team.work.normal`).
- Sources / 来源：[jiuwenswarm/channels/process_cli/repl.py:L61–L66](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L61-L66),
  - [jiuwenswarm/channels/process_cli/repl.py:L81–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L81-L87),
  - [jiuwenswarm/channels/process_cli/repl.py:L297–L330](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/repl.py#L297-L330),
  - [jiuwenswarm/channels/process_cli/commands.py:L42–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/commands.py#L42-L57)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/knowledge.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:.doc_project_maintainer/project/flows/runtime-session-reference-chain.md:L66-L70；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:.doc_project_maintainer/modules/runtime-session/README.md:L42-L45
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py:L371-L379；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py:L407-L414
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py:L484-L487；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/commands.py:L75-L116
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py:L228-L275；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py:L297-L330
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py:L738-L763；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/live_layout.py:L23-L61
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py:L61-L66；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/repl.py:L81-L87
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/commands.py:L42-L57
