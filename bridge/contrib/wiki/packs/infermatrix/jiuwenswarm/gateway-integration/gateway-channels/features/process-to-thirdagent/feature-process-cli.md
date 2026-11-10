---
name: feature-process-cli
description: 机器执行与本地 CLI（channels/process_cli/app.py）职责、接口与配置：run(args, stdout, stderr) 入口、SDK command/cwd/env 与 process 协议、一次进程一次调用的取舍、成功/错误/超时/取消的验证步骤
metadata:
  scope: 只收进程式 CLI 入口的职责、API 定位、配置边界、设计推断、关联功能与建议验证；逐函数实现与单测断言归 feature-depth-process-cli
---
# 机器执行与本地 CLI 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-process-cli.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/app.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/命令行指令.md
- 源页字段（feature）：process-cli
- 入口（entry_points）：jiuwenswarm/channels/process_cli/app.py
- 源页字段（source_globs）：jiuwenswarm/channels/process_cli/app.py；jiuwenswarm/channels/process_cli/*.py；jiuwenswarm/channels/process_cli/machine_signals.py；jiuwenswarm/channels/process_cli/control_commands.py；jiuwenswarm/channels/process_cli/display_context.py
  - jiuwenswarm/channels/process_cli/duplex_control.py；jiuwenswarm/channels/process_cli/duplex_protocol.py；jiuwenswarm/channels/process_cli/duplex_input.py；jiuwenswarm/channels/process_cli/main.py；jiuwenswarm/channels/process_cli/render.py
  - jiuwenswarm/channels/process_cli/client.py；jiuwenswarm/channels/process_cli/live_input.py；jiuwenswarm/channels/process_cli/live_layout.py；jiuwenswarm/channels/process_cli/machine.py；jiuwenswarm/channels/process_cli/protocol/model.py
  - jiuwenswarm/channels/process_cli/protocol/version.py；jiuwenswarm/channels/process_cli/protocol/__init__.py；jiuwenswarm/channels/process_cli/protocol/jsonl.py；jiuwenswarm/channels/process_cli/protocol/query.py；jiuwenswarm/channels/process_cli/query.py
  - jiuwenswarm/channels/process_cli/query_entry.py；jiuwenswarm/channels/process_cli/repl.py；jiuwenswarm/channels/process_cli/ui.py；jiuwenswarm/channels/process_cli/machine_result.py；jiuwenswarm/channels/process_cli/session_guard.py；jiuwenswarm/channels/process_cli/commands.py
  - jiuwenswarm/channels/process_cli/prompt.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 进程式入口通过 Runtime 公共契约准备、执行和提交会话操作。机器输出、交互渲染与操作提交的时序需要分别理解。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/channels/process_cli/app.py:L1–L941](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L1-L941)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `run(args, stdout, stderr)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/channels/process_cli/app.py:L1–L941](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L1-L941)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 配置入口与生效条件

- 进程式入口的机器请求与 Runtime 参数由调用契约提供，SDK 的 command、cwd 和 env 决定子进程环境。模式、会话和运行 timeout 应按 process 协议核对；交互式 chat 的 gateway-url 等选项属于另一个入口，不能直接当成 process 请求字段。
- 源码与文档：[jiuwenswarm/channels/process_cli/app.py:L1–L941](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L1-L941)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 设计取舍

- **设计推断**：一次进程围绕一次调用建立与清理 Runtime，便于机器程序得到明确的完成与退出边界；代价是调用之间不能复用活 Runtime。机器事件、交互请求与最终结果分别交付，调用方需要处理这些状态而非只读取最后一行文本。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/channels/process_cli/app.py:L1–L941](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L1-L941)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 数据流与关联功能

- 进程式入口通过 Runtime 公共契约准备、执行和提交会话操作。机器输出、交互渲染与操作提交的时序需要分别理解。 联调时结合[[feature-sdk]]（Python 与 TypeScript SDK）、[[feature-cli]]（交互式命令行）、[[feature-e2a]]（E2A 统一请求响应协议）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/channels/process_cli/app.py:L1–L941](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L1-L941)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 怎样验证

- 分别验证成功、Runtime 错误、需要人工交互、超时和取消时的事件、最终结果与退出码。检查宿主停止读取或中断后子进程和 Runtime 已清理，避免把已收到 token 当成调用已经成功完成。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/channels/process_cli/app.py:L1–L941](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L1-L941)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。
