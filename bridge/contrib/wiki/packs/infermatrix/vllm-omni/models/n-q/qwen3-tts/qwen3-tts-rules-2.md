---
name: qwen3-tts-rules-2
description: "Qwen3-TTS 规则（二）：Q3TTS-3a async connector 首块 prefix 后续 delta、3b decoder state 按 scheduler ID 定位并在终止边界释放、3c compacted batch 保持 request slot、3d eager 与 CUDA Graph 共用 phase 合同、3e adaptive ramp host-side 控制器（PR #6001），以及 PR #6001 与 PR #5202 的性能证据边界"
metadata:
  scope: 只收 Q3TTS-3a 至 3e 与两段 PR 性能证据边界；ref-audio 与 NPU RoPE 规则归 qwen3-tts-rules-1，Q3TTS-4a 至 5a 与 PR 规则归 qwen3-tts-rules-3
---
# Qwen3-TTS 规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[qwen3-tts-rules-1]]；第 3 部分 [[qwen3-tts-rules-3]]
- 源页：`knowledge/repos/vllm-omni/models/qwen3-tts/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, serving, qwen-omni；created: 2026-07-20；updated: 2026-10-24
- [Q3TTS-3a] async connector 只在首块传 prefix，后续只传 delta
  - 触发：`async_chunk=true` 的 Talker→Code2Wav 分块、ICL reference code、x-vector-only 或 chunk ramp。
  - 强制：首块包含有界 ICL ref prefix 和已完成 codec frames；后续块只传新完成 frames，`left_context_size=0`，依赖 Code2Wav 按 request 维护 quantizer/conv/Transformer 状态。首个也是最后一个的短请求必须一次发出全长；空的 finished payload 仍携带 request ID 以便清理。
  - 强制：async Code2Wav 缺 request ID 必须 fail fast；首个 ICL 状态若声明 `ref_context_size` 却没有实际 prefix，也必须拒绝。非 async/stateless 路径继续传全序列，不要求 request ID。
  - 验收：ICL/xvec、ramp/固定 initial chunk、首块即 final、空 EOF、丢失 request ID/ref prefix，并证明后续 payload 没有重发旧 frames。 ^[PR #5202]
- [Q3TTS-3b] decoder state 必须以 scheduler ID 定位且在所有终止边界释放
  - 强制：正常 runner 调用用 `request_ids` 中的 scheduler/internal ID 作 cache key，因为 `on_requests_finished()` 接收的是同一 ID；payload/external `meta.request_id` 仅作 direct-forward 与 CUDA Graph dummy run 没有 runner ID 时的 fallback。
  - 强制：正常 `finished`、resumable `is_segment_finished`、空/无效最后载荷和 scheduler abort 都要清理；segment 边界后不得继承上一段 KV/conv/quantizer 状态。dummy ID 需显式 `_is_dummy_run`；decoder dummy path 与正在进行的外层 CUDA Graph capture 必须走 exact decode，且 dummy replay/fallback 不得污染运行统计。
  - 边界：`_decoder_state_cache_warn_entries=512` 是 warning threshold，不是容量上限；为保持 active request 正确性不做 LRU eviction。因此 ID mapping 与 abort cleanup 是防止 GPU state 无界增长的必要合同，不能用“有 512 上限” 掩盖泄漏。
  - 验收：internal/external ID 不同的 abort、finished/segment-finished、dummy direct call、空/非法 row 并存的 batch。目标 pin 没有专门让 Code2Wav cache 在 `is_segment_finished` 后清空的 focused test，该边界仍需补齐。 ^[PR #5202]
- [Q3TTS-3c] compacted batch 必须保持原 request slot，输出长度归 decoder
  - 强制：有状态请求按 mode（ICL/xvec）、phase（first/growing/rolling）、target suffix shape 分组，再恢复到原 request slot；一个 right-padded `[B,Q,F]` 输入必须同时传真实 lengths 和对齐的 state list。跳过空/malformed row 后的 stateless leading-context trim 必须经 `valid_indices[row]` 回到原 batch 位置，不得用 compacted row 直接索引 metadata。
  - 强制：decoder 返回每请求精确长度的 waveform list；stateless 分支移除 right padding/内部 overlap，Code2Wav 只再移除 scheduler 声明的 leading ref context。这一 stateless 合同也影响使用 `Qwen3TTSCode2Wav` 的 Aura-Omni，不能只测 Qwen3-TTS async 路径。
  - 验收：覆盖 empty/malformed row 与有效 ICL row 混合、variable prefix left-padding mask、mixed-phase slot restoration，以及 stateless ref-audio leak/short-row tail 回归。^[PR #5202]
- [Q3TTS-3d] eager 与 CUDA Graph 必须共用可达 phase 合同
  - 触发：修改 segmented graph、first/growing/rolling phase、chunk ramp、capture shape/batch bucket 或 eager fallback。
  - 强制：无 ramp 时 phase 从 `initial_codec_chunk_frames`、`codec_chunk_frames`、decoder `sliding_window` 派生；有 ramp 时用实际 delta。async 忽略 `decode_cudagraph_capture_sizes`；stateless 用默认 shape 与配置额外 shape 的 **union**。
    - `decode_cudagraph_batch_sizes` 只限 graph bucket，`decode_batch_max_size` 只拆 eager stateful group（0 表示不限），两者不可混同。旧 `decode_compile_shapes`/`decode_batch_bucket_frames` 已不再被 Qwen3 Code2Wav 消费，不得将遗留 YAML 字段当作有效调优。
  - 降级：不支持的 phase/shape 或 graph 启用失败要 fallback eager 而不得返空；ROCm/NPU/enforce-eager 都依赖 eager 合同，不能把 CUDA-only 测试外推为跨平台验证。
  - 精度：增量解码与 full decode 数值接近但不保证 bit-exact，shape、layout 和 contiguity 均可引入小浮点差异。验收要覆盖 eager/graph、ICL/xvec、first/growing/rolling、partial-final trim、缺失 capture 与 graph-enable 失败。^[PR #5202] 最终 pin 没有 PR body 早期描述的 `_last_output_audio_length`；
    - 真实合同是 exact-length `list[Tensor]` 加 Code2Wav 的 stateless leading-context trim。
- [Q3TTS-3e] adaptive ramp 是 host-side、每段 opt-in 控制器，不是 CUDA graph 计划
  - 触发：`codec_chunk_adaptive`、Talker→Code2Wav async chunk、动态 IC、buffer/underrun telemetry，或 Qwen3-TTS deploy 的 chunk key。
  - 强制：默认关闭；启用后优先于 fixed `codec_chunk_ramp`。chunk 0 保持 dynamic IC（即使配置了 fixed initial IC），chunk 1+ 才逐 emit 从本段 controller 决定 target。controller 以 80 ms/frame 的 emitted audio 减去 first-emit 后 wall time 得 buffer；以 EWMA（alpha 0.3）估算 frame time。
    - greedy target、无条件 ramp floor `last_target + max(ramp_delta_min, int(ewma/ramp_divisor))` 和 `codec_chunk_min_frames..codec_chunk_frames` clamp 合并；buffer 达到 `codec_chunk_frames * ewma + safety_margin` 后 hysteresis lock 在 max。
    - floor 在负 buffer 下也不能关闭：即使 W5 streaming decoder state 已在基线，per-chunk transport/padding/graph overhead 与 overload death-spiral 仍使向下缩块不是本 PR 的策略；downward adaptation 明确 deferred。
  - 强制：非终止也发送所有已积累的 new frames；finished flush 全部余帧，无余帧仍发 empty-finished sentinel。recorded `last_target` 必须是本次 intended target，不能用实际 overshoot emitted frames，否则 spike 会把 floor 错误 ratchet 到 max。controller state 在 segment boundary/request cleanup 清除；
    - 每段 INFO telemetry 记录 chunk trajectory、每块 gap 与 total gap。
  - 配置：`codec_chunk_adaptive=false`、`codec_chunk_min_frames=2`、`codec_chunk_safety_margin_ms=50.0`、`codec_chunk_ramp_divisor=15`、`codec_chunk_ramp_delta_min=2`；min/divisor/delta-min 小于 1 clamp 为 1，最大值固定是 `codec_chunk_frames`（没有单独 adaptive max key）。两份 Qwen3-TTS deploy 只注释示例，未默认开启。
  - CUDA 边界（未解决、非阻塞）：CUDA 的 Code2Wav graph capture grid 从 fixed IC/ramp 建，而 controller runtime cumulative boundaries 通常不在该 grid；adaptive ramp（含 dynamic-IC chunk 0）因此可 eager，910B NPU 不受该 CUDA graph path 影响。已匹配 source 的 nonterminal partial replay 还可能不 advance decoder cache。
    - 这两点尚无 merged fix，不得声称 adaptive 与 fixed ramp 同等 graph replay 或 cache continuity；在 CUDA 上以 graph stats/hit rate 实测。^[PR #6001]
  - **PR #6001 性能证据边界**
    - 这不是通用吞吐/RTF 改善承诺。合并前 A/B 是 Ascend 910B、vLLM 0.27.1 + vLLM-Ascend PR #14027、Qwen3-TTS voice-clone、40 requests、concurrency 8；adaptive 为 opt-in 唯一变量：mean RTF 0.746（default 0.757 / fixed 0.789）、mean underrun 0.14 s（1.18 / 0.27），continuity OK 35%（0% / 22.5%）。
      - 另一 910B c=2 观测 RTF 0.56、underrun 0.02 s；c=8 per-stream RTF>1 仍会饱和。作者听音验证质量，但未给跨硬件或 CI unit suite 证据。
    - 更准确的主张是 portability：约 11 ms/frame 的 CUDA hardware 不重调 Ascend 手选 `[4,4,8,16,25]` 即自适应出 `[2,4,25,25,3]`；CUDA graph miss 可解释相对 fixed ramp 的损失。上述数字、模型、负载和软件栈以外不得外推。^[PR #6001]

### PR #5202 性能证据边界

- 作者基准是单张 RTX 3090 24 GB、vLLM 0.26.0、Omni `b8edbc8d`、Seed-TTS 32 prompts、concurrency 1/2/4/8/16、batch-size-1 graph capture；cached RTF 从 `0.222` 至 `0.718`，相对 baseline 报告吞吐改善 `10.3%/20.2%/31.1%/40.4%/34.1%`，mean WER `0.0089`。这是特定配置与数据集证据，无 raw result 链接/重复次数或方差，不可当作通用 SLA。
  - PR 自报 focused tests `34+22+101 passed`，同时保留一个未改动的 log-capture 失败，不得记为全绿。该 `b8edbc8d` 是 pre-merge 基准 SHA，不是目标 `4f9b6507` 的性能证明。
- 最终 reviewer 在 H20、vLLM 0.26.0 上用 current main `12a5f6fb` 对照 head `c63c2efc`，8.08 s clone reference 的输出前缀相关系数为 base `-0.0034/+0.0028`、head `+0.0005/-0.0038`，支持“未重现 reference-audio leak”。该单请求 A/B 不覆盖 compacted-batch index fix，它的证据来自新单元测试，不得混为硬件验证。
- 共享 readiness/错误隔离规则见 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving rules）；Qwen 家族入口见 [[qwen-omni-overview]]（Qwen-Omni）。
