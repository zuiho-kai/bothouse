---
name: feature-debug-trace
description: Debug Dump 与 OTel 的职责、接口与配置：debug_trace 的 run 级调试追踪与可选 OTel 输出、DebugTraceSettings 与 resolve_debug_trace_settings、debug_trace/agent_observability 配置键、设计取舍与验证步骤
metadata:
  scope: 只收 debug-trace 功能的职责、API、配置、取舍、数据流与验证概览；实现深读归 feature-depth-debug-trace，轨迹存储与保留归 feature-observability
---
# Debug Dump 与 OTel 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/feature-debug-trace.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/config.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/debug_trace/stream_logger.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/调试追踪.md
- 源页字段（feature）：debug-trace
- 入口（entry_points）：jiuwenswarm/server/runtime/debug_trace/config.py；jiuwenswarm/server/runtime/debug_trace/stream_logger.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/debug_trace/config.py；jiuwenswarm/server/runtime/debug_trace/stream_logger.py；jiuwenswarm/server/runtime/debug_trace/*.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/common/debug_dump.py
  - jiuwenswarm/server/runtime/debug_trace/paths.py；jiuwenswarm/server/runtime/debug_trace/context.py；jiuwenswarm/server/runtime/debug_trace/directives.py；jiuwenswarm/server/runtime/debug_trace/subagent_capture.py；jiuwenswarm/server/runtime/debug_trace/task_tool_patch.py
  - jiuwenswarm/channels/web/frontend/vite.config.ts；deploy/observability/upload_traces_to_langfuse.py；jiuwenswarm/server/runtime/agent_adapter/team_helpers.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 调试追踪按 run 组织模型、工具和子代理行为，并可选择结构化 OTel 输出。本地 dump 与远端 trace 链路相互独立，查询和上传需要沿对应配置验证。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/server/runtime/debug_trace/config.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L1-L125)；
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L1–L600](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L1-L600)；
  - [docs/zh/调试追踪.md:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%B0%83%E8%AF%95%E8%BF%BD%E8%B8%AA.md#L1-L451)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `DebugTraceSettings`；`resolve_debug_trace_settings(mode, request_debug)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/server/runtime/debug_trace/config.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L1-L125)；
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L1–L600](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L1-L600)；
  - [docs/zh/调试追踪.md:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%B0%83%E8%AF%95%E8%BF%BD%E8%B8%AA.md#L1-L451)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `debug_trace.enabled`、`debug_trace.agent.include_subagent_flow`、`agent_observability.enabled`、`agent_observability.exporter`、`agent_observability.endpoint`、`agent_observability.sample_rate`、`agent_observability.langfuse_public_key`、`agent_observability.langfuse_secret_key`。
  - 这些是示例字段，不单独证明源码默认值或全部优先级。 文档中的调用选项包括 `--dir`、`--file`、`--endpoint`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/server/runtime/debug_trace/config.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L1-L125)；
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L1–L600](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L1-L600)；
  - [docs/zh/调试追踪.md:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%B0%83%E8%AF%95%E8%BF%BD%E8%B8%AA.md#L1-L451)。

### 设计取舍

- **设计推断**：本地 dump 与可选 OTel 输出独立，既能离线复盘又能做跨 run 聚合；代价是 trace_id、span 与本地运行身份必须可关联。采集成功、file exporter 落盘和远端上传是不同阶段，缺少远端 trace 不能直接判定本地调试失败。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/server/runtime/debug_trace/config.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L1-L125)；
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L1–L600](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L1-L600)；
  - [docs/zh/调试追踪.md:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%B0%83%E8%AF%95%E8%BF%BD%E8%B8%AA.md#L1-L451)。

### 数据流与关联功能

- 调试追踪按 run 组织模型、工具和子代理行为，并可选择结构化 OTel 输出。本地 dump 与远端 trace 链路相互独立，查询和上传需要沿对应配置验证。 联调时结合[[feature-observability]]（执行轨迹与保留）、[[feature-subagents]]（子代理派发与验证）、[[feature-models]]（模型平台与 API 配置）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/server/runtime/debug_trace/config.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L1-L125)；
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L1–L600](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L1-L600)；
  - [docs/zh/调试追踪.md:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%B0%83%E8%AF%95%E8%BF%BD%E8%B8%AA.md#L1-L451)。

### 怎样验证

- 在 Agent 与 Code 各运行一次模型和工具任务，核对 dump、token 记录和子代理数据。启用 OTel 后验证 span 关联与导出，再检查离线上传、网络失败、开关变化和取消后的文件收尾。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/server/runtime/debug_trace/config.py:L1–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/config.py#L1-L125)；
  - [jiuwenswarm/server/runtime/debug_trace/stream_logger.py:L1–L600](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/debug_trace/stream_logger.py#L1-L600)；
  - [docs/zh/调试追踪.md:L1–L451](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E8%B0%83%E8%AF%95%E8%BF%BD%E8%B8%AA.md#L1-L451)。
