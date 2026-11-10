---
name: rules-npu-profiler
description: "NPU profiler 规则 EXEC-13g（PR #6518）：vllm_omni/platforms/npu/profiler.py 的 NPUTorchProfilerWrapper 默认 aic_metrics 使用 AiCMetrics.PipeUtilization，保留 Level1、CPU+NPU activities、offline analyse() 提示与 trace directory/handler 合同；该 telemetry default 不是 RainFusion/MiniMax-H3 kernel 的性能证据，PR #6518 未提交 profiler artifact"
metadata:
  scope: 只收 NPU trace 的 profiler metric、handler 与证据边界一条规则 EXEC-13g；其余 EXEC-13a 至 EXEC-13h 与 NPU runner 合同归 rules-platform-backends-1、rules-platform-backends-2
---
# NPU profiler 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-npu-profiler.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6518；vllm_omni/platforms/npu/profiler.py
- 置信度（confidence）：high
- [EXEC-13g] NPU profiler metric 必须显式保留 trace 的利用率语义
  - 触发：修改 `NPUTorchProfilerWrapper`、`torch_npu.profiler._ExperimentalConfig` 或 NPU trace 默认项。
  - 强制：默认 `aic_metrics` 使用 `AiCMetrics.PipeUtilization`，令导出的 Text/tensorboard trace 包含 operator-pipeline utilization；保留 Level1、CPU+NPU activities、offline `analyse()` 提示和现有 trace directory/handler 合同。
  - 验收：mock `torch_npu` profiler config，精确断言 metric enum、活动与 handler 参数；真实 NPU trace 另验证工具版本和可解析指标。PR #6518 没有提交该类 profiler artifact。^[PR #6518]

## 决策与踩坑

- [EXEC-13g] 禁止：把这个 telemetry default 说成 RainFusion/MiniMax-H3 kernel 的性能或质量证据，或由它推断任何 Ascend SKU 的 utilization 已测得；它影响所有 NPU profiling run，不能静默改回无 AiCore metric。
