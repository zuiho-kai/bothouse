---
name: moss-tts-rules-2
description: MOSS-TTS 规则（下）：MOSSTTS-4a reference encoder 的内容、slot 与 flight identity（single-flight、micro-batch、TTSD 双 speaker）、4b reference waveform LRU 缓存自有 float32 数组、MOSS-REF-BACKEND-1a reference attention 的平台 kernel keyword、MOSS-REF-TEST-1a Unix socket 测试短路径
metadata:
  scope: 只收 MOSSTTS-4a、4b、MOSS-REF-BACKEND-1a、MOSS-REF-TEST-1a；codec、RoPE、Local talker 与 seed 规则归 moss-tts-rules-1，注册 voice 归 rules-registered-reference
---
# MOSS-TTS 规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/2 部分；第 1 部分 [[moss-tts-rules-1]]
- 源页：`knowledge/repos/vllm-omni/models/moss-tts/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-02；updated: 2026-10-06
- [MOSSTTS-4a] reference encoder 必须保持内容、slot 与 flight identity
  - 触发：修改 MOSS `reference_encoder.py`、reference-audio speaker/code cache、`serving_speech.py` 的 MOSS reference handoff，或 reference preprocessing/batching。
  - 强制：server 只惰性构造一个 `MossReferenceEncoder`；在 model package 从 processor 推导 `n_vq` 和 working sample rate，Local reference encode 固定为 24 kHz，而不是其 48 kHz output rate。
    - anonymous clip 必须 resolve 后才选 speaker-code cache key，优先使用 resolved waveform artifact key、缺失时回退 resolve identity，并以 MOSS variant 与 `n_vq` namespace。cache 内只在 code 值可容纳时 compact 为 int32；每个 caller 都得到不 alias cache 的独立 int64 tensor。
  - 强制：named key 只能是 normalized uploaded `voice_name` 加 positive `created_at`，并且只用于该 uploaded voice 自己的 reference；placeholder/unregistered/inline voice 必须 content-addressed。TTSD 的 slot 0 才可用 named key，slot 1 必须 anonymous；
    - `ref_audio_cache_key` 与 `ref_audio_2_cache_key` 必须按 slot 保存，不能按 concurrent completion order 保存。
  - 强制：同一 cold reference 的 concurrent miss 必须 join 一个 shielded flight；flight slot 只能由 task completion callback 以 identity guard 回收，不能因 creator waiter cancel/return 而撤销。cold encode 在有界 coalescing window/max batch 内合批；每 clip prep failure 独立，batch forward failure 必须回退为逐项 encode，不能让一个坏 clip poison 同批请求。
  - 验收：CPU tests 覆盖相同 content 的不同 locator 只 encode 一次、re-upload 的 `created_at` 只 invalidate named voice、default/inline voice 不 collide、caller mutation 不改 cache，以及 out-of-range code 保持 int64。
    - 并发 tests 覆盖同 ref 只 resolve/encode 一次、creator cancellation 后 later waiter 仍 join 已有 flight、distinct refs 在 bounded batch 内执行、prep failure 与 batch fallback 只影响失败 clip。TTSD test 必须用 uploaded voice 加不同双 reference，断言 codes 不同、两个 cache salt 保持 slot order，并证明二者进入同一 batch window。
    - PR 的 A/B 只支持此 preprocessing 的 content-addressed/single-flight/micro-batch/TTSD pair-encode 性能结论；同路径 warm-hit parity 属于既有 speaker cache，不能归因于本规则。^[PR #4982]
- [MOSSTTS-4b] reference waveform LRU 必须缓存自有 float32 数组并释放完成批次
  - 触发：修改 `serving_speech` 的 `_ref_audio_resolve_cache`、`_finalize_fetched_ref_audio`、MOSS reference-encoder 数组/list 解析器，或 idle drainer 对完成 batch 的持有。
  - 强制：共享 resolve LRU 只存 owned、C-contiguous `float32` 数组，容量按 `nbytes` 记账；finalize 必须 `copy=True` 切断对更大 decode 缓冲的 view。list 接口仅在调用边界临时 `.tolist()`，不得保留第二份 list 缓存。server-side encoder 走 array resolver；tensor 构造仍 copy，隔离缓存数组。drainer 在 `finally` 中丢弃已完成的 `first`/`jobs` 引用后再等待下一项。
  - 验收：覆盖数组所有权、list 兼容路径、cache hit 不保留第二 list，以及 completed-batch 生命周期释放。^[PR #7885]
- [MOSS-REF-BACKEND-1a] reference attention 必须按平台保持 kernel keyword 与返回合同
  - 触发：修改 MOSS reference encoder 的 local-window varlen attention 或 ROCm backend dispatch。
  - 强制：NVIDIA 使用 vLLM FlashAttention 并传 fa_version；ROCm 优先 AITER、仅 ImportError 时回退 upstream flash_attn，均不传 NVIDIA 专有 fa_version。AITER 且 grad enabled 且 Q/K/V 任一 requires_grad 时请求 return_lse=True；统一解包 tuple 的 attention tensor。
  - 验收：覆盖 NVIDIA、AITER grad/inference 和 upstream fallback 的调用参数/返回类型；两种 FA version 的窗口 SDPA parity、padded-row zeroing 与 valid causal prefix 不受未来 padding 污染都必须保持。^[PR #8463]
- [MOSS-REF-TEST-1a] Unix socket 测试必须使用短路径并按 fixture 生命周期释放
  - 触发：MOSS shared reference encoder 测试创建 ref-encoder.sock，或修改共享目录 fixture。
  - 强制：为 socket 使用独立短 TemporaryDirectory(prefix="moss-ref-")，与 pytest 嵌套 tmp_path_factory 路径脱钩；fixture 在 context 内 yield，使目录覆盖 client/host 使用期；保留跨 encoder single-flight 与相同 artifact/key/音频断言。
  - 验收：在深层 pytest base dir 的 CPU/ROCm lane 跑 test_shared_reference_encoder.py 与 test_inline_reference_shared_across_encoders，确认无 AF_UNIX path too long 且原断言成立。^[PR #8447]

## 决策与踩坑

- [MOSSTTS-4a] 禁止：两个 TTSD reference 都按 request voice key；将 raw locator 当成跨 locator content identity；cache key 与 flight key 对 voice case 使用不同 normalization；向 caller 返回 cache storage；串行 encode TTSD 两 reference；或在 creator exit 时 cleanup flight。
- [MOSSTTS-4b] 禁止：把 `list[float]` 作为长期缓存存储；让完成 batch 在等下一队列项时继续持有；调用方原地 mutate 缓存数组。
- [MOSS-REF-BACKEND-1a] 禁止：在 ROCm 无条件导入 NVIDIA extension；把 AITER 的 LSE keyword 传给 upstream fallback；在 inference/graph path 额外分配 LSE，或改变 causal window 与 padded-query mask。
- [MOSS-REF-TEST-1a] 禁止：把 socket 放到可能超过 AF_UNIX 限制的深层 pytest 目录；仅缩短路径就削弱共享/cleanup 断言，或把测试修复宣称为 production 行为变化。
