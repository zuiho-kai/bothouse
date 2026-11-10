---
name: higgs-audio-rules-mrv2-audio
description: "Higgs V3 MRv2 audio state 规则 HIGGS-MRV2-1a…1c：model-owned decode state 的 admission / 按 request 的 RNG / 退休清理，audio snapshot 采样后拥有 storage 并在 D2H 后纯化转换，sampler 与 Code2Wav graph 启动期捕获、exact (batch,frames) key、返回前 clone（PR #8226）"
metadata:
  scope: 只收 Higgs V3 在 MRv2 路径下的三条 HIGGS-MRV2-* 规则；V3 request RNG、voice-clone 占位、fixture 与 reference-code encode 规则（HIGGS-1a / 2a / 3a 与 HIGGS-FIXTURE-1a）归 higgs-audio-rules
---
# Higgs V3 MRv2 audio state 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/higgs-audio/rules-mrv2-audio.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8226
- 置信度（confidence）：high
- [HIGGS-MRV2-1a] model-owned state 的 admission、RNG 与退休必须按 request 闭合
  - 触发：修改 Higgs `create_omni_model_state`、request slot、sampler registration、MRv2 profile 或 audio feedback。
  - 强制：在 graph capture 前固定 decode-state storage，由模型 factory 创建 Higgs state。MRv2 要求 `audio_async_payload`；该模式同时要求 async scheduling 和 prompt-mode classification。真实 request 支持 temperature/top-k/top-p，明确拒绝 text penalties、logprobs/prompt_logprobs、非零 min_tokens/min_p、allowed/bad tokens 和 logit bias；
    - sampling 阶段拒绝 grammar 与 draft tokens，upstream synthetic warmup 保留标准 sampler 路径。request seed 建立独立 generator，eager/graph 都用对应 rows 的 exponential noise；退休时清理 model decode state、request/slot/generator 和 cached metadata。graph padding rows 不拥有 request，feedback embedding 保持零。
  - 验收：request add/remove/reorder/reuse、seeded eager/replay、mixed prefill/decode 和 padding rows 对照；每个 unsupported option 显式失败，warmup 对照仍走 upstream path，退休后相同 slot 的新 request 无旧帧或 RNG 污染。^[PR #8226]
- [HIGGS-MRV2-1b] audio snapshot 必须在采样后拥有 storage，并在 D2H 后纯化转换
  - 触发：修改 `post_sample_multimodal_outputs`、Higgs async snapshot/finalizer、batch chunk adapter 或 whole-utterance code conversion。
  - 强制：仅在采样后按当前 batch row 导出 audio codes；async GPU staging 由每步 snapshot拥有，D2H 完成后 finalizer 只读取 CPU snapshot与该步 invalid rows，不能读 mutable decode/request state。保留二维 empty `[0,Q]` row，避免 terminal/invalid step 覆盖此前累计 full-response rows。
    - chunk batch adapter 保持单请求 accumulation、de-delay、right holdback、left context 和 emitted-frame counters；whole-utterance native/legacy paths 共用同一 de-delay conversion，之后将 special/padding codes 替换为零并保留原 residual ramp-down removal。
  - 验收：异步 copy 与后续 sampling/reorder 并发时，旧 snapshot 仍对应原 request；覆盖 invalid/terminal empty、整段与 chunk adapter 等价、mixed batch completion，以及 payload为空时不解码 placeholder。^[PR #8226]
- [HIGGS-MRV2-1c] sampler 与 codec graphs 必须在启动捕获并保持真实 shape 与输出所有权
  - 触发：修改 Higgs full-sample graph startup、codec graph shapes、graph pool/storage 或 mixed FULL attention metadata。
  - 强制：sampler graph 在启动以相同 noise 核对 eager/captured state transition，保留 captured state/cache 的 allocations；serving 只 replay 已有 shape，unsupported metadata/shape 走 regular sampler。Code2Wav graph 以 exact `(batch,frames)` 为 key，time 和 batch 均不 padding，未捕获 shape eager；
    - 返回前 clone audio，避免下一 group/replay 覆盖同 pool storage。mixed FULL capture 的 query bound 不能使用 dummy 平均长度，后续 separate-decode/explicit-bound 约束遵循 [[rules-attention-capture]]（attention capture rule）。
  - 验收：分别验证 sampler state/noise parity、exact codec singleton/batch/frame shapes、bucket miss eager、连续 group output不互相覆盖，以及真实 mixed-prefill attention capture/replay；每项优化须有实际 gate/replay 证据。^[PR #8226]

## 决策与踩坑

- [HIGGS-MRV2-1a] 禁止：把 Talker 内 graph sampling 状态或 RNG 作为 batch-global历史；为接受 unsupported request 而默默忽略采样约束；退休 slot 后继续消费其 audio feedback；将 H200 opt-in profile 外推为默认部署或跨平台能力。
- [HIGGS-MRV2-1b] 禁止：提前导出 forward 的上一帧 state；重用共享 host staging 给未完成 snapshot；把 terminal empty 改成一维值；clamp EOC 到合法 codec id；将 scheduling placeholder 当作实际 audio payload（包括 empty terminal payload）。
- [HIGGS-MRV2-1c] 禁止：serving 临时 capture；以一条 batch shape 替代所有 convolution boundaries；返回 graph-owned audio view；由 CPU mock、一次 FA3 replay或历史 benchmark 推断所有 shape、checkpoint、硬件的音频质量和性能。
