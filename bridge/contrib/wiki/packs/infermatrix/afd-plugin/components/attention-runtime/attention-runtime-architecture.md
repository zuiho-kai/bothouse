---
name: attention-runtime-architecture
description: AFD Attention runtime 架构，含职责边界、CUDA/Ascend worker 与 runner 入口、scheduled batch 到 FFN handoff 的数据流、control-plane 与 CAM async 分流、验证路径
metadata:
  scope: 只收 AFD Attention runtime 的职责边界、源码入口、数据流和验证方式；审查规则归 attention-runtime-rules，connector、模型和平台机制归各自组件的 architecture 页
---
# AFD Attention runtime 架构

## 现状

### 职责和边界

- Attention runtime 拥有外部 API 请求、vLLM scheduler 执行、KV cache、sampling/output、AFD metadata 安装和向 FFN 的 handoff。
- 它消费 [[connectors-architecture]]（connector）、[[model-integration-architecture]]（model integration）和 [[execution-platforms-architecture]]（platform）；这些低层 owner 不反向依赖 Attention worker。

### 数据怎样流动

```text
scheduled batch
  -> build native attention inputs and pending AFD metadata
  -> install ForwardContext.additional_kwargs["afd_metadata"]
  -> if connector.control_plane exists, send stage DP metadata and graph flags
  -> role-aware Attention layer computation
  -> connector send to FFN and receive matching result
  -> continue layers
  -> native sampling/output
```

- 同步 P2P/CAMP2P 先经 `AFDControlPlane` 发送 stage-indexed token counts、warmup 和 capture flags，再进入 data plane。
- CAM async 的 `control_plane` 为 `None`，路由/token metadata 随 dispatch payload 移动，Attention 延后接收 FFN 结果以实现 overlap。
- native DBO 时只接受两个 ubatch，每个 child forward context 获得 stage-local AFD/DP metadata。
- 正式 graph capture 前 control-plane side effect 必须完成，以免 communication/control work 进入可重放 graph。
- CAM async 的可选两阶段 MoE pipeline 是 request-boundary 机制，不是 native DBO。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/attention-runtime/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: afd-plugin, components, attention-runtime；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:afd_plugin/v1/worker/attention_model_runner.py
  - afd-plugin@a432692:afd_plugin/v1/worker/attention_worker.py
  - afd-plugin@a432692:afd_plugin/v1/worker/npu/attention_model_runner.py
  - afd-plugin@a432692:docs/design/module/attention_runtime.md
- 置信度（confidence）：medium

### 主要源码和调用入口

- CUDA 使用 `AFDAttentionWorker` / `AFDAttentionModelRunner` 和 `P2pNcclAFDConnector`；Ascend 使用 `AFDNPUAttentionWorker` / `AFDNPUAttentionModelRunner`，可选 `CAMP2pAFDConnector` 或 `CAMAsyncAFDConnector`。
- worker 保留 upstream device/distributed/KV 职责，runner 拥有 connector、profiler、pending metadata 和 graph/ubatch 协调状态。

### 怎样验证

- 先跑 Attention runner 和 NPU runtime 单测。
- 改 metadata/control-plane 时追加 connector 单测；改 graph/ubatch 时追加平台 graph/DBO 测试；改请求或模型路径时追加 GPU/NPU serving、model 和 accuracy E2E。
- 仓库门禁见 [[afd-plugin-rules]]（rules）。
