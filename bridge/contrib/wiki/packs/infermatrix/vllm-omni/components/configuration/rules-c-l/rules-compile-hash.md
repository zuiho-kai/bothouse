---
name: rules-compile-hash
description: 规则 VLLM-OMNI-PR8899-COMPILE-HASH：OmniModelConfig.compute_hash() 用 connector_hash_factors() 排除 per-launch 的 wakeup_scope，模型侧直接 torch.compile 用 log_torch_compile_stats 包住首次编译执行块，TORCHINDUCTOR_CACHE_DIR 入 env inventory（PLATFORM_EXTERNAL 30→31）
metadata:
  scope: "只收 PR #8899 的 compile hash 稳定性与模型侧编译日志一条规则；环境变量 inventory 的通用同步要求（VOMNI-CFG-3a）归 configuration-rules-3"
---
# Torch Compile Hash 稳定性与模型侧编译日志规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/configuration/rules-compile-hash.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, config；created: 2026-10-26；updated: 2026-10-26
- 来源（sources）：PR #8899
- [VLLM-OMNI-PR8899-COMPILE-HASH] torch compile hash 必须排除 per-launch UUID 且模型侧编译要可观测
  - 触发：修改会进入 vLLM `ModelConfig` hash factors 的 Omni 字段（`stage_connector_config`、`omni_kv_config` 里的 `connector_config`、含 `wakeup_scope` 等 per-launch `extra` key 的 transfer config），或模型在 vLLM compile wrapper 之外直接调用 `torch.compile`（如 `qwen3_code_predictor.py` 的 `_setup_compile`）。
  - 强制：`OmniModelConfig.compute_hash()` 必须在对象浅拷贝上先用 `connector_hash_factors()`（`vllm_omni/distributed/omni_connectors/utils/config.py`，当前排除集合 `PER_LAUNCH_EXTRA_KEYS = {"wakeup_scope"}`）过滤 `stage_connector_config` 与 `omni_kv_config` 中的 `connector_config`（浅拷贝共享内层 dict，替换前先复制该 dict），
    - 再委托 upstream `compute_hash()`；模型实际读取的 connector 设置（如 `extra.codec_chunk_frames`）必须继续改变 hash。
    - `torch.compile` 是惰性的：模型侧直接编译要用 `vllm_omni/utils/torch_compile.py` 的 `log_torch_compile_stats` 包裹触发首次编译执行的调用块（本例 `_setup_compile` 内包住 `_warmup_buckets()`），而不是包裹 `torch.compile` 调用本身，以记录该 block 的 Inductor FX graph cache hit/miss/bypass 与耗时。
    - 把环境变量纳入 inventory（本例 `TORCHINDUCTOR_CACHE_DIR` 归入 PLATFORM_EXTERNAL）必须同步 `environment_variable_inventory.py` 分类与数量快照。
  - 验收：用真实 deploy YAML（qwen3_tts）对 stage 0/1 各构建两次 `OmniEngineArgs.create_engine_config().compute_hash()`，断言同一配置两次 hash 相同；再断言改变 `codec_chunk_frames` 等 connector extra 仍产生不同 hash（`tests/engine/test_arg_utils.py`）；env inventory 分类与数量快照同步通过（PLATFORM_EXTERNAL 30→31）。^[PR #8899]

## 决策与踩坑

- [VLLM-OMNI-PR8899-COMPILE-HASH] 禁止：让 per-launch UUID 留在 compile cache key 中，使重复启动本应命中的编译与后续依赖 `TORCHINDUCTOR_CACHE_DIR` 的启动期编译（如 code predictor）出现不必要的 cache miss；为求 hash 稳定直接 mutate `self` 或过滤掉模型实际读取的 connector 设置；把 `log_torch_compile_stats` 包在 `torch.compile` 调用处（惰性编译下记录不到执行统计）或省略模型侧编译的可观测性；
  - 纳入/调整 inventory 环境变量而不更新分类与快照计数。
