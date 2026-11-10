---
name: rules-npu-kv-layout
description: "NPU KV cache 布局规则 VLLM-OMNI-PR8827-CONTIG-KV（PR #8827）：vllm_omni/platforms/npu/platform.py 的 contiguous 判定为 spec.page_size_bytes == spec.real_page_size_bytes（unpadded 走连续分离 K/V，padded 留 packed 单 tensor），apply_contiguous_kv_patch() 以替换 requires_contiguous_pa_kv_cache.__code__ 生效且幂等；tests/platforms/npu/test_contiguous_kv_cache.py 的 v1 / v2 断言；背景为 Ascend 上 Qwen3-TTS serving 性能回归 #8795"
metadata:
  scope: 只收 NPU K/V cache 布局策略与 __code__ patch 的一条规则 VLLM-OMNI-PR8827-CONTIG-KV；Ascend 镜像升级与该测试 fixture 的 MagicMock 设置归 rules-npu-base-image，NPU runner 与平台后端的 EXEC-10a–10f、EXEC-13a–13f / 13h 合同归 rules-platform-backends-1、rules-platform-backends-2，EXEC-13g 归 rules-npu-profiler
---
# Model Executor — NPU KV cache 布局规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-npu-kv-layout.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-12；updated: 2026-10-12
- 来源（sources）：PR #8827
- [VLLM-OMNI-PR8827-CONTIG-KV] NPU K/V 布局按 page padding 判定，patch 以 __code__ 替换全局生效
  - 触发：修改 `vllm_omni/platforms/npu/platform.py` 的 K/V cache 布局策略、`requires_contiguous_pa_kv_cache` patch 或 `NPUOmniPlatform.__init__` 的 patch 顺序；或 vLLM-Ascend 升级后 Ascend 上 Qwen3-TTS serving 性能回归（#8795）。
  - 强制：contiguous 判定必须实现为 `spec.page_size_bytes == spec.real_page_size_bytes`：unpadded page 保持 vLLM-Ascend 0.30.0 及更早的连续分离 K/V 分配（K、V 各自 contiguous 且 storage 不别名）；padded page 留在 packed 单 tensor 路径，因为 V2 的分离 K/V 分配只支持 unpadded page。
  - 强制：`apply_contiguous_kv_patch()` 必须通过替换 `vllm_ascend.attention.utils.requires_contiguous_pa_kv_cache.__code__` 生效，不得重绑模块属性——这样 `attention.utils`、`worker.model_runner_v1`、`worker.v2.attn_utils` 的按引用导入才同步生效；
    - patch 必须幂等（重复调用不叠加），并在 `NPUOmniPlatform.__init__` 的 `adapt_patch(is_global_patch=True)` 之后调用。
  - 验收：`tests/platforms/npu/test_contiguous_kv_cache.py` 加入 `.buildkite/npu/test-npu-ready.yml` 的 `core_model and npu and A3 and omni` lane。
    - v1 case（`NPUModelRunner._allocate_kv_cache_tensors`）断言 double-apply 后 `attention.utils`、`worker.model_runner_v1`、`worker.v2.attn_utils` 三处引用同一函数对象，且 K/V 各自 contiguous、storage 指针不同；v1 不做 fill 隔离。
    - v2 case（`attn_utils._allocate_kv_cache`+`_reshape_kv_cache_v2`）断言 `original(None, None, spec)` 对 unpadded/padded 返回 True/False：unpadded 时 K/V contiguous、storage 指针不同，padded 时返回单 tensor 且 `stride(0)*element_size == page_size_bytes`；fill 隔离（K 填 1、V 填 2 后互不串扰）只在 v2 的两种参数化中断言。
    - 导入 runner 前先 import `vllm.v1.worker.gpu.spec_decode.speculator` 与 `vllm_ascend.ops`。^[PR #8827]

## 决策与踩坑

- [VLLM-OMNI-PR8827-CONTIG-KV] 禁止：为统一布局把 padded page 也切到连续分离分配；用属性重绑或层层包装代替 `__code__` 替换，导致部分模块仍执行旧判定或重复 patch 叠加。
