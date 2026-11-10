---
name: feature-task-memory
description: 任务经验检索与沉淀功能概览：experience_retrieve、experience_learn、experience_clear、task_memory.* 配置键、memory_string 与 retrieved_memory 验证
metadata:
  scope: 只收任务经验的职责、接口入口、配置入口、设计取舍与验证方法（guide）；服务初始化链、降级行为、API_BASE 覆写等实现细节归 feature-depth-task-memory；长期记忆归 feature-memory
---
# 任务经验检索与沉淀 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-task-memory.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/tools/task_tools.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/经验记忆.md
- 源页字段（feature）：task-memory
- 入口（entry_points）：jiuwenswarm/agents/harness/common/tools/task_tools.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/tools/task_tools.py；jiuwenswarm/agents/harness/common/memory/*
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 任务经验支持检索、学习和摘要，将既有经验带到新任务中。检索算法、摘要算法和模型配置决定不同阶段的行为，结果需区分可读文本与结构化数据。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L1–L512](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L1-L512)；
  - [docs/zh/经验记忆.md:L1–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L1-L103)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `TaskAddParams`；`experience_retrieve(query)`；`experience_learn(params, matts)`；`experience_clear()`；`get_task_tools()`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L1–L512](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L1-L512)；
  - [docs/zh/经验记忆.md:L1–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L1-L103)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `task_memory.enabled`、`task_memory.retrieval_algo`、`task_memory.summary_algo`、`task_memory.llm_model`、`task_memory.embedding_model`、`task_memory.api_key`、`task_memory.api_base`。这些是示例字段，不单独证明源码默认值或全部优先级。
  - 实现中直接读取的环境变量名称包括 `API_KEY`、`API_BASE`、`MODEL_NAME`、`MODEL_PROVIDER`、`EMBEDDING_MODEL`；名称与实际部署值分开核对。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L1–L512](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L1-L512)；
  - [docs/zh/经验记忆.md:L1–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L1-L103)。

### 设计取舍

- **设计推断**：检索与摘要算法分别配置，便于按任务选择经验复用方式；代价是算法、模型和结构化结果需要保持契约一致。经验不是原始会话回放，清理与学习操作会改变后续检索的可用集合，必须区分文本摘要与原始结构化条目。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L1–L512](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L1-L512)；
  - [docs/zh/经验记忆.md:L1–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L1-L103)。

### 数据流与关联功能

- 任务经验支持检索、学习和摘要，将既有经验带到新任务中。检索算法、摘要算法和模型配置决定不同阶段的行为，结果需区分可读文本与结构化数据。 联调时结合[[feature-memory]]（长期记忆）、[[feature-ttse]]（FACT/TIP 双轨经验）、[[feature-planning]]（任务规划与 Todo）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L1–L512](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L1-L512)；
  - [docs/zh/经验记忆.md:L1–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L1-L103)。

### 怎样验证

- 学习一条可辨识经验，再查询并核对 memory_string 与 retrieved_memory 的对应关系。更换支持的检索和摘要算法验证边界，检查关闭功能、模型失败与清理后经验不再被召回。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/common/tools/task_tools.py:L1–L512](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/task_tools.py#L1-L512)；
  - [docs/zh/经验记忆.md:L1–L103](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E7%BB%8F%E9%AA%8C%E8%AE%B0%E5%BF%86.md#L1-L103)。
