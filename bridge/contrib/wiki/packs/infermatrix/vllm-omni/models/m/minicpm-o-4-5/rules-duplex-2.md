---
name: rules-duplex-2
description: "MiniCPM-o 4.5 native duplex 规则（下）：MCPMO-4f omni video frame 随关闭的 audio unit 原子进入 Stage 0（PR #6404）、MCPMO-4g Stage 1 rollover 只重算 Talker context（PR #6626）、MCPMO-4h response/playback history 归属（PR #6529、PR #6821）、MCPMO-4i full_attention Talker 保留上下文（PR #6799）、MCPMO-4j shipping profile 不写正的 active_stream_window"
metadata:
  scope: 只收 MCPMO-4f 至 4j；MCPMO-DUPLEX-TILE-1a 与 MCPMO-4b 至 4e 归 rules-duplex-1，turn closure 归 rules-duplex-turn-closure
---
# MiniCPM-o 4.5 native duplex 规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-duplex.md` 的第 2/2 部分；第 1 部分 [[rules-duplex-1]]
- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-duplex.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-04；updated: 2026-10-06
- [MCPMO-4f] omni video frame 必须随其关闭的 audio unit 原子进入 Stage 0
  - 触发：修改 MiniCPM-o Realtime duplex 的 camera/video append、Stage 0 streaming prefill、vision embedding，或视频 demo/client 的 audio-frame interleave。
  - 强制：client 以累计 appended PCM 的 unit boundary 绑定 frame `k`：首个 unit 在约 `1030 ms`（`first_chunk_ms=1035` 对齐 160-sample hop 后），后续每 `1000 ms`；frame 只能附在**关闭 unit `k`**的 append，不能在早期 append 暂存或跨 append carry。视频短于音频时保持最后一帧，单张 still 同样重复。`stack_frames=2` 是 previous+current 的两张图；
    - 整个 append 的 `frame_list` 都属于它关闭的一个 unit，顺序为 `<unit>`、每张各自 `<image>` + 64 vision embeddings + `</image>`、再 audio。vision hidden states 在拼入 token embedding 前转为 token-embedding dtype。
  - 拒绝：携 frame 但没有关闭 model unit 的 append 必须显式失败，且不推进 `audio_chunk_idx`；不能只丢帧后继续音频。Realtime wire 每 append 最多两张图，stacked composite 不改变一秒 audio cadence。视频 demo 同时传 `--input-wav` 和 `--input-video` 时，外部 WAV 覆盖视频 soundtrack 且决定 frame timeline/duration。
  - 验收：覆盖 frame 0 不早于约 1030 ms、每个 frame `k` 绑定其 closing append、无跨 append carry、short/still hold-last、`[f0]`/`[f0,f1]`/`[f1,f2]` stacked 序列、双图 marker/128 embedding 布局、no-unit rejection 不推进 audio index、dtype 对齐，以及 silent video + external WAV。
    - Daily-Omni pack-mode 测试只覆盖数据包装边界，不能替代 Realtime session 或 Stage 0 验证。^[PR #6404]
- [MCPMO-4g] native duplex Stage 1 rollover 只重算 Talker context
  - 触发：修改 native-duplex Talker 长上下文、`attention_type=sliding_recompute`、async-chunk prompt replacement、codec repetition penalty 或 receive-side request registration。
  - 强制：sliding recompute 只由 Stage 1 Talker checkpoint/config 的显式 `attention_type="sliding_recompute"` 启用；native duplex 本身不能覆盖 checkpoint policy。effective context limit 取正的 vLLM `max_model_len` 与 TTS `max_position_embeddings` 的较小值；
    - 每个新 condition 必须声明正整数 `next_stage_generation_tokens=26`，fresh/sliding prompt 加 reserve 都不得越界。
  - 强制：rollover 仅保留前一 condition、该段已确认且不含 EOS/非法值的至多 25 个 codec ids、当前 condition；condition sequence 必须单调连续。replacement 在 scheduler thread 原子清空旧 output/KV prompt ownership、重建 block hashes 并回到 admission；model 以相同 sequence 验证/replay frozen embeddings，repetition penalty 只继承最近 16 个 codes。
    - turn boundary 不得跨 turn recompute。
  - 验收：覆盖 first condition、连续 rollover、same-condition replay、turn reset、limit/reserve 边界、confirmed-placeholder 裁剪、EOS/非法/跳号/缺 metadata 拒绝、latest-16 penalty 与 cleanup/ID reuse；scheduler 必须只处理当前 live request。目标合入的 CPU/unit tests 证明状态机与 fencing；
    - PR 最终 real-weight E2E 未全绿，不能据此声称音频质量、长会话稳定性或跨硬件支持。^[PR #6626]
  - 已知边界：Stage 0 vision encode 失败虽返回 failed prefill 且不推进 `audio_chunk_idx`，但 `preprocess()` 仍可能 fallback 到原 input ids/embeddings；保留的 scheduler span/KV 或 `num_computed_tokens` 是否推进尚未 abort/rollback 证明。另一个 fast/malformed client 的 pending-frame queue 仍未封顶。两者都是未合入 follow-up，不得写成此 frame-binding 修复已解决。
    - 此前 NPUGraph / soft-interrupt 范围已从本 PR 移除。^[PR #6404]
- [MCPMO-4h] response/playback history 必须由回答它的 input commit 所有
  - 触发：native duplex response create/end、input commit、playback ACK、conversation item register/delete/truncate 或 auto-response terminal closure。
  - 强制：pre-commit 对精确 `item_<response_id>` 的 ACK 预留当前 history position；active zero-audio ACK 也创建不可见 placeholder。response 完成后的 ACK 在该 slot upsert/extend，未预留 stale ACK 仍返回 typed too-late error。partial snapshot 保留到 response inactive 且 playback fully committed；
    - delete 清理 placeholder、snapshot、marks/truncation state。explicit truncate 与 ACK truncate 施加 monotonic minimum cap，later ACK 不得恢复 text/audio。client final input commit 前 checkpoint ACK，commit 后再 ACK draining response-local playback；范围仅 MiniCPM native-duplex `ack_only`。
  - 验收：zero-audio reserve、partial ACK→commit→response-end→later ACK 原位扩展、unreserved stale reject、delete cleanup、两种 truncate cap 与 checkpoint-before-commit 顺序均须覆盖。^[PR #6529] ^[PR #6821]
- [MCPMO-4i] full_attention Talker 必须保留上下文直至容量溢出才 rollover
  - 触发：修改 MiniCPM-o Talker `attention_type`、Stage 1 streaming session update、`meta.next_stage_prompt_len`、condition sequence metadata，或 shipping `minicpmo_4_5.yaml` 的默认 attention 策略。
  - 强制：默认遵循 checkpoint 声明的 `full_attention`；在该模式下，只要「下一 condition + codec-generation reserve」仍落在由 runtime `max_model_len` 与 `tts_config.max_position_embeddings` 导出的有效上限内，就必须保留已累积的 Talker KV/history 并追加；
    - 仅在严格溢出时才重建受支持的 one-previous-condition 窗口，释放旧 KV/encoder 与 connector watermark，重置异步 replacement state，并让请求重新进入 admission。精确贴合上限时允许 append，之后继续累积直至下次溢出。显式 `sliding_recompute` 仍在每个 condition 边界重算；
    - 正整数 `meta.next_stage_prompt_len` 是 scheduler 的权威 placeholder 长度，合法 Talker condition 即使缺少 legacy `ids.prompt` 也必须先 append 真实 prompt 再推进 sequence/lifecycle。
  - 验收：覆盖 fit/exact-fit/overflow、producer-owned 与 receiver-owned sequencing 兼容、`next_stage_prompt_len` 驱动的 append，以及显式 `sliding_recompute` 仍按边界重算；不得用 capacity-triggered rollover 的通过外推为已修复无关 perf 回归。^[PR #6799]
- [MCPMO-4j] shipping profile 不得再写入正的 active_stream_window
  - 触发：修改四份 `minicpmo_4_5*.yaml` 的 `active_stream_window`，或 `ChunkTransferAdapter` 的有界 `_promote_active_streams` 路径。
  - 强制：这些 profile 省略该键，使默认 `0` 关闭 limiter，adapter 留在 unlimited path。配置测试断言 `active_stream_window == 0`，而不是 `== max_sessions`。8×4090 的并发上限仍由 stage `max_num_seqs=1` 承担，不靠窗口 1。
  - 验收：四份 base profile 展开后窗口为 0，且默认 serve 不进入 K-bounded promote。^[PR #7416]

## 决策与踩坑

- [MCPMO-4g] 禁止：让 Stage 0 或非显式 Talker 进入 sliding window；从 placeholder/未确认 token 构造 rollover；累积全部 codec history；在 receiver thread 直接改 scheduler token counters；异常后跳过已消费 chunk 继续运行。
  - 任一缺失 metadata、跳号、超长、EOS/非法 codec 或 prompt-length mismatch 必须记录为 receive failure，并由 scheduler 将仍存活 request 置为 `FINISHED_ERROR`。
- [MCPMO-4h] 禁止：用 global last-assistant buffer 或在新 user item 后 append old assistant；让 later ACK 越过 hard cap；把此 ordering fix 外推为通用 realtime/reliability guarantee。
- [MCPMO-4i] 禁止：把无条件 per-condition recompute 当作生产默认；硬编码 `4096` 当作有效上限；在未溢出时丢弃可保留的 Talker history；或把本路径写成已支持物理 KV preemption 后的增量 full-attention replay。
- [MCPMO-4j] 禁止：为恢复 first-packet 并发把正窗口写回这四份 profile；把窗口等于 session capacity 的旧断言写回测试。任何正值都会离开 unlimited path。
