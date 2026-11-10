---
name: feature-cli
description: 交互式命令行（jiuwenswarm chat，jiuwenswarm/cli/main.py）概览：职责与边界、接口入口、--mode/--session/--cwd/--project-dir/--trusted-dir/--gateway-url 选项、设计取舍、关联功能与验证步骤
metadata:
  scope: 交互式命令行的职责边界、调用入口、配置选项、取舍、关联功能和建议验证步骤；main() 流程、dotenv、/tui 复用与 TestInteractiveLoop 测试归 feature-depth-cli
---
# 交互式命令行 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-cli.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/cli/main.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/命令行指令.md
- 源页字段（feature）：cli
- 入口（entry_points）：jiuwenswarm/cli/main.py
- 源页字段（source_globs）：jiuwenswarm/cli/main.py；jiuwenswarm/cli/*.py；jiuwenswarm/channels/cli/chat.py；jiuwenswarm/channels/cli/main.py；jiuwenswarm/cli/_terminal.py；jiuwenswarm/cli/chat.py；jiuwenswarm/cli/gateway_client.py；jiuwenswarm/channels/cli/events.py；jiuwenswarm/channels/cli/gateway_client.py
  - jiuwenswarm/gateway/message_handler/prompts/__init__.py；jiuwenswarm/gateway/message_handler/prompts/review_prompt.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 终端入口负责命令解析、网关连接和事件展示。用户命令与 Agent 工具调用经过不同的入口，不能用相同名字推断相同的执行权限。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/cli/main.py:L1–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/main.py#L1-L11)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 接口与调用入口（API）

- 此入口通过模块装配和客户端协议参与功能。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/cli/main.py:L1–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/main.py#L1-L11)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 配置入口与生效条件

- 文档中的调用选项包括 `--mode`、`--session`、`--cwd`、`--project-dir`、`--trusted-dir`、`--gateway-url`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/cli/main.py:L1–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/main.py#L1-L11)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 设计取舍

- **设计推断**：终端 CLI 提供单次提问、会话复用和 REPL，适合轻量终端操作；代价是连接状态、事件渲染和退出码必须协调。Gateway 控制指令会被网关拦截，不能把它们与 Agent 自己解释的文本命令混为同一执行入口。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/cli/main.py:L1–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/main.py#L1-L11)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 数据流与关联功能

- 终端入口负责命令解析、网关连接和事件展示。用户命令与 Agent 工具调用经过不同的入口，不能用相同名字推断相同的执行权限。 联调时结合[[feature-process-cli]]（机器执行与本地 CLI）、[[feature-tui]]（TUI 对话与命令）、[[feature-modes]]（Agent、Code 与 Team 模式）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/cli/main.py:L1–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/main.py#L1-L11)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。

### 怎样验证

- 核对命令行模式参数、会话复用和两种输出模式；验证断连、Ctrl+C 和错误退出码。对控制指令确认网关改变会话或模式后，普通消息使用新状态且旧运行正确取消。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/cli/main.py:L1–L11](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/main.py#L1-L11)；
  - [docs/zh/命令行指令.md:L1–L357](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%91%BD%E4%BB%A4%E8%A1%8C%E6%8C%87%E4%BB%A4.md#L1-L357)。
