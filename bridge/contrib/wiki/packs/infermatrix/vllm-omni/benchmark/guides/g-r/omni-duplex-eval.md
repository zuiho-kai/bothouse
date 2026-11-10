---
name: omni-duplex-eval
description: "MiniCPM-o Omni-DuplexEval（vllm bench omni-duplex-eval --omni generate / evaluate / summarize，PR #6634）：Hothan/Omni-DuplexEval 九个 split 的选择、--mix question 生成与 realtime pacing、response 与 .meta.json artifact、clock=invalid 处理、PROTOCOL_PIN 评分协议与 RTD 时间窗公式、27-case smoke 的证据边界"
metadata:
  scope: 只收 Omni-DuplexEval CLI 的数据选择、生成、生命周期、artifact 和评分协议合同及其证据边界；媒体解码必须用 PyAV 的规则 BENCH-1g 归 benchmark-rules，OmniInteract serving runner 归 omniinteract-realtime
---
# MiniCPM-o Omni-DuplexEval

## 关键事实

- 源页：`knowledge/repos/vllm-omni/benchmark/guides/omni-duplex-eval.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, benchmark；created: 2026-09-04；updated: 2026-09-04
- 来源（sources）：PR #6634；examples/online_serving/minicpmo/README.md；vllm_omni/benchmarks/duplex/；vllm_omni/entrypoints/cli/benchmark/omni_duplex_eval.py；vllm_omni/experimental/fullduplex/client.py
- 置信度（confidence）：high
- `vllm bench omni-duplex-eval --omni <generate|evaluate|summarize>` is the installed workflow for evaluating MiniCPM-o native-duplex output. Generation uses the vLLM-Omni WebSocket endpoint; evaluation uses a separate OpenAI-compatible multimodal judge.
  - This exercises vLLM-Omni's duplex client, artifact, and local-judge integration. It does not reproduce the paper's original inference implementation or establish paper-score parity. ^[PR #6634]

### Selection and generation contract

- `Hothan/Omni-DuplexEval` contains six RTD and three PR Hugging Face splits; those names are splits, not dataset configurations. `--split` selects one, while omitted/`all` loads all nine.
  - Local JSON/JSONL manifests and `--media-root` are supported; `--ids` and `--limit` filter after normalized samples are built.
- PR task semantics come from the split name when a row has no explicit task: correction, event reminder, or post-event reminder. Do not silently default an unknown split to a reminder task.
- Generation currently supports only `--mix question`. It converts question audio to mono 16-kHz PCM16 when needed, interleaves optional JPEG frames, and streams media units through `RealtimeDuplexClient`.
  - Realtime pacing is required for scoreable media-clock timing; as-fast-as-possible artifacts are marked `clock=invalid`.

### Lifecycle and artifact contract

- The client periodically acknowledges playback while streaming, commits the input, waits for `response.done`, acknowledges the remaining playback, and closes the session.
  - A response or close timeout is retained in metadata rather than erased; `response_done` therefore remains distinct from merely having a response file.
- Each generated sample writes `<response-root>/<split>/<id>.json` plus a sibling `.meta.json`. Metadata pins pace, clock, mix, FPS, unit size, model, response/timeout state, and the reference-audio SHA-256. Evaluation rejects `clock=invalid` unless `--allow-invalid-clock` is explicit.
- Text deltas are sentence-split and timestamped against the input media clock. Every accepted millisecond clock field is divided by 1000; wall-clock and media-clock values must not be mixed.

### Scoring protocol

- Prompt wording and window math are pinned by `PROTOCOL_PIN` to `OpenBMB/Omni-DuplexEval@ca3c122b4d4bf67afd6b18ea5e724b4561bdde48`. Changing either requires a pin bump and a recorded score delta.
- For RTD temporal scoring, a response sentence uses `start=max(0, sentence_start-2)` and `end=max(start+0.5, sentence_end-2)`. This keeps early responses instead of discarding negative pre-roll.
  - Content scoring uses the full video URL or explicitly sampled frames; the frame-sample path must pass those frames to the content judge, not only to temporal scoring.
- PR correction scores the complete response. Reminder tasks score response text in each event's configurable post-start window, and a sample succeeds only when every required event succeeds. `summarize` aggregates RTD content and temporal means by split and PR all-event success by task.

### Evidence boundary

- The PR author reported a stratified 27-case run—three samples from each of the nine splits—with all generation and judge jobs completing. That is a smoke of the 660-case dataset, not a full evaluation.
  - The reported scores used vLLM-Omni MiniCPM-o plus a Qwen2.5-VL-7B frame-sample judge, so they are environment- and judge-specific; do not turn them into quality, latency, full coverage, or paper-equivalence guarantees. ^[PR #6634]
