---
name: rules-code2wav-batching
description: "MiniCPM-o 4.5 Code2Wav 并发批处理规则：MCPMO-3e reference audio（chat ref_audio、Seed-TTS）经私有 prompt 与 llm2tts buffer 到 Code2Wav handoff（PR #6628）、MCPMO-1j 并发 duplex batch 按 request 保存 ragged state、BF16 attention cache、NPU 残余限制（PR #6021）"
metadata:
  scope: 只收 MCPMO-3e 与 MCPMO-1j；TTS 批量与 Talker 采样 MCPMO-3a 至 3d 归 minicpm-o-4-5-rules-2，Code2Wav TensorRT 归 minicpm-o-4-5-rules-1，Code2Wav 运行时合同归 rules-code2wav-runtime
---
# MiniCPM-o 4.5 Code2Wav 并发批处理规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-code2wav-batching.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-04；updated: 2026-09-05
- 来源（sources）：PR #6021；PR #6628；vllm_omni/entrypoints/openai/serving_chat.py；vllm_omni/model_executor/models/minicpmo_4_5/batched_token2wav.py；vllm_omni/model_executor/models/minicpmo_4_5/minicpmo_4_5_code2wav.py；vllm_omni/model_executor/models/minicpmo_4_5/pipeline.py
  - vllm_omni/model_executor/stage_input_processors/minicpmo_4_5_omni.py；vllm_omni/platforms/npu/models/minicpmo_4_5_code2wav.py；tests/entrypoints/openai_api/test_serving_chat_minicpmo45_reference_audio.py；tests/model_executor/models/minicpmo_4_5/test_llm2tts.py
  - tests/model_executor/models/minicpmo_4_5/test_minicpmo_4_5_async_chunk.py；tests/model_executor/models/minicpmo_4_5/test_code2wav_batching.py；tests/e2e/online_serving/test_minicpmo_4_5.py；tests/platforms/npu/test_graph_tools.py
- 置信度（confidence）：high
- [MCPMO-3e] MiniCPM-o 4.5 reference audio 必须经过私有 prompt 到 Code2Wav handoff
  - 触发：MiniCPM-o 4.5 chat `ref_audio`、Seed-TTS、`llm2tts`、Code2Wav prompt selection 或 async chunk。
  - 强制：仅 `_has_minicpmo45_stage` 时读取 reference，优先级为 root attr → `extra_body` → `model_extra.extra_body` → `model_extra`；absent no-op，non-string `ValueError`。chat rendering/policy 后用 `MediaConnector` decode 一次，写回 original prompt private key，不复制 message。
    - `llm2tts` 优先普通 multimodal audio，否则写 private key 至 runner-owned `model_intermediate_buffer.codes.ref` / `meta.ref_audio_sr`。
  - 强制：Code2Wav 对每个 named section 先取 legacy `additional_information`，再以 buffer 中实际提供的 field 覆盖，缺 field 仍 fallback；无 ref 保持 HT default。async 只在 first chunk/cache epoch handoff。
  - 验收：覆盖 root/nested precedence、missing/non-string、一次 decode/serialization、ordinary audio precedence、private buffer/per-field legacy fallback、default HT、async first-chunk/cache epoch；CPU chain mock 不替代 engine E2E。单个 MI300X Seed-TTS row 只证明该 exact request 的 `runtime-ref-*` selection；
    - AMD CI #11229 失败，且 realtime 仍 deferred。^[PR #6628]
- [MCPMO-1j] Code2Wav 并发 duplex batch 必须按 request 保存 ragged state
  - 触发：修改 `MiniCPMO45Code2Wav` bucket/initial-batch partition、`BatchedToken2Wav.decode_ragged_batch`、attention cache dtype 或 NPU Code2Wav patch。
  - 强制：compatibility bucket 只由 prompt/cache history/epoch 决定；当前 token length 与 final flag 不同的短行可共享 masked ragged DiT pass，输出和 Flow/HiFT cache 必须按原 request row 回填。超出 RelPos-safe encode window 的行回退 `decode_batch` 的 sliced path。
    - `code2wav_initial_batch_size` 为非零时必须不小于 min batch，partition 后每个 initial batch 都满足 min；未设置时不改变既有全 bucket 行为。BF16 attention cache 只改变存储表示，compute 保持 FP32。
  - 现有边界：NPU patch 尚未在 `decode_ragged_batch` 外围安装与 exact path 相同的 flow execution context；其 BF16 guard 使用 Python `bool`，因此字符串 `"false"`/`"0"`/`"off"` 会被误判为启用；当 initial cap 为 0 且 min batch 大于 1 时 initial-marker bucket 仍可绕过 min check；steady-state batch 没有 execution-layer cap。
    - CUDA-only BF16 opt-in 与 NPU/ragged 配置必须分别验证，不能把这些限制描述成已关闭。
  - 验收：比较 mixed-length/final-flag batch 与逐 request exact decode 的 audio、Flow 和 HiFT state；覆盖 oversized row fallback、缺失中间 row fail-closed、initial min/max partition、BF16 storage/FP32 compute，以及上述 NPU/initial-marker/steady-state residual limits 的回归或显式拒绝。^[PR #6021]

## 决策与踩坑

- [MCPMO-3e] 禁止：不得为非 MiniCPM 解码、重新序列化 Seed-TTS ref、或将该 chat path 外推至 realtime、通用模型或质量结论。
- [MCPMO-1j] 禁止：用 batch index 复用另一 session 的 state；让 ragged path 跳过 long-input slicing、final-row mask 或 complete-row 检查；把 BF16 cache 当作 compute dtype 变化；用 generic generation scheduler 等待来凑 MiniCPM batch，或把外部 N=8 证据当作默认 two-session deploy/strict realtime claim。
