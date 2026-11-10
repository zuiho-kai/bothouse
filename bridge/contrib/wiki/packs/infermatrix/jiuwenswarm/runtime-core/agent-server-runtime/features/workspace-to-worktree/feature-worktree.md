---
name: feature-worktree
description: Worktree 隔离工作知识入口：enter_worktree/exit_worktree 与 per-agent WorktreeManager 的职责边界、WorktreeConfig(enabled=True) 的配置现状、设计取舍、关联功能与验收步骤
metadata:
  scope: 只收职责、接口、配置、取舍、数据流与验证摘要，不证明所有 WorktreeConfig 字段可由 YAML 修改；缓存、降级与单测细节归 feature-depth-worktree
---
# Worktree 隔离工作 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-worktree.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_code.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/Harness.md
- 源页字段（feature）：worktree
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/interface_code.py；jiuwenswarm/agents/harness/common/rails/*；jiuwenswarm/channels/tui/frontend/src/core/event-handlers.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 工作树工具为代码操作提供独立的 Git 目录边界。进入和退出工作树需要和宿主工作区、进程与会话状态一起解释，目录隔离不等于所有外部资源隔离。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 接口与调用入口（API）

- Host 的 _build_worktree_rail_via_config 构造 WorktreeRail，注册 enter_worktree 与 exit_worktree。per-agent WorktreeManager 依据项目工作区决定 Git 仓库位置；退出操作允许保留或移除 worktree，后续文件和 shell 路径要与宿主 workspace 映射一起检查。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 配置入口与生效条件

- 当前 Host 创建 WorktreeConfig(enabled=True)，其他选项沿用 agent-core 默认值；通过配置 rail 构建路径挂载，已经缓存的实例会复用。该源码事实不能被改写成任意 WorktreeConfig 字段都可从全仓 YAML 修改，项目路径和 Git 仓库有效性仍是前置条件。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 设计取舍

- **设计推断**：per-agent Git worktree 为修改提供目录和分支隔离，便于并行实验与回滚；代价是宿主工作区映射、清理和保留选择必须协调。worktree 隔离的是 Git 文件视图，不能推断网络、端口或外部服务也已隔离。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 数据流与关联功能

- 工作树工具为代码操作提供独立的 Git 目录边界。进入和退出工作树需要和宿主工作区、进程与会话状态一起解释，目录隔离不等于所有外部资源隔离。 联调时结合[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）、[[feature-subagents]]（子代理派发与验证）、[[feature-sandbox]]（JiuwenBox 隔离执行）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。

### 怎样验证

- 进入 worktree 做最小修改，检查 Agent 文件和 shell 操作的 cwd 以及主工作区状态。分别退出保留与移除目录，覆盖非 Git 项目、取消和多 Agent 并行，核对会话工作区映射与资源收尾。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/agent_adapter/interface_code.py:L1–L2809](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_code.py#L1-L2809)；
  - [docs/zh/Harness.md:L1–L626](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/Harness.md#L1-L626)。
