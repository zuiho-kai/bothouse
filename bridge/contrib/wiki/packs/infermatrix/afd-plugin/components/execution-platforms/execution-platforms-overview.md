---
name: execution-platforms-overview
description: AFD execution platforms 入口，什么时候查这里、不放什么、Owner 凭证（基线、主源码、职责、输入输出、验证、影响）和目录内容
metadata:
  scope: 只收源目录 afd-plugin/components/execution-platforms 索引页里的使用时机、收录边界、Owner 凭证和入口说明；平台矩阵归 execution-platforms-architecture，硬件 E2E 规则归 execution-platforms-rules
---
# AFD execution platforms 入口

## 现状

- 什么时候查这里：
  - 修改 CUDA/Ascend worker 平台机制、CUDA/ACL Graph、DBO/ubatching、forward context、profiler、native op 或 build/package。
  - 调查 graph key/state、stream/context 恢复、MLA Full Graph、CANN op 可用性或当前 connector 支持组合。
- 不放什么：
  - connector topology/process group 放 [[connectors-overview]]（connectors）。
  - 全局 upstream 符号替换和 patch guard 放 [[compatibility-overview]]（compatibility）。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/execution-platforms/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin, components, execution-platforms；created: 2026-08-06；updated: 2026-10-09
- 来源：
  - afd-plugin@a432692:docs/design/module/execution_platforms.md

### Owner 凭证

- 基线：`afd-plugin main @ a432692ed7d5dd6437a4755b530ee7aaf2685dad`。
- 主源码：`compat/profiler.py`、`compat/npu/{forward_context,ops,profiler}.py`、`v1/worker/{cuda_graph,dbo}.py`、`v1/worker/npu/{forward_context,mla_graph,npu_ubatch_wrapper,ubatch_utils,ubatching}.py`、`csrc/**`、`setup.py`、`MANIFEST.in`。
- 职责：平台 class 策略、graph/DBO 协调、stream/context、profiler、native operator discovery/build/package。
- 输入/输出：输入 AFD role/config、stage token metadata 和 connector state；输出平台 forward context、graph cache/replay、ubatch 结果和 native op 调用。
- 验证：graph/DBO/NPU MLA/runtime、profiler、Ascend ops/build 单测与匹配硬件 E2E。
- 影响：两个 role、connector shape/control state、设备内存、性能和打包产物。

### 目录内容

- 遇到什么：理解 CUDA/Ascend、graph/DBO、MLA 和 native op
  - 查看哪里：[[execution-platforms-architecture]]（architecture）
  - 说明：v0.26 当前平台矩阵
- 遇到什么：核对版本化 MRV2 DBO 校验或 DSV4 本地 NPU E2E 环境
  - 查看哪里：[[execution-platforms-rules]]（rules）
  - 说明：v0.30 GPU 升级实现与 v0.26 基线分开；设备和 NIC 按场景校验
- 遇到什么：调查 connector state 来源
  - 查看哪里：[[connectors-architecture]]（connectors）
  - 说明：control/data plane 和资源 owner
- 遇到什么：审查 Ascend global patch
  - 查看哪里：[[compatibility-rules]]（compatibility）
  - 说明：upstream-first 与 non-AFD 回归
