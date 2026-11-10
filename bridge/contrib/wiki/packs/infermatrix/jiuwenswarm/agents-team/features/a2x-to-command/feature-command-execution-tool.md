---
name: feature-command-execution-tool
description: mcp_exec_command 跨平台命令执行工具：设置项与默认值（超时上限等）、公开契约、请求局部沙箱绑定、fail-closed 沙箱取舍与测试支撑点
metadata:
  scope: 只收mcp_exec_command 工具的契约与设置概览；实现深读归 feature-depth-command-execution-tool
---
# mcp_exec_command 跨平台命令执行工具

## 现状

- **设置项与默认值**
- 环境变量 `MCP_EXEC_COMMAND_MAX_TIMEOUT_SECONDS` 设定超时上限，未设置时默认 600（解析失败时取 3600），用户传入的 `timeout_seconds` 被夹到 `[1, max]`。非 Windows 上 `JW_START_NEW_SESSION`（默认 "true"，取值 `0/false/no/off` 之一则关闭）控制是否对子进程设置 `start_new_session=True`。
  - 沙箱路径下，启动器配置 `extra_params` 中 `fallback_on_failure` 为 True 或 `excluded_commands` 非空会被视为 host fallback 风险，命令被直接拒绝（fail-closed 错误），而非真正回退到宿主机执行。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/command_tools.py:L1129–L1145](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L1129-L1145),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L881–L885](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L881-L885),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L990–L1020](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L990-L1020)
- **测试支撑点**
- 模块暴露 `reset_tui_spawn_history()`，docstring 标注用于测试，可清空 `_TUI_SPAWN_HISTORY` 来重置 TUI spawn 预算状态。TUI 预算的过期桶由 `_purge_stale_tui_spawn_buckets` 机会式清理（每窗口至多一次，删除全部条目均已过期的桶），防止会话字典无限增长。所示文件片段中没有出现其他测试入口。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/command_tools.py:L83–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L83-L103),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L1221–L1223](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L1221-L1223)
- **Fail-closed sandbox vs. string-based safety analysis**
- Inference / 设计推断（非作者历史意图）：
- Sandbox integrity is prioritized over availability:
  - any sandbox config that could route to the host (`fallback_on_failure=true` or `excluded_commands`) causes an outright `[ERROR]: ... failed closed` refusal rather than attempted execution — the shown tests confirm no shell calls occur in that case.
  - The safety layer relies on regex-based command inspection (`_check_command_safety` over `_DANGEROUS_COMMAND_PATTERNS` and PID-target analysis), which is portable across cmd/PowerShell/POSIX but inherently pattern-matching rather than a true parser;
  - the TUI budget comment explicitly accepts false positives ("loose" `.spec.ts` pattern) as the cost of throttling.
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/command_tools.py:L990–L1023](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L990-L1023),
  - [tests/unit_tests/agents/test_command_tools_sandbox.py:L179–L192](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_command_tools_sandbox.py#L179-L192),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L69–L76](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L69-L76)
- **mcp_exec_command 的公开契约**
- 工具以 `@tool(name="mcp_exec_command")` 暴露，签名为 `mcp_exec_command(command, timeout_seconds=300, workdir=".", max_output_chars=0, shell_type="auto", background=False)`，描述字符串声明支持 Windows cmd/PowerShell 与 macOS/Linux bash/sh。
  - 返回值是字符串：前台成功时返回缩进 JSON（含 command/cwd/shell_type/resolved_shell/exit_code/stdout/stderr，stdout/stderr 经 `max_output_chars` 截断）；`background=True` 成功时返回含 pid/status="started" 的 JSON；取消、超时与启动失败等错误路径返回 `[ERROR]: ...` 或含 `cancelled: True` 的 JSON 载荷。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/command_tools.py:L1086–L1106](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L1086-L1106),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L1209–L1218](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L1209-L1218),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L1160–L1181](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L1160-L1181)
- **请求局部绑定决定沙箱或宿主执行路径**
- 入口在参数归一化后读取 `current_command_execution()`（基于 ContextVar 的请求局部绑定，由 `bind_command_execution(sys_operation, sandboxed=...)` 设置、`reset_command_execution(token)` 恢复）：存在 sandboxed 绑定时整体交给 `_run_command_in_bound_sandbox`，先做 fail-closed 的 host-fallback 检查，
  - 再调用绑定对象的 `shell().execute_cmd/execute_cmd_background`；无绑定时走宿主路径，前台执行经 `asyncio.to_thread(_run_command_sync, ...)`——它用 0.1s 轮询循环检查超时与取消标志，仅当剥离空白后的 session_id 非空才 `register_shell_process` 注册进程以便取消，最后在 finally 中注销并关闭管道 FD。
- Sources / 来源：[jiuwenswarm/agents/harness/common/tools/command_execution_context.py:L24–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_execution_context.py#L24-L60),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L1146–L1158](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L1146-L1158),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L871–L898](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L871-L898),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L910–L941](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L910-L941)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-command-execution-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L1129-L1145；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L881-L885
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L990-L1020；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L83-L103
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L1221-L1223；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L990-L1023
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_command_tools_sandbox.py:L179-L192；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L69-L76
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L1086-L1106；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L1209-L1218
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L1160-L1181；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_execution_context.py:L24-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L1146-L1158；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L871-L898
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L910-L941
- 源页字段（feature）：command-execution-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/command_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/command_tools.py；jiuwenswarm/agents/harness/common/tools/command_execution_context.py；jiuwenswarm/agents/harness/common/tools/command_runtime.py
