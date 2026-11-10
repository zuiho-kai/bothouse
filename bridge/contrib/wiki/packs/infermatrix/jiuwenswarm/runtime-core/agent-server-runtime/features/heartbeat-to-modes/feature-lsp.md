---
name: feature-lsp
description: LSP 代码智能功能入口：语言服务器符号、引用与诊断接入 Agent、_build_lsp_rail(workspace_dir) 与统一 lsp 工具的操作类型、project_dir 作初始化 cwd 与失败时返回无 Rail、设计推断、与编码记忆/VS Code/Agent Loop 的关联及验证步骤
metadata:
  scope: 只收该功能的职责、接口、配置、设计取舍、关联功能与验证六节；LspRail 构建的实现级证据归 feature-depth-lsp
---
# LSP 代码智能 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-lsp.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Harness.md
- 源页字段（feature）：lsp
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py；jiuwenswarm/agents/harness/common/rails/*
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- LSP 能力将语言服务器提供的符号、引用和诊断接入 Agent。工作区、语言服务器进程与工具注册各有生命期，获得一个诊断不代表整个项目已编译通过。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 接口与调用入口（API）

- Host 通过 _build_lsp_rail(workspace_dir) 创建 LspRail，并将项目目录传给 InitializeOptions 的 cwd。LspRail 注册统一 lsp 工具，按操作类型执行定义、引用、符号、调用层级和诊断查询；工具及语言服务器生命周期由 agent-core 提供，初始化失败会返回无 Rail。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 配置入口与生效条件

- Code 宿主把 project_dir 作为 LSP 初始化 cwd，语言服务器及其配置必须与项目语言一致。LspRail 的装配取决于 Code 模式 rail 构建路径和 agent-core 依赖；此处没有证据将 BROWSER_DRIVER 或额外目录环境变量作为 LSP 专用设置。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 设计取舍

- **设计推断**：语言服务器提供符号与诊断，比纯文本匹配更了解代码结构；代价是服务器进程、语言配置和当前 workspace 必须匹配。诊断会在修改后及后续调用中反馈，但语言服务器结果不能替代整个项目的构建与测试。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 数据流与关联功能

- LSP 能力将语言服务器提供的符号、引用和诊断接入 Agent。工作区、语言服务器进程与工具注册各有生命期，获得一个诊断不代表整个项目已编译通过。 联调时结合[[feature-coding-memory]]（Code 模式编码记忆）、[[feature-vscode]]（VS Code 客户端）、[[feature-harness]]（Agent Loop 与 Rail 装配）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 怎样验证

- 验证定义、引用、符号及诊断操作指向当前项目，修改代码后核对诊断更新。覆盖缺少语言服务器、初始化失败、切换项目和 Rail 卸载，检查工具注销与 subsystem 关闭。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。
