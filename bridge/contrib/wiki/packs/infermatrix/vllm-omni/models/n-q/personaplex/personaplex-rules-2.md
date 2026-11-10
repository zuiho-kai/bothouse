---
name: personaplex-rules-2
description: PersonaPlex 规则（下）：VLLM-OMNI-PR8670-AMD-PPLEX-NIGHTLY（已被取代）、VLLM-OMNI-PR8751-AMD-PPLEX-NIGHTLY（Mimi 压力用例只在 AMD nightly 承接、单条 --deselect）、VLLM-OMNI-PR9113-CODE2WAV-DELTA（final stage 用 DELTA 输出、audio_output_is_delta）
metadata:
  scope: 只收两条 AMD PPLEX nightly 规则（PR8670 已退役，PR8751 现行）与 PR9113 DELTA 规则；PPLEX-1a 至 3b 及 1d、1e 归 personaplex-rules-1
---
# PersonaPlex 规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/2 部分；第 1 部分 [[personaplex-rules-1]]
- 源页：`knowledge/repos/vllm-omni/models/personaplex/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, model-executor；created: 2026-09-02；updated: 2026-10-23
- [VLLM-OMNI-PR8751-AMD-PPLEX-NIGHTLY] PersonaPlex Mimi 压力用例只在 AMD nightly 串行承接
  - 触发：改动 `.buildkite/amd/test-amd-ready.yml`、`.buildkite/amd/test-amd-merge.yml`、`.buildkite/amd/test-amd-nightly.yml` 的 Model Executor CPU shard 或 “Simple · PersonaPlex Temporal Streaming Test” 步骤；
    - 重命名或删除 `tests/model_executor/models/personaplex/test_temporal_streaming_hoist.py` 中的 `test_mimi_streaming_step_matches_legacy_end_to_end`；或修改 `tests/buildkite/test_amd_pipeline.py` 的 AMD pipeline contract。
  - 强制：AMD READY/MERGE 的 Model Executor 步骤保持 `-m 'core_model and cpu and not omni'` 与 `--num-shards=$$BUILDKITE_PARALLEL_JOB_COUNT`/`--shard-id=$$BUILDKITE_PARALLEL_JOB` 分片，只允许一条精确到 node 的 `--deselect` 前缀（`test_mimi_streaming_step_matches_legacy_end_to_end`），同文件其余快速节点继续留在阻塞 shard。
    - 被移出的 Mimi stress 用例由 nightly 的 PersonaPlex Temporal 步骤串行承接（collect-only、110m timeout、junitxml artifact）。三份 yml 与 `tests/buildkite/test_amd_pipeline.py` 断言的 contract 必须同步修改。
  - 验收：READY/MERGE 只剩 Mimi 一条 `--deselect`；nightly 步骤的 collect 与 run 都只含 Mimi 用例；`tests/buildkite/test_amd_pipeline.py` 与三份 yml 当前内容一致并通过；
    - `personaplex_temporal.py` 保留的 ring-KV/RoPE 原语仍由 `test_ring_per_row_offsets.py` 的存活用例覆盖——注意 PR #8751 同时删除了该文件中的 `test_ring_slot_recycle_masks_old_history`，不得把该文件的覆盖说成完全不变；原语的检查义务另受 PPLEX-HOIST-1a 约束。 ^[PR #8670] ^[PR #8751]
- [VLLM-OMNI-PR9113-CODE2WAV-DELTA] 整 session 复用的 Code2Wav 请求必须以 DELTA 音频流出
  - 触发：修改 PersonaPlex duplex plugin 的 `configure_sampling_params` 或任一 stage 的 `RequestOutputKind`；修改共享 `CumulativeAudioTextDataPlane`（`vllm_omni/model_executor/common/duplex/data_plane.py`）的 `audio_output_is_delta` 投影；
    - 或发现整 session 复用的 duplex stage 请求仍在用默认 CUMULATIVE 输出——那会让 output processor 在 API server 进程内每帧重 consolidate 全部历史 multimodal tensors，每帧成本随通话长度增长。
  - 强制：只为 final stage（`configured[-1]`，即 Code2Wav）在 clone 出的 sampling params 上设 `output_kind=RequestOutputKind.DELTA`，不得改写共享默认值；Stage 0 与中间 stage 保持默认 CUMULATIVE。PersonaPlex 数据平面声明 `audio_output_is_delta = True`：delta 音频按新 chunk 整段透传，不再对 running sample count 切片；
    - DELTA 下 output processor 不做 consolidate，一次输出可能携带多个 step 的 chunk list，必须先 join 成单个 waveform 再计数与编码。文本继续走 cumulative text cursor，只发新 suffix。共享数据平面的 `audio_output_is_delta` 默认保持 `False`，其他 duplex 模型维持现有 cumulative 切片行为。
  - 验收：`tests/model_executor/executor_common/duplex/test_data_plane.py` 覆盖 delta 音频整段透传（短于先前 chunk 的 chunk 也整段编码；空 chunk 且无新文本不产出）与同批到达的 ragged chunks 以 numpy 与 torch tensor 形态 join 成单个 waveform（`test_delta_audio_passes_through_unsliced`、`test_delta_audio_chunks_that_arrive_together_are_joined`），
    - 且既有 cumulative 投影用例不回归；`tests/model_executor/models/personaplex/duplex/test_plugin.py` 断言 Stage 1 是 DELTA clone、Stage 0 与共享默认值未被污染，并覆盖只有 final stage 切到 DELTA（`test_only_the_final_stage_switches_to_delta_output`）；`tests/engine/duplex/test_session_runner_personaplex.py` 以 delta Code2Wav 输出驱动投影；
    - 性能收益须在目标并发（1–4 session）下端到端实测（PR #9113：4-session 下 API server CPU 0.8→0.2 cores）。^[PR #9113]

## 决策与踩坑

- [VLLM-OMNI-PR8751-AMD-PPLEX-NIGHTLY] 禁止：恢复 `test_temporal_streaming_step_matches_legacy_end_to_end` 的 `--deselect` 或 nightly 条目——该用例已随 dead temporal stepper（`PersonaPlexTemporalStreaming`/`_TemporalLayer`）在 PR #8751 删除；把 `--deselect` 放宽为文件级或通配前缀；只改 yml 不改 `test_amd_pipeline.py`（或反之）；
  - 因 stepper 已删而连带删除 `personaplex_temporal.py` 中 Mimi 仍消费的 ring-KV/RoPE 原语。
- [VLLM-OMNI-PR9113-CODE2WAV-DELTA] 禁止：直接改写共享或默认 sampling params；给非 final stage 设 DELTA；delta 模式下仍按 sample cursor 切音频，或未声明 delta 就跳过切片；假设每个输出恰好一个音频 chunk；只凭机制推理、不在目标并发下做端到端测量就宣称每帧成本不再随通话长度增长。

## 历史

- [VLLM-OMNI-PR8670-AMD-PPLEX-NIGHTLY] PersonaPlex temporal 压力用例只在 AMD nightly 串行承接
  - 触发：改动 `.buildkite/amd/test-amd-ready.yml`、`.buildkite/amd/test-amd-merge.yml`、`.buildkite/amd/test-amd-nightly.yml` 的 Model Executor CPU shard 或 “Simple · PersonaPlex Temporal Streaming Test” 步骤；
    - 重命名 `tests/model_executor/models/personaplex/test_temporal_streaming_hoist.py` 中的 `*_matches_legacy_end_to_end` 用例；或修改 `tests/buildkite/test_amd_pipeline.py` 的 AMD pipeline contract。
  - 强制：AMD READY/MERGE 的 Model Executor 步骤保持 `-m 'core_model and cpu and not omni'` 与 `--num-shards=$$BUILDKITE_PARALLEL_JOB_COUNT`/`--shard-id=$$BUILDKITE_PARALLEL_JOB` 分片，
    - 只允许两条精确到 node 的 `--deselect` 前缀（`test_temporal_streaming_step_matches_ legacy_end_to_end` 与 `test_mimi_streaming_step_matches_legacy_end_to_end`），同文件其余快速节点继续留在阻塞 shard。
    - 被移出的 stress 用例必须由 nightly 的 PersonaPlex Temporal 步骤承接：`mi300_1`、`grade: NonBlocking`、`timeout_in_minutes: 120`，内层用 `timeout --signal=TERM --kill-after=2m 110m` 留出 artifact 落盘与 teardown 余量，先 `--collect-only` 落盘再串行执行，collection 输出、JUnit XML、完整 pytest log 与 tail summary 全部作为 artifact 上传。
  - 禁止：用 `--ignore` 整文件、slow marker 或改写 marker 表达式替代精确 deselect；为该 nightly 步骤引入 retry、xdist、空 collection override 或掩盖失败的 fallback；把该 deselection 传播到 CUDA READY/MERGE（CUDA 管线不得过滤该文件的任何节点）；deselect 后不在 nightly 承接，静默丢失 oracle 覆盖。
  - 验收：`tests/buildkite/test_amd_pipeline.py` 的 contract 必须同时锁定 ready/merge（恰一个 Model Executor CPU shard、marker 不变、`parallelism == 3`、无 `--ignore`、deselect 恰为两条前缀）与 nightly（选择同样前缀、NonBlocking、120/110 超时结构、预期 artifact 路径）；重命名测试函数时必须同步 deselect 前缀与 contract。^[PR #8670]
  - 退役记录：kb:rule status=retired since=v0.30.0 retired_at=v0.30.0 reason=superseded
    - evidence="PR #8751 diff：.buildkite/amd/test-amd-merge.yml 与 test-amd-ready.yml 各删除 temporal --deselect 行、仅保留 mimi 行；test-amd-nightly.yml 的 collect-only 与 run 命令都只剩 test_mimi_streaming_step_matches_legacy_end_to_end；tests/buildkite/test_amd_pipeline.py 同步更新；
    - changed_files 含 tests/model_executor/models/personaplex/test_ring_per_row_offsets.py，其 diff 删除了 test_ring_slot_recycle_masks_old_history。
    - PR body 明确：“#8670 added AMD pipeline steps that name the temporal parity test removed here. Those entries are dropped, and the Mimi streaming stress case keeps its nightly owner.” 且 “The ring-KV and RoPE primitives that Mimi uses stay in personaplex_temporal.py.”"
    - superseded_by=VLLM-OMNI-PR8751-AMD-PPLEX-NIGHTLY
