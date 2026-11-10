---
name: rules-gpu-memory-budget
description: "GPU 显存预算规则 VLLM-OMNI-PR9404-IGPU-BUDGET（PR #9404）：vllm_omni/worker/memory_utils.py 的 request_memory_tolerant() 在集成 GPU（current_platform.is_integrated_gpu，按快照设备索引）上必须走上游 request_memory() 校验并在预算超过空闲显存时抛 ValueError，离散 GPU 保留钳制到 free_memory 的容忍行为；证据为 Jetson AGX Thor 运行 Qwen2.5-Omni-3B 时整机无响应"
metadata:
  scope: 只收 stage 显存预算在集成 GPU 与离散 GPU 上的校验分支一条规则 VLLM-OMNI-PR9404-IGPU-BUDGET；stage 并行度与设备容量的启动前校验归 model-executor-rules-3，NPU 基础镜像规则归 rules-npu-base-image
---
# 模型执行器 — GPU 显存预算规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-gpu-memory-budget.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #9404
- [VLLM-OMNI-PR9404-IGPU-BUDGET] 集成 GPU 必须拒绝超量 stage 显存预算
  - 触发：改动 `vllm_omni/worker/memory_utils.py` 的 `request_memory_tolerant()` 或 `tests/worker/test_memory_utils.py`，尤其是 `MemorySnapshot`、`CacheConfig.gpu_memory_utilization`、`current_platform.is_integrated_gpu` 相关分支。
  - 强制：集成 GPU（`current_platform.is_integrated_gpu(init_snapshot.device_.index)` 为真）必须走上游 `request_memory()` 校验路径，预算超过空闲显存时抛出 `ValueError`（报错含 "Decrease GPU memory utilization"）；离散 GPU 保留现有“钳制到 free_memory 并打告警”的容忍行为。设备判断必须使用快照中的设备索引。
  - 验收：纯 CPU 测试（monkeypatch `is_integrated_gpu`，构造真实 `MemorySnapshot(total_memory=…, free_memory=…, device=…, auto_measure=False)` 与 `CacheConfig`）覆盖：集成 GPU 空闲不足时抛错（含 free=0 与仅差 1 字节）、预算充足时按 `math.ceil(total*util)` 原样返回（含预算==空闲边界）、离散 GPU 仍钳制到 free_memory。
  - 证据：^[PR #9404] 集成 GPU（Jetson AGX Thor 运行 Qwen2.5-Omni-3B）上钳制后的预算吃掉全部共享主机内存导致系统无响应，本 PR 改为上游校验直接报错。

## 决策与踩坑

- [VLLM-OMNI-PR9404-IGPU-BUDGET] 禁止：在集成 GPU 上把预算静默钳制成全部空闲共享主机内存，导致宿主机无内存余量（Jetson 上表现为整机无响应）；禁止用默认设备代替快照设备做集成 GPU 判定。
