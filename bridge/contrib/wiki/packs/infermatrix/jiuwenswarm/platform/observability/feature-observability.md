---
name: feature-observability
description: 执行轨迹与保留的职责、接口与配置：TrajectoryRecordSink 与路由器入口、logging.* 配置键、实时队列与持久轨迹的设计取舍、数据流与验证步骤
metadata:
  scope: 只收 observability 功能的职责、API、配置、取舍、数据流与验证概览；实现深读归 feature-depth-observability，Debug Dump 与 OTel 归 feature-debug-trace
---
# 执行轨迹与保留 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/feature-observability.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/日志.md
- 源页字段（feature）：observability
- 入口（entry_points）：jiuwenswarm/observability/sink.py
- 源页字段（source_globs）：jiuwenswarm/observability/sink.py；jiuwenswarm/observability/*.py；jiuwenswarm/agents/harness/agent_observability.py；jiuwenswarm/observability/store.py；jiuwenswarm/channels/ide/packages/shared-webview/chat.html
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/compaction.ts；jiuwenbox/src/jiuwenbox/server/app.py；jiuwenbox/src/jiuwenbox/server/audit_logger.py；jiuwenbox/src/jiuwenbox/models/common.py
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/cjkFriendlyStrong.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/mathCompatibility.ts
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/parse.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/plain-text.ts；jiuwenswarm/agents/harness/observability_runtime.py
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/shared/otlp.ts；jiuwenswarm/observability/otlp_payload.py；jiuwenswarm/channels/web/frontend/src/features/trajectory/semconv/attributes.ts
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/pointer-grace.ts；jiuwenswarm/common/runtime_log_filter.py；jiuwenbox/src/jiuwenbox/server/sandbox_manager.py；jiuwenswarm/agents/harness/team/team_manager.py
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/teamTrajectoryLanes.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryArchive.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/TrajectoryPanel.tsx
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/otel-trajectory-projector.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/attribute-resolver.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/index.ts
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/preview.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryCheckpoints.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/CodeBlock.module.css
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/markdown/CodeBlock.tsx；scripts/reset_trajectory_data.py；jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryTable.tsx
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/Menu.module.css；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/Menu.tsx；jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryExplorer.tsx
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/client/i18n.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/client/theme.css；jiuwenswarm/observability/gateway_hints.py；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/icons/index.tsx
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/icons/props.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/JsonTree.module.css；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/JsonTree.tsx
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/virtual-rows.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/model.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/record.ts
  - jiuwenswarm/observability/models.py；jiuwenswarm/observability/retention.py；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/search-index.ts；jiuwenswarm/observability/__init__.py；jiuwenswarm/observability/config.py
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryFrames.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectorySubjects.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/theme/base.css
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/theme/context.tsx；jiuwenswarm/channels/web/frontend/src/features/trajectory/theme/design-platform.css；jiuwenswarm/channels/web/frontend/src/features/trajectory/theme/gradient-shadow-text.css
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/theme/scrollbar.css；jiuwenswarm/channels/web/frontend/src/features/trajectory/theme/shiki.css；jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryTimeline.module.css
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryTimeline.tsx；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectory/timeline.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryToolbar.module.css
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/client/TrajectoryToolbar.tsx；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/Tooltip.module.css；jiuwenswarm/channels/web/frontend/src/features/trajectory/primitives/Tooltip.tsx
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryTurnGaps.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/featureConfig.ts；jiuwenswarm/gateway/message_handler/message_handler.py
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/projector/trajectory-v2-reducer.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryLayout.ts；jiuwenswarm/channels/web/frontend/src/features/trajectory/trajectoryWindow.ts
  - jiuwenswarm/channels/web/frontend/src/features/trajectory/TeamTrajectoryWorkspace.tsx；jiuwenswarm/gateway/channel_manager/web/web_connect.py；jiuwenswarm/channels/web/frontend/src/App.tsx；jiuwenswarm/channels/web/frontend/src/App.css
  - jiuwenswarm/channels/browser/frontend/src/webview/chat.html
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 轨迹系统把执行事件投影为可保存和可展示的记录。实时队列、最终结果和保留清理的职责不同，查看器中的缺口不自动证明任务未执行。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/observability/sink.py:L1–L1016](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L1-L1016)；
  - [docs/zh/日志.md:L1–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%97%A5%E5%BF%97.md#L1-L245)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `TrajectoryRecordSink [start, consume, consume_snapshot, consume_stream_frame, request_stop]`；`TrajectorySessionSinkRouter [start, consume, consume_snapshot, consume_stream_frame, close]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/observability/sink.py:L1–L1016](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L1-L1016)；
  - [docs/zh/日志.md:L1–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%97%A5%E5%BF%97.md#L1-L245)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `logging.level`、`logging.console_level`、`logging.gateway`、`logging.channel`、`logging.agent_server`、`logging.full`。这些是示例字段，不单独证明源码默认值或全部优先级。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/observability/sink.py:L1–L1016](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L1-L1016)；
  - [docs/zh/日志.md:L1–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%97%A5%E5%BF%97.md#L1-L245)。

### 设计取舍

- **设计推断**：实时队列与持久轨迹让执行可观察，保留清理限制长期存储；代价是展示、最终结果和落盘不处在完全相同的时序。应用日志与框架日志独立，某个查看器缺记录不能单独证明 Agent 没有执行。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/observability/sink.py:L1–L1016](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L1-L1016)；
  - [docs/zh/日志.md:L1–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%97%A5%E5%BF%97.md#L1-L245)。

### 数据流与关联功能

- 轨迹系统把执行事件投影为可保存和可展示的记录。实时队列、最终结果和保留清理的职责不同，查看器中的缺口不自动证明任务未执行。 联调时结合[[feature-debug-trace]]（Debug Dump 与 OTel）、[[feature-ttse]]（FACT/TIP 双轨经验）、[[feature-harness]]（Agent Loop 与 Rail 装配）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/observability/sink.py:L1–L1016](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L1-L1016)；
  - [docs/zh/日志.md:L1–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%97%A5%E5%BF%97.md#L1-L245)。

### 怎样验证

- 完成一次含工具与子任务的运行，核对事件身份、最终结果和持久记录。检查日志轮转、保留清理、消费者中断与重复事件，再分别定位应用层日志和框架层日志的输出路径。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/observability/sink.py:L1–L1016](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L1-L1016)；
  - [docs/zh/日志.md:L1–L245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%97%A5%E5%BF%97.md#L1-L245)。
