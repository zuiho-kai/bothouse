---
name: model-integration-overview
description: AFD model integration 入口总览，含什么时候查这里、不放什么、Owner 凭证（基线、主源码、职责、输入输出、验证、影响）和目录内容
metadata:
  scope: 只收源目录 components/model-integration 索引页里的使用时机、收录边界、Owner 凭证和入口说明；架构归 model-integration-architecture，评审规则归 model-integration-rules
---
# AFD model integration 入口

## 现状

- 什么时候查这里：
  - 修改 AFD model registry alias、角色感知模块构造/权重加载、forward-context metadata 或 DeepSeek MoE handoff。
  - 调查 Attention/FFN 为什么加载不同参数，或 gate 放置、dense/MoE 分流、async CAM 数据流。
- 不放什么：
  - worker 生命周期放 [[attention-runtime-overview]]（Attention） / [[ffn-runtime-overview]]（FFN）。
  - connector payload/resource 放 [[connectors-overview]]（connectors）；DBO/graph yield 机制放 [[execution-platforms-overview]]（execution-platforms）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/model-integration/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin, components, model-integration, model-executor；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:docs/design/module/model_integration.md

### Owner 凭证

- 基线：`afd-plugin main @ a432692ed7d5dd6437a4755b530ee7aaf2685dad`。
- 主源码：`afd_plugin/model_executor/**`。
- 职责：模型注册、role-aware construction/loading、AFD metadata access 和 model-side Attention↔FFN 计算。
- 输入/输出：输入 checkpoint architecture、AFD role/config、forward metadata 和 connector payload；输出角色所需模块/参数与匹配的 hidden states/FFN result。
- 验证：`tests/unit/model_executor/**`、connector experts contract、GPU/NPU model 和 accuracy E2E。
- 影响：模型加载内存、MoE gate/experts、forward context、connector transfer 和精度。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 理解 registry、角色构造、metadata 和权重加载 | [[model-integration-architecture]]（architecture） | DeepSeek-oriented 当前实现 |
| 调查 caller 生命周期 | [[attention-runtime-architecture]]（Attention） / [[ffn-runtime-architecture]]（FFN） | runner-owned context 和 step |
| 调查 transfer state | [[connectors-architecture]]（connectors） | payload/context 与资源 owner |

- AFD 模型包装（afd_plugin/model_executor/models）评审规则：[[model-integration-rules]]
