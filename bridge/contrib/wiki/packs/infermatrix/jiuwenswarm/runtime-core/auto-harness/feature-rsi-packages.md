---
name: feature-rsi-packages
description: Harness Package 与热激活功能知识：RSI 服务的 Package/任务/激活边界、harness_activation.py 中 parse_published_harness_refs、hash_harness_package、RsiHarnessActivationStore 等定位入口、生效条件、取舍与验证步骤
metadata:
  scope: 只收功能入口级知识（职责、API 定位、配置、取舍、关联功能、验证）；评测优化 pipeline 归 feature-auto-harness，逐点实现细节归 feature-depth-rsi-packages
---
# Harness Package 与热激活 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/auto-harness/feature-rsi-packages.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/common/rsi/harness_activation.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/AutoHarness.md
- 源页字段（feature）：rsi-packages
- 入口（entry_points）：jiuwenswarm/agents/harness/common/rsi/harness_activation.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/common/rsi/harness_activation.py；jiuwenswarm/agents/harness/common/rsi/*；jiuwenswarm/agents/harness/common/auto_harness/service.py；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py；jiuwenswarm/agents/harness/common/rsi/plugin_catalog.py
  - jiuwenswarm/channels/web/frontend/src/features/rsi/rsiApi.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- RSI 服务负责 Package、任务与激活相关边界。生成文件、物化 Package 和让当前运行时采用该 Package 是不同步骤，失败恢复需要查看各自状态。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L1–L995](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L1-L995)；
  - [docs/zh/AutoHarness.md:L1–L311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AutoHarness.md#L1-L311)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `PublishedHarnessRef [config_path]`；`resolve_native_harness_baseline()`；`parse_published_harness_refs(refs_path, task_run_root)`；`hash_harness_package(package_path)`；`RsiHarnessActivationStore [validate_runtime_path, get_active, list_history, list_versions, get_version]`。
  - 这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L1–L995](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L1-L995)；
  - [docs/zh/AutoHarness.md:L1–L311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AutoHarness.md#L1-L311)。

### 配置入口与生效条件

- 文档中的调用选项包括 `--pipeline`、`--interval`、`--history`、`--repo`、`--page`、`--labels`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L1–L995](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L1-L995)；
  - [docs/zh/AutoHarness.md:L1–L311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AutoHarness.md#L1-L311)。

### 设计取舍

- **设计推断**：Package 将可激活的 Harness 产物与生成任务分开，便于选择和回退运行配置；代价是生成、物化、注册与热激活必须分别追踪。文件存在不说明当前 Agent 已采用该 Package，激活边界还需检查会话和运行时状态。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L1–L995](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L1-L995)；
  - [docs/zh/AutoHarness.md:L1–L311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AutoHarness.md#L1-L311)。

### 数据流与关联功能

- RSI 服务负责 Package、任务与激活相关边界。生成文件、物化 Package 和让当前运行时采用该 Package 是不同步骤，失败恢复需要查看各自状态。 联调时结合[[feature-auto-harness]]（Auto Harness 评测优化）、[[feature-harness]]（Agent Loop 与 Rail 装配）、[[feature-modes]]（Agent、Code 与 Team 模式）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L1–L995](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L1-L995)；
  - [docs/zh/AutoHarness.md:L1–L311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AutoHarness.md#L1-L311)。

### 怎样验证

- 创建并物化一个最小 Package，核对注册信息、激活状态与实际装配。覆盖无效包、激活失败和切换回原配置；检查运行中会话与后续会话采用哪个版本，避免只验证磁盘文件。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/common/rsi/harness_activation.py:L1–L995](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rsi/harness_activation.py#L1-L995)；
  - [docs/zh/AutoHarness.md:L1–L311](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/AutoHarness.md#L1-L311)。
