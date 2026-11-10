---
name: compatibility-overview
description: AFD compatibility 入口总览，含使用时机、收录边界、Owner 凭证（基线、主源码、输入输出、验证、影响）和目录内容
metadata:
  scope: 只收源目录 afd-plugin/components/compatibility 索引页里的使用时机、收录边界、Owner 凭证和入口说明；patch 生命周期归 compatibility-architecture，patch 门禁归 compatibility-rules
---
# AFD compatibility 入口

## 现状

### 什么时候查这里

- 升级 vLLM/vLLM-Ascend，新增或刷新 monkey patch，修改 patch guard、应用时机或 non-AFD 分支。
- 调查最佳努力 patch 未安装、重复包装、版本警告或 NPU runtime adapter 行为。

### 不放什么

- CUDA/Ascend graph、DBO、profiler 和 native op 机制放 [[execution-platforms-overview]]（execution-platforms）。
- AFD-owned 角色、模型或 connector 功能不能因为便于 hook 而放进 compatibility。

## 关键事实

- 源页：`knowledge/repos/afd-plugin/components/compatibility/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: afd-plugin, components, compatibility；created: 2026-08-06；updated: 2026-08-06
- 来源：
  - afd-plugin@a432692:docs/design/module/compatibility_and_patches.md

### Owner 凭证

- 基线：`afd-plugin main @ a432692ed7d5dd6437a4755b530ee7aaf2685dad`。
- 主源码：`afd_plugin/compat/{__init__,vllm}.py`、`compat/npu/{__init__,feature_validation,runtime,runtime_config}.py`、`compat/patches/**`。
- 输入：上游版本/符号、AFD role/config 与已初始化的平台模块。
- 输出：版本受限的 upstream 行为适配，且 non-AFD 分支保留固定上游语义。
- 验证：`tests/unit/compat/**`、package/classpath tests、`test_npu_runtime.py`、`test_npu_mla_graph.py`。
- 影响：全局 vLLM 符号、EngineCore、config normalization 和 Ascend worker startup。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 理解 patch 库存和应用生命周期 | [[compatibility-architecture]]（architecture） | v0.26 当前实现 |
| 审查新 patch 或上游升级 | [[compatibility-rules]]（rules） | upstream-first 和 API drift 门禁 |
| 核对入口延迟加载 | [[plugin-boundary-architecture]]（plugin-boundary） | 通用注册与 Ascend bootstrap 分层 |
