---
name: execution-platforms-architecture
description: AFD execution platforms 架构，CUDA 与 Ascend 平台机制的职责边界、类继承策略、native ubatching 与 graph 数据流、CANN ops 构建、v0.26 支持矩阵和验证方法
metadata:
  scope: 只收 afd-plugin 平台 owner 的当前机制（worker/runner class strategy、device graph、native DBO/ubatching、stream/forward context、profiler、native operators、build/package）与 v0.26 支持矩阵；transport/topology 归 connectors-architecture，版本化校验与硬件 E2E 规则归 execution-platforms-rules
---
# AFD execution platforms 架构

## 现状

### 职责和边界

- 本 owner 负责 CUDA 和 Ascend 平台机制：worker/runner class strategy、device graph、native DBO/ubatching、stream/forward context、profiler、native operators 和 build/package。
- 角色 owner 保留 lifecycle，[[connectors-architecture]]（connectors） 保留 transport/topology，[[compatibility-architecture]]（compatibility） 保留全局上游符号替换。

### 数据怎样流动

- CUDA native ubatching 由 `AFDUBatchWrapper` 维持两阶段 slice/context、padded capture shape 和 DP-size-1 metadata fallback。
- FFN graph cache 以 stage token metadata 为 key；control-plane update 在正式 `torch.cuda.graph` 之前完成，图中只留 model/data plane。
- Ascend native ubatching 使用独立 `AscendUBatchWrapper`，每 stage 有 forward context、execution thread、stream 和配对事件。
- DBO yield 后必须恢复 thread-local NPU stream 和正确 context。
- MLA + native DBO Full Graph 为两个 stage 分别捕获 `GraphParams`，回放前验证 layer/order/count 并按 layer-major/stage-minor 合并；scoped resolver 在 AFD context 外回退 upstream process-global resolver。
- `CAMP2pAFDConnector` 使用 plugin-owned A2E/E2A CANN operators。
- build 在 Ascend 环境自动开启，`AFD_BUILD_ASCEND_OPS` 可显式覆盖；package import 不需要 extension，但 connector init 必须发现真实 ops。
- CAM async 另依赖 `torch_npu`、`umdk_cam_op_lib` 和 dispatch/combine namespace。

### v0.26 当前支持矩阵

| 平台/connector | 执行 | Ubatching | 关键限制 |
|---|---|---|---|
| CUDA + `P2pNcclAFDConnector` | eager 或 `FULL_DECODE_ONLY` CUDA Graph | native DBO，仅两个 ubatch | Attention/FFN gate 都可；Attention remote-experts 拒绝 EPLB |
| Ascend + `CAMP2pAFDConnector` | eager 或 `FULL_DECODE_ONLY` ACL Graph | native DBO，仅两个 ubatch | common/local gate 均 `false`；`quant_mode=0`；需 plugin CANN ops |
| Ascend + `CAMAsyncAFDConnector` | 仅 eager prefill | 拒绝 native DBO；可选独立两阶段 MoE pipeline | `async=true`、common gate `true`、`dynamicQuant` 0/1；v0.26 证据只覆盖 no-PCP `2A2F` DeepSeek-V2-Lite |

- MLA Full Graph 还要求两个 ubatch、`FULL_DECODE_ONLY` 且禁用 speculative decoding。
- 旧 DeepSeek-V3.2 PCP8 recipe 属于 v0.19.1rc1 历史实验，不是 v0.26 支持证据。
- 对应硬门禁保留在 [[afd-plugin-rules]]（仓库规则）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/execution-platforms/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: afd-plugin, components, execution-platforms；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:README.md
  - afd-plugin@a432692:afd_plugin/v1/worker/cuda_graph.py
  - afd-plugin@a432692:afd_plugin/v1/worker/dbo.py
  - afd-plugin@a432692:afd_plugin/v1/worker/npu/**
  - afd-plugin@a432692:csrc/**
  - afd-plugin@a432692:tests/unit/v1/worker/test_npu_mla_graph.py
  - afd-plugin@a432692:docs/design/module/execution_platforms.md
- 置信度（confidence）：medium

### 主要源码和调用入口

- CUDA AFD 类继承 vLLM GPU worker/runner；Ascend AFD 类直接继承 vLLM-Ascend NPU worker/runner，不继承 CUDA AFD 类。
- GPU FFN runner 是 plugin-owned 最小 runner；NPU FFN runner 沿上游 NPU model runner 扩展。
- 平台共享语义通过 config、payload、graph policy 和小 helper 传递。

### 怎样验证

- 先按 changed owner 跑 CUDA graph/DBO 或 NPU runtime/MLA/ops/profiler/build 单测，再使用匹配硬件 E2E。
- CPU import/config smoke 不能证明 graph replay、stream/context 恢复、native op、精度或性能。
- 证据必须记录 backend、设备数、版本、topology、connector 和 graph/DBO/async 配置。
