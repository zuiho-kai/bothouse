---
name: feature-jiuwen-memory-sdk
description: JiuwenMemory 进程内 SDK 接入概览：build_external_memory_rail、mem2_search/mem2_add、memory.engine 与 jiuwen.mode=sdk 配置、取舍与验证方法
metadata:
  scope: 只收 JiuwenMemory SDK 接入的功能概览（guide）；builder 与配置读取的实现细节、默认值与单测归 feature-depth-jiuwen-memory-sdk
---
# JiuwenMemory 进程内 SDK 接入的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-jiuwen-memory-sdk.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_builder.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/memory/external_memory_config.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/JiuwenMemory-SDK接入.md
- 源页字段（feature）：jiuwen-memory-sdk
- 入口（entry_points）：jiuwenswarm/agents/harness/common/memory/external_memory_builder.py；jiuwenswarm/agents/harness/common/memory/external_memory_config.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/memory/external_memory_builder.py；jiuwenswarm/agents/harness/common/memory/external_memory_config.py
- 本页提供该能力的基本知识与验证入口，固定基线 `f0a69728c96b`。

### 职责与边界

- JiuwenMemory 是外接记忆 provider，SDK 模式在 JiuwenSwarm 进程内装配 agent-memory 内核，server 模式调用远端记忆服务。Host builder 选择 provider 并把顶层模型与 Embedding 配置交给内核，ExternalMemoryRail 在模型前检索、回合后沉淀；它区别于一次性 process 客户端 SDK。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L1–L491](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L1-L491)；
  - [jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L1–L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_config.py#L1-L250)；
  - [docs/zh/JiuwenMemory-SDK接入.md:L1–L581](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L1-L581)。

### 接口与调用入口（API）

- build_external_memory_rail(config) 是宿主装配入口，Jiuwen provider 的 SDK 分支调用 _build_jiuwen_sdk_config_dict 生成内核配置。Agent 可用 mem2_search 与 mem2_add，底层统一为 MemoryAPI 的 recall 与 write；Rail 自动 prefetch 和 sync_turn 不要求 Agent 显式调用这些工具。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L1–L491](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L1-L491)；
  - [jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L1–L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_config.py#L1-L250)；
  - [docs/zh/JiuwenMemory-SDK接入.md:L1–L581](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L1-L581)。

### 配置入口与生效条件

- 使用 memory.engine=external 或 both、memory.external.provider=jiuwenmemory 与 memory.external.jiuwen.mode=sdk 选择该路径。jiuwen.sdk 声明 KV、vector、fulltext 等后端；当前 builder 读取 kv_type/kv_url、vector_type/vector_url、db_type/db_url，并复用顶层默认模型与 embed 凭据；SDK 模式仍要求相同环境内安装 JiuwenMemory 和后端可达。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L1–L491](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L1-L491)；
  - [jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L1–L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_config.py#L1-L250)；
  - [docs/zh/JiuwenMemory-SDK接入.md:L1–L581](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L1-L581)。

### 设计取舍

- **设计推断**：进程内内核减少 HTTP 跳转并复用模型配置，代价是内核依赖与 backend 故障进入宿主进程生命周期。Rail 自动检索和沉淀让记忆发生在工具调用之外，观测时应检查上下文注入和后端写入，不能仅依靠消息中的工具名判断是否工作。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L1–L491](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L1-L491)；
  - [jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L1–L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_config.py#L1-L250)；
  - [docs/zh/JiuwenMemory-SDK接入.md:L1–L581](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L1-L581)。

### 数据流与关联功能

- 初始化 provider 后，模型调用前检索并将记忆标记为 recalled context，回合后通过 sync_turn 写入；mem2 工具提供显式补充路径。内置 Markdown 记忆、对话后 Auto Memory 和 JiuwenMemory 自动轨道各自处理不同存储与触发机制，项目或用户 scope 需沿 provider 的初始化核对。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L1–L491](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L1-L491)；
  - [jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L1–L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_config.py#L1-L250)；
  - [docs/zh/JiuwenMemory-SDK接入.md:L1–L581](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L1-L581)。

### 怎样验证

- 先在同一启动环境验证内核与 backend 连接，再结束一轮包含可辨识信息的对话并检查下一轮召回。覆盖缺少内核、读取超时、写入失败与 scope 隔离，核对熔断期间主对话可继续以及恢复后的记忆行为。本页未执行这些上游集成步骤。
- 源码与文档：[jiuwenswarm/agents/harness/common/memory/external_memory_builder.py:L1–L491](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_builder.py#L1-L491)；
  - [jiuwenswarm/agents/harness/common/memory/external_memory_config.py:L1–L250](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/memory/external_memory_config.py#L1-L250)；
  - [docs/zh/JiuwenMemory-SDK接入.md:L1–L581](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/JiuwenMemory-SDK%E6%8E%A5%E5%85%A5.md#L1-L581)。
