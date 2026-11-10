---
name: feature-auto-memory
description: 对话后自动记忆的职责边界、接口入口、auto_memory_enabled 与 modes.code.memory.auto_coding_memory 配置、设计取舍、数据流与验证方法
metadata:
  scope: 只收对话后自动记忆的功能概览（职责、入口、配置、取舍、验证）；实现深读归 feature-depth-auto-memory
---
# 对话后自动记忆 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-auto-memory.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/自动记忆.md
- 源页字段（feature）：auto-memory
- 入口（entry_points）：jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py；jiuwenswarm/agents/harness/common/auto_memory/*；jiuwenswarm/agents/harness/common/auto_memory/__init__.py；jiuwenswarm/agents/harness/common/auto_memory/extract_memories.py
  - jiuwenswarm/agents/harness/common/auto_memory/prompts.py；jiuwenswarm/agents/harness/common/auto_memory/tool_restriction_rail.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 对话完成后的提取流程将可长期使用的信息写入记忆。Agent 与 Code 的启用键不同，并存在项目隔离边界，排障时需要确认对应模式的开关与路径。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L1–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L1-L479)；
  - [docs/zh/自动记忆.md:L1–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L1-L161)。

### 接口与调用入口（API）

- 此入口通过模块装配和客户端协议参与功能。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L1–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L1-L479)；
  - [docs/zh/自动记忆.md:L1–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L1-L161)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `auto_memory_enabled`、`modes.code.memory.auto_coding_memory`。这些是示例字段，不单独证明源码默认值或全部优先级。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L1–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L1-L479)；
  - [docs/zh/自动记忆.md:L1–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L1-L161)。

### 设计取舍

- **设计推断**：对话结束后提取可复用信息，降低手工维护记忆的负担；代价是提取结果存在延迟且受模式开关和项目路径影响。Agent 与 Code 使用不同配置键，不能由全局开关推断 Code 自动编码记忆已经开启。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L1–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L1-L479)；
  - [docs/zh/自动记忆.md:L1–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L1-L161)。

### 数据流与关联功能

- 对话完成后的提取流程将可长期使用的信息写入记忆。Agent 与 Code 的启用键不同，并存在项目隔离边界，排障时需要确认对应模式的开关与路径。 联调时结合[[feature-memory]]（长期记忆）、[[feature-coding-memory]]（Code 模式编码记忆）、[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L1–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L1-L479)；
  - [docs/zh/自动记忆.md:L1–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L1-L161)。

### 怎样验证

- 分别在 Agent 与 Code 开启对应开关，结束含可保留信息的对话，核对提取记录和项目记忆路径。切换项目并关闭开关验证隔离和停用，覆盖提取失败以及下一轮能否检索到保存内容。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py:L1–L479](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/auto_memory/extraction_runner.py#L1-L479)；
  - [docs/zh/自动记忆.md:L1–L161](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%87%AA%E5%8A%A8%E8%AE%B0%E5%BF%86.md#L1-L161)。
