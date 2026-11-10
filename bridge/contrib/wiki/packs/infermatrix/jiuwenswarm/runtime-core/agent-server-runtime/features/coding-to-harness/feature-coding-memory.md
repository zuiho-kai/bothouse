---
name: feature-coding-memory
description: Code 模式编码记忆功能入口：CodingMemoryRail 注册 coding_memory_read/write/edit 与 interface_code.py 的装配、modes.code.memory.enabled 与 modes.code.embedding_config 配置及缺 Embedding 降级、项目级记忆目录、设计推断与读写编辑验证步骤
metadata:
  scope: 只收该功能的职责、接口、配置、设计取舍、关联功能与验证六节；实现级调用链与目录解析细节归 feature-depth-coding-memory
---
# Code 模式编码记忆 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-coding-memory.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/编码记忆.md
- 源页字段（feature）：coding-memory
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py；jiuwenswarm/agents/harness/code/*；jiuwenswarm/common/coding_memory_paths.py；jiuwenswarm/agents/harness/common/rails/project_memory/__init__.py；jiuwenswarm/agents/harness/common/rails/project_memory/files.py
  - jiuwenswarm/agents/harness/common/rails/project_memory_rail.py；jiuwenswarm/agents/harness/common/rails/project_memory/section.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- Code 模式提供面向源码任务的记忆读写和上下文复用。编码记忆与一般会话历史用途不同，工具注册、Embedding 配置和工作区关系需要一起检查。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/编码记忆.md:L1–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BC%96%E7%A0%81%E8%AE%B0%E5%BF%86.md#L1-L102)。

### 接口与调用入口（API）

- CodingMemoryRail 注册 coding_memory_read、coding_memory_write、coding_memory_edit，Host 的 create_coding_memory_rail 与 _build_coding_memory_rail 负责项目路径、Embedding 和缓存装配。它们面向持久编码上下文，项目规则文件加载另由 ProjectMemoryRail 承担，不能将三种记忆入口视作同一文件。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/编码记忆.md:L1–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BC%96%E7%A0%81%E8%AE%B0%E5%BF%86.md#L1-L102)。

### 配置入口与生效条件

- 源码以 modes.code.memory.enabled 控制 CodingMemoryRail，并使用 modes.code.embedding_config；Embedding 配置不完整时允许降级。配置重载通过指纹判断缓存复用，实际记忆目录按项目解析；自动提取另受 modes.code.memory.auto_coding_memory 控制，开关职责不同。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/编码记忆.md:L1–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BC%96%E7%A0%81%E8%AE%B0%E5%BF%86.md#L1-L102)。

### 设计取舍

- **设计推断**：编码记忆以项目为边界提供持久代码上下文，区别于完整聊天历史；代价是 workspace 解析和 Embedding 配置会影响复用。源码允许缺少完整 Embedding 时降级，因此工具可用与语义检索质量要分开检查。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/编码记忆.md:L1–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BC%96%E7%A0%81%E8%AE%B0%E5%BF%86.md#L1-L102)。

### 数据流与关联功能

- Code 模式提供面向源码任务的记忆读写和上下文复用。编码记忆与一般会话历史用途不同，工具注册、Embedding 配置和工作区关系需要一起检查。 联调时结合[[feature-auto-memory]]（对话后自动记忆）、[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）、[[feature-lsp]]（LSP 代码智能）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/编码记忆.md:L1–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BC%96%E7%A0%81%E8%AE%B0%E5%BF%86.md#L1-L102)。

### 怎样验证

- 在 Code 模式分别调用 read、write、edit，核对项目记忆文件与更新结果。覆盖切换项目、禁用 memory、缺少 Embedding 配置及 rail 重装配，检查主代理与代码子代理采用相同的项目边界。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/编码记忆.md:L1–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BC%96%E7%A0%81%E8%AE%B0%E5%BF%86.md#L1-L102)。
