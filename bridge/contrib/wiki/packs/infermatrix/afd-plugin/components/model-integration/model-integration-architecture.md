---
name: model-integration-architecture
description: AFD model integration 架构，AFD alias 注册、角色感知模型构造与权重加载、ForwardContext 里的 afd_metadata 消费、Attention↔FFN split execution 数据流和验证方式
metadata:
  scope: 只收 model integration（afd_plugin/model_executor）的架构、数据流和验证方式；context 安装与 step 生命周期归 runner 各页，transfer state 归 connectors-architecture，评审规则归 model-integration-rules
---
# AFD model integration 架构

## 现状

### 职责和边界

- 本 owner 负责 AFD-prefixed architecture 注册、角色感知模型构造/权重加载、`ForwardContext` 中的 AFD metadata 消费和 model-side split execution。
- runner 拥有 context 安装与 step 生命周期，[[connectors-architecture]]（connector） 拥有 communication/transfer state，model 只拥有模块、参数和本地计算。

### 数据怎样流动

- Attention role 构造 attention/KV-facing 模块和生命周期必需共享组件，跳过不在该 role 执行的 expert/MLP。
- FFN role 构造 expert/MLP 和必需共享组件，跳过 Attention 模块。
- `compute_gate_on_attention` 决定 gate 和 dense layer 在哪个 role 构造/执行，但不改变 owner 边界。

```text
runner installs ForwardContext.additional_kwargs["afd_metadata"]
  -> Attention layer computes attention and optional routing
  -> model creates transfer metadata/context
  -> connector sends hidden states/routing payload
  -> FFN role compute_ffn_output(layer_idx)
  -> connector returns routed/shared or hidden-state result
  -> Attention continues residual/layer pipeline
```

- AFD model 只从 `additional_kwargs["afd_metadata"]` 读 metadata。
- dummy run 若绕过常规 runner call site，scoped provider 临时包装 upstream context factory 并在 `finally` 恢复。
- async MoE ubatching 另有 sidecar metadata，该形状和 live connector reference 仍是 draft。
- 权重 loader 必须先保留 pinned upstream 的 stacked projection、expert、pipeline-missing、KV-scale 和 redundant-expert mapping，再施加 role filtering。
- 任一 role 成功加载不能代替另一 role 的模型/精度证据。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/model-integration/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: afd-plugin, components, model-integration, model-executor；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:afd_plugin/model_executor/**
  - afd-plugin@a432692:afd_plugin/__init__.py
  - afd-plugin@a432692:docs/design/module/model_integration.md
- 置信度（confidence）：medium

### 主要源码和调用入口

- `register_afd()` 为 DeepSeek V2/V3/V3.2 及已知兼容架构注册 AFD alias，仅 AFD worker 会把 worker-local model config 切到这些 alias。
- `model_executor/models/deepseek_v2.py` 拥有主要角色感知包装，`forward_context.py` 拥有 metadata access/scoped provider，`models/npu/**` 拥有 Attention-side gate 和 async CAM 前向编排。
- alias 只表示已知兼容族，不是通用 MoE API。

### 怎样验证

- 注册改动要跑 package registry 与 checkpoint load；construction/weight filter 改动要分别验证 Attention 和 FFN 模块/参数；context 变更要验证正常、dummy、异常恢复和 stage-local path。
- 最后按影响平台跑 model/accuracy E2E。
- 仓库门禁见 [[afd-plugin-rules]]（rules）。
