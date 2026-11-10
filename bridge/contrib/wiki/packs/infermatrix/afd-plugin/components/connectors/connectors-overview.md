---
name: connectors-overview
description: AFD connectors 入口，什么时候查这里、不放什么、Owner 凭证（基线、主源码、职责、输入输出、验证、影响）和目录内容
metadata:
  scope: 只收源目录 afd-plugin/components/connectors 索引页里的使用时机、收录边界、Owner 凭证和入口说明；connector 合同归 connectors-architecture，review 规则归 connectors-rules
---
# AFD connectors 入口

## 现状

- 什么时候查这里：
  - 修改 connector factory/base、payload、topology、process group、control plane 或 CUDA/CAM/CAMP2P transport。
  - 调查 rank 映射、同步/异步 step 选择、pending state、partial-init cleanup 或跨 role 失败。
- 不放什么：
  - worker daemon 生命周期放 [[ffn-runtime-overview]]（ffn-runtime）；请求协调放 [[attention-runtime-overview]]（attention-runtime）。
  - graph、DBO、native op build 和 profiler 放 [[execution-platforms-overview]]（execution-platforms）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/connectors/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin, components, connectors, distributed；created: 2026-08-06；updated: 2026-10-09
- 来源：
  - afd-plugin@a432692:docs/design/module/connector_contracts.md

### Owner 凭证

- 基线：`afd-plugin main @ a432692ed7d5dd6437a4755b530ee7aaf2685dad`。
- 主源码：`afd_plugin/connectors/**`、`afd_plugin/distributed/**`。
- 职责：factory/schema、world/rank 映射、control/data plane、payload/state 和 connector-owned communication 资源。
- 输入/输出：输入 AFD config、role rank、stage/layer tensor/context；输出跨 role payload、work item 或匹配的 FFN result。
- 验证：`tests/unit/connectors/**`、`tests/unit/distributed/**`、GPU/NPU TP 和 async CAM E2E。
- 影响：Attention/FFN 协调、graph shape state、进程组、communicator 和 shutdown。

### 目录内容

- 遇到什么：理解 factory、拓扑、payload 和生命周期
  - 查看哪里：[[connectors-architecture]]（architecture）
  - 说明：三类 connector 当前合同
- 遇到什么：核对 role runtime 如何消费 control/work item
  - 查看哪里：[[attention-runtime-architecture]]（Attention） / [[ffn-runtime-architecture]]（FFN）
  - 说明：caller 生命周期
- 遇到什么：核对平台支持组合
  - 查看哪里：[[execution-platforms-architecture]]（execution-platforms）
  - 说明：graph/DBO/quantization 矩阵
- NPU connector（CAM async / CAMP2P）review 规则（[[connectors-rules]]）：含 Legacy DBO 物理计数与 opaque op 动态 padding 的分支限定合同。
