---
name: compatibility-architecture
description: AFD compatibility 架构，含职责边界、core/NPU patch 与 scoped adapter 清单、best-effort 注册与 Ascend 两阶段适配流程、patch 逐个审查要求和验证
metadata:
  scope: 只收 AFD 与固定 vLLM/vLLM-Ascend 之间适配层的职责边界、patch 清单、应用生命周期和验证方式；patch 门禁归 compatibility-rules，graph/DBO 实现归 execution-platforms-architecture
---
# AFD compatibility 架构

## 现状

### 职责和边界

- 本 owner 只适配 AFD 与固定 vLLM/vLLM-Ascend 之间的缺口，不拥有角色计算、connector 传输或平台 graph 本身。
- vLLM 目标为 `0.26.0`；Ascend 证据基于 source commit `80d8c194f`，不是 released package/container 承诺。
- 全仓库声明门禁见 [[afd-plugin-rules]]（仓库规则）。

### 数据怎样流动

- 通用 plugin registration 先做 non-strict 版本检查，再以同一 best-effort import block 安装 core patch。
- 模型注册仍是完成 registration 的必需步骤。
- 该流程没有 transaction/rollback，因此早期 import 失败可能导致部分安装。
- Ascend 适配分两个较晚阶段：AFD NPU config normalization 安装 platform config wrapper；NPU worker constructor 调用 runtime facade 安装 MLA resolver，FFN worker 另在上游 MoE 符号可用后导入 force-load-balance patch。
- 这一分层避免通用 hook 提前触碰 vLLM-Ascend。
- patch 类型不同：有的复制上游函数并直接赋值，有的保存 original 和 sentinel，有的包装 config/forward-context 边界。
- 一致性不能假设；每个 patch 都必须单独审查版本 guard、reload/idempotence、non-AFD branch 和移除条件。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/compatibility/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: afd-plugin, components, compatibility；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:afd_plugin/compat/**
  - afd-plugin@a432692:docs/design/module/compatibility_and_patches.md
- 置信度（confidence）：medium

### 主要源码和调用入口

- core patch：`async_dp_engine.py`、`async_dp_forward_context.py`、`config_validation.py`、`engine_core.py`。
- NPU patch：`npu/ascend_platform.py`、`npu/mla_graph.py`、`npu/force_load_balance.py`。
- scoped adapter：`compat/npu/feature_validation.py`、`runtime.py`、`runtime_config.py`。

### 怎样验证

- 每个 patch 必须同时覆盖 AFD 分支与 pinned non-AFD 分支，并根据实现覆盖 import/reload、初始化、失败和 shutdown。
- NPU patch 还需对应 runtime/MLA/force-load-balance 单测和受影响硬件 E2E。
- 执行规则见 [[compatibility-rules]]（rules），graph/DBO 实现见 [[execution-platforms-architecture]]（execution-platforms）。
