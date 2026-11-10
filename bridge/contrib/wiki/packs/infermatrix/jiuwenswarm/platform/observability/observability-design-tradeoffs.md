---
name: observability-design-tradeoffs
description: 轨迹队列与存储的设计取舍：事件生产与 SQLite 写入分离、流帧与最终记录分队列、有界内存下可见的流式缺口（sink.py）；含设计推断标注、关联功能与验证入口
metadata:
  scope: 只收 TrajectoryRecordSink 队列与写入取舍及其源码依据；实际队列配置与数据流见 jiuwenswarm-observability，保留与投影边界见 jiuwenswarm-trajectory-retention
---
# 轨迹队列与存储的设计取舍

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/observability/design-tradeoffs.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/observability/sink.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py
- 本页解释该组件的设计选择、代价与适用边界。基线为 `f0a69728c96b`。收益和替代方案分析标为**设计推断**，不把推断当成作者历史意图，也不代替规则页。

### 事件生产与 SQLite 写入分开

- TrajectoryRecordSink 使用有界队列和 writer thread。**设计推断**：将持久化工作移出事件生产调用，控制排队内存；代价是接受与提交存在时间差，统计 accepted 不能等同于已落盘，也不能仅凭架构推断具体吞吐提升。
- 源码依据：[jiuwenswarm/observability/sink.py:L73–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L73-L121)。

### 流帧和最终记录使用不同队列

- 源码注释明确，流帧产生速度可能挤掉最终记录，因此分开排队。**设计推断**：给权威最终结果保留独立的拥塞边界；代价是需要两类容量与统计，流式增量仍可能丢失，不能宣称分队列后所有事件都可靠交付。
- 源码依据：[jiuwenswarm/observability/sink.py:L90–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L90-L102)。

### 有界内存允许可见的流式缺口

- consume_stream_frame 在队列满时计数 dropped_frames，日志说明直到完整输出到来前可能出现缺口。**设计推断**：优先限制资源使用而不是阻塞整个生产链；实时 UI 应区分暂缺增量与最终完整输出，扩大队列是容量取舍，不是完整性证明。
- 源码依据：[jiuwenswarm/observability/sink.py:L261–L283](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/observability/sink.py#L261-L283)。

### API、配置与数据流入口

- 实际队列、批量、刷新与保留配置见[[jiuwenswarm-observability]]（轨迹架构）；数据库和查看器的边界见[[jiuwenswarm-trajectory-retention]]（保留与投影）。

### 关联功能

- 轨迹数据由 [[agent-runtime-overview]]（Runtime） 的执行产生；保留和删除与会话生命期相连，前端展示不能变成另一份执行状态权威。

### 怎样验证

- [tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_trajectory_runtime_wiring.py#L1-L25)
- 这些入口用于查找既有验证范围；源码阅读没有替代运行测试或真实服务验证。
