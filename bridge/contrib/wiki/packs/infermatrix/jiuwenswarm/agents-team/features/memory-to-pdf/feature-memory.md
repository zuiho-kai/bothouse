---
name: feature-memory
description: 长期记忆的职责边界、SessionDeltaState 与向量编解码等接口入口、memory.dreaming 配置、本地 Markdown 与外接记忆取舍及验证方法
metadata:
  scope: 只收长期记忆的功能概览（职责、入口、配置、取舍、验证）；实现深读归 feature-depth-memory
---
# 长期记忆 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-memory.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/manager.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/记忆.md
- 源页字段（feature）：memory
- 入口（entry_points）：jiuwenswarm/agents/harness/common/memory/manager.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/memory/manager.py；jiuwenswarm/agents/harness/common/memory/*；jiuwenswarm/server/runtime/agent_adapter/interface.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/agents/harness/common/memory/dreaming/__init__.py
  - jiuwenswarm/agents/harness/common/memory/dreaming/sweeper.py；jiuwenswarm/agents/harness/common/memory/external_memory_config.py；jiuwenswarm/agents/harness/common/memory/external_memory_builder.py；jiuwenswarm/agents/harness/common/memory/forbidden.py
  - jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/memory_collector.py；jiuwenswarm/agents/harness/common/memory/embeddings.py；jiuwenswarm/agents/harness/common/tools/memory_tools.py；jiuwenswarm/common/config.py
  - jiuwenswarm/agents/harness/common/rails/memory_forbidden_rail.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py；jiuwenswarm/agents/harness/common/memory/internal.py；jiuwenswarm/agents/harness/common/memory/config.py
  - jiuwenswarm/agents/harness/common/memory/__init__.py；jiuwenswarm/agents/harness/common/memory/types.py；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/memory.ts；jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts
  - jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/memory-path-utils.ts；jiuwenswarm/channels/tui/frontend/src/app-state.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 记忆能力连接持久信息与当前 Agent 上下文。记忆工具、存储与检索边界需要分别定位，写入成功不等于下一次查询一定召回。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/manager.py:L1–L1255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L1-L1255)；
  - [docs/zh/记忆.md:L1–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%B0%E5%BF%86.md#L1-L415)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `SessionDeltaState`；`vector_to_blob(embedding)`；`blob_to_vector(blob)`；`MemoryIndexManager [get, sync, search, read_file, status]`；`clear_memory_manager_cache()`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/manager.py:L1–L1255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L1-L1255)；
  - [docs/zh/记忆.md:L1–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%B0%E5%BF%86.md#L1-L415)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `memory.dreaming.agent.enabled`、`memory.dreaming.agent.interval_seconds`、`memory.dreaming.code.enabled`、`memory.dreaming.code.interval_seconds`、`memory.engine`、`memory.external.provider`、`memory.external.user_id`、`memory.external.scope_id`。这些是示例字段，不单独证明源码默认值或全部优先级。
  - 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/manager.py:L1–L1255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L1-L1255)；
  - [docs/zh/记忆.md:L1–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%B0%E5%BF%86.md#L1-L415)。

### 设计取舍

- **设计推断**：本地 Markdown 记忆便于查看和管理，外接记忆提供服务化存储与检索；代价是两种引擎的同步、召回和故障边界不同。信息写入、索引更新和语义召回是三个步骤，睡时整理也需要避免混淆团队与个人工作区。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/manager.py:L1–L1255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L1-L1255)；
  - [docs/zh/记忆.md:L1–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%B0%E5%BF%86.md#L1-L415)。

### 数据流与关联功能

- 记忆能力连接持久信息与当前 Agent 上下文。记忆工具、存储与检索边界需要分别定位，写入成功不等于下一次查询一定召回。 联调时结合[[feature-auto-memory]]（对话后自动记忆）、[[feature-coding-memory]]（Code 模式编码记忆）、[[feature-task-memory]]（任务经验检索与沉淀）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/manager.py:L1–L1255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L1-L1255)；
  - [docs/zh/记忆.md:L1–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%B0%E5%BF%86.md#L1-L415)。

### 怎样验证

- 写入一条可识别记忆，核对文件或外部服务记录，再通过检索确认召回与来源。覆盖语义和关键词路径、整理前后内容及服务不可用，验证个人、项目和团队记忆的隔离。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/manager.py:L1–L1255](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/manager.py#L1-L1255)；
  - [docs/zh/记忆.md:L1–L415](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%AE%B0%E5%BF%86.md#L1-L415)。
