---
name: feature-depth-command-execution-tool
description: mcp_exec_command 实现深读：入口的空命令、安全检查与限流、bind_command_execution、JW_START_NEW_SESSION、workdir 越界校验、沙箱绑定测试与轮询取消取舍
metadata:
  scope: 只收mcp_exec_command 的入口、环境变量、路径校验与沙箱路径的实现细节；功能概览归 feature-command-execution-tool
---
# mcp_exec_command 跨平台命令执行工具：实现深读

## 现状

- [[feature-command-execution-tool]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **mcp_exec_command 入口：空命令/安全检查/限流后解析 workdir 并钳制超时** 命令先 strip，为空返回 "[ERROR]: command cannot be empty."；随后 _check_command_safety 拒绝、按会话执行 TUI spawn 限流；_resolve_command_workdir 抛异常时返回 "[ERROR]: workdir is outside project workspace."；timeout_seconds 与环境变量上限（默认 600）取 min 后至少为 1。
- 来源：[jiuwenswarm/agents/harness/common/tools/command_tools.py:L1099–L1139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L1099-L1139)
- **bind_command_execution(sys_operation, *, sandboxed) 返回 Token 并要求非空对象** bind_command_execution 把 sys_operation 与布尔 sandboxed 存入冻结 dataclass 并经 ContextVar.set 返回 Token；sys_operation 为 None 抛 ValueError，sandboxed 非 bool 抛 TypeError。调用方须以 reset_command_execution(token) 还原。
- 来源：[jiuwenswarm/agents/harness/common/tools/command_execution_context.py:L10–L42](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_execution_context.py#L10-L42),
  - [jiuwenswarm/agents/harness/common/tools/command_execution_context.py:L57–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_execution_context.py#L57-L60)
- **JW_START_NEW_SESSION 默认启用子进程新会话（非 Windows）** 在 _run_command_sync 中，当 os.name != "nt" 时读取环境变量 JW_START_NEW_SESSION，默认 "true"；仅当取值属于 ("0","false","no","off") 才不设置 popen_kw["start_new_session"]=True。
- 来源：[jiuwenswarm/agents/harness/common/tools/command_tools.py:L878–L884](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L878-L884)
- **mcp_exec_command 依赖 openjiuwen 进程注册表与 command_runtime 的路径契约** command_tools.py 顶部从 openjiuwen shell_process_registry 导入注册/终止/取消消费函数，并复用 command_runtime.resolve_command_workdir：候选目录必须位于 project_root、workspace_root 或 agent_workspace_root 之内，否则抛出 ValueError("workdir is outside project workspace")。
- 来源：[jiuwenswarm/agents/harness/common/tools/command_tools.py:L20–L36](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L20-L36),
  - [jiuwenswarm/agents/harness/common/tools/command_runtime.py:L35–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_runtime.py#L35-L60)
- **workdir 越界抛 ValueError("workdir is outside project workspace")** resolve_command_workdir 将候选路径 resolve 后须落在 project_root、可选 workspace_root 或 agent_workspace_root 之一内，否则抛 ValueError；工具层捕获后返回错误字符串且不调用 shell（测试断言 calls == []）。
- 来源：[jiuwenswarm/agents/harness/common/tools/command_runtime.py:L35–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_runtime.py#L35-L60),
  - [jiuwenswarm/agents/harness/common/tools/command_tools.py:L1124–L1127](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L1124-L1127),
  - [tests/unit_tests/agents/test_command_tools_sandbox.py:L156–L168](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_command_tools_sandbox.py#L156-L168)
- **沙箱绑定运行时测试：前台路径经 execute_cmd 且复位后绑定清除** test_bound_sandbox_foreground_never_uses_host_subprocess 通过 mcp_exec_command._func 调用，断言 stdout 为 "A-stdout"、shell.calls 记录 ("printf ok", {cwd, timeout:17, shell_type:"bash"})，monkeypatch 使 _run_command_sync 触发 pytest.fail，
  - 且 reset 后 current_command_execution() 为 None。
- 来源：[tests/unit_tests/agents/test_command_tools_sandbox.py:L56–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_command_tools_sandbox.py#L56-L57),
  - [tests/unit_tests/agents/test_command_tools_sandbox.py:L66–L104](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/test_command_tools_sandbox.py#L66-L104)
- **轮询中即时取消检查的收益与 0.1 秒休眠成本（仅限未抛出的迭代）** 设计推断（非作者历史意图）：
- 收益（推断）：在进程运行期间，只要 sid 为真且 consume_shell_session_cancelled(sid) 返回真，循环先检查 deadline、再终止进程并抛出 CommandCancelled（L903–L912），使取消能在长命令中及时生效。成本（推断）：仅当该次迭代未触发超时（L904–L906）也未命中取消（L910–L912）而继续执行时，才调用 time.sleep(0.1)（L913）进入下一轮。
- 来源：[jiuwenswarm/agents/harness/common/tools/command_tools.py:L903–L913](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/command_tools.py#L903-L913)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-command-execution-tool.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L1099-L1139；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_execution_context.py:L10-L42
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_execution_context.py:L57-L60；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L878-L884
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_runtime.py:L35-L60；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L1124-L1127
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_command_tools_sandbox.py:L156-L168；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_command_tools_sandbox.py:L56-L57
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/test_command_tools_sandbox.py:L66-L104；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L20-L36
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/command_tools.py:L903-L913
- 源页字段（feature）：command-execution-tool
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/command_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/command_tools.py；jiuwenswarm/agents/harness/common/tools/command_execution_context.py；jiuwenswarm/agents/harness/common/tools/command_runtime.py
