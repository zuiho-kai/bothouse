---
name: nemotron-voicechat-rules
description: "Nemotron VoiceChat 规则：NVC-1a 原生 duplex 80 ms frame-locked 三 stage 数据面、NVC-1b 工具调用由客户端执行且失败可重试、NVC-1c codec suffix 状态随 request 回收、NVC-1d full-model 音频证据与部署声明限界、NVC-1e native talker prompt/replay/batch 输出、NVC-1f duplex perception 滚动 mel window 保持 full-history 切片语义（PR #6089、#6354、#6831）"
metadata:
  scope: 只收 NVC-1a 至 NVC-1f 与快速入口表；名称、源码路径与 deploy 配置速览归 nemotron-voicechat-overview
---
# Nemotron VoiceChat 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/nemotron-voicechat/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, serving；created: 2026-09-04；updated: 2026-09-06
- 来源（sources）：PR #6089；PR #6354；vllm_omni/deploy/nemotron_labs_voicechat.yaml；vllm_omni/deploy/nemotron_labs_voicechat_duplex.yaml；vllm_omni/deploy/nemotron_labs_voicechat_streaming.yaml；vllm_omni/model_executor/models/nemotron_voicechat/duplex/；vllm_omni/entrypoints/duplex/
  - vllm_omni/core/sched/omni_ar_scheduler.py；vllm_omni/distributed/omni_connectors/transfer_adapter/chunk_transfer_adapter.py；vllm_omni/model_executor/models/nemotron_voicechat/；vllm_omni/model_executor/stage_input_processors/nemotron_voicechat.py
  - tests/model_executor/models/nemotron_voicechat/duplex/；tests/e2e/online_serving/nemotron_voicechat_realtime_duplex.py；tests/model_executor/models/test_nemotron_voicechat_perception_window.py；tests/model_executor/models/test_nemotron_voicechat_talker_replay.py
  - tests/model_executor/stage_input_processors/test_nemotron_voicechat.py；PR #6831
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| duplex data plane、tool result、codec lifecycle 或 deployment evidence | `NVC-1a`–`NVC-1f` |

- 只有 `NVC-数字字母` 是本页可审计规则 ID。

### [NVC-1a] 原生 duplex 是 frame-locked、可恢复的三 stage 数据面

- 触发：修改 duplex deploy、native runtime extension、Stage-0 append，或 Thinker→Talker→Code2Wav handoff。
- 强制：只接受每 80 ms 一帧的 1280-sample/16 kHz PCM 输入；Stage 0 跨 wake 保留可恢复 request，text/function side channel 只消费 scheduler 在本次 wake 冻结的 `new_token_ids`。Talker 的累计 code history 在送入有状态 Code2Wav 前只传未见 suffix；
  - native `codec_streaming` 可在当前累计 timeline 耗尽时结束一个 segment，offline async-stream 则必须同时等 `upstream_finished`，包括零进度 wake。共享的下游 receiver requeue/cleanup 遵循 [[rules-release-queues]]（SCHED-5g；源锚点 #sched-5g-resumable-async-chunk-终态清理必须以-live-queue-所有权为准）。
- 验收：固定 PCM contract、append/runtime contract、scheduler resume 和 data-plane tests 均须通过；offline async-stream completion 也须保持既有终端语义。^[PR #6089]

### [NVC-1b] native 工具调用由客户端执行，失败投递必须可重试

- 触发：修改 `AVAILABLE_TOOLS`/`TOOLCALL`/`TOOL_RESPONSE` prompt、Realtime `function_call_output` 或 runtime update。
- 强制：服务器只验证、排队并 frame-locked reinject 客户端拥有的 function result，绝不执行任意工具；允许多个到达重叠的 result 形成有序 batch。仅在 runtime update 成功且已发出 `conversation.item.created` 后记录 call output，以便投递失败后同一 `call_id` 可重试。
- 验收：覆盖多个 response batch、duplicate/invalid output、delivery failure 后 retry 与 realtime event ordering。^[PR #6089]

### [NVC-1c] codec suffix 状态必须随 request lifetime 回收

- 触发：修改 `talker2code2wav_async_chunk` 的 cumulative-history slicing、causal codec cache，或 native session abort。
- 强制：按 external request ID 记录已见 frame 数和有状态 decoder cache，只把累计 code history 的未见 suffix 送入 decoder；abort/terminal cleanup 必须同时清除 processor payload、chunk watermark 和 codec state，使复用同一 external ID 的新 request 从首帧开始。
  - 共享 sender-generation fence 遵循 [[distributed-rules-1]]（DIST-1h；源锚点 #dist-1h-abort-不能让旧-sender-generation-复活）。
- 验收：覆盖累计输入只解码 suffix、segment 边界保留 cache、abort 清空后同 ID 首帧不混入旧 codes，以及 pending/in-flight sender race 的共享回归。^[PR #6089]

### [NVC-1d] full-model 音频证据和部署声明必须限界

- 触发：修改 full-model E2E gate、Buildkite selection、duplex profile 或 stall-diagnostic timeout ordering。
- 强制：full-model probe 除 response/event 完成外，至少断言 PCM RMS floor、最小 audio packet 数和与 input frame 数相关的 duration/bytes；offline streaming 要比较其原有完整 audio contract。profile 的 `max_num_seqs: 1` 只证明默认 admission 配置。
  - stall diagnostic 用 test-local server 240 秒 deadline 与 client 300 秒 wait，使 stage diagnostics 先于 client expiry；healthy run 不应触达任一 deadline。
- 验收：PR 作者报告 targeted H200 suite 306 passed，reviewer 后续报告 399 CPU tests、offline WAV byte-identical 和 native duplex non-silent audio；这些是提交时证据，当前 KB validation 不能复现真实 checkpoint/H200 E2E。Buildkite 改动只把既有 AMD-ready 步骤的超时从 20 分钟增至 45 分钟，不新增该模型专属 pipeline。^[PR #6089]
- stall diagnostic 的验收固定 server 240/client 300，复现 stall 时 server 先记录 full request ID 并标记 `FINISHED_ERROR`，之后 bare client `TimeoutError` 才到期；同时正常 run 仍有 audio。reviewer 已复现该 ordering，仍未证明 client error event。^[PR #6831]

### [NVC-1e] native talker 的 prompt、replay 与 batch 输出必须保持逐 request 的 frame feedback

- 触发：修改 native talker、Thinker→Talker input processor、stage processor dispatch、talker prompt/sampling budget，或 KV recomputation / multi-session output splitting。
- 强制：native talker 的 placeholder prompt 必须覆盖实际 speaker prefill；shipped Aria geometry 为 `talker_init_len=37`，故 `max_model_len=16384` 时 budget 为 `max_tokens=16347`。processor 只在具名 `next_stage_hf_config` 参数存在时传入该 stage config，同时按 `streaming_context` 或 `_streaming_context` 参数名保留既有 bridge state。
  - duplex native producer 每次最多使一个新 timeline step 可调度，live decode 按帧严格顺序。KV recomputation 必须从保留的 code history 重建 embeds：`t=1` 使用 `initial_code`，后续 `t` 使用 `codes_rows[t-2]`；replay 不采样、不设置 live pending step，也不推进没有 rewind 的 unconditional CFG stream。
  - batch output 必须按 request 对齐并为无新 codes 的 slot 保留其自身 placeholder/cumulative view，供 generic splitter 按 index 分发。
- 验收：覆盖 37-token prefill 与 16347 budget、具名 config/context dispatch、one-step duplex drip 和 batch-aligned outputs。
  - replay tests 必须覆盖 pure replay、replay 后接一个 live step、跨 prefill boundary、live-first boundary rejection、short-history 与 outpaced-position guards，并断言 `initial_code` / `codes_rows[t-2]` arithmetic 和 unconditional stream 在 replay 中不变。^[PR #6354]

### [NVC-1f] duplex perception 的滚动 mel window 必须保持 full-history 切片语义

- 触发：修改 cache-aware perception、80 ms duplex frame ingestion、streaming mel slice、request re-open/reset，或长 session 的 audio/mel retention。
- 强制：rolling window 记录其 stream-global mel column origin，只保留当前 chunk 的 pre-encode cache 所需范围及足以隔离 reflect-pad/preemphasis 边界效应的前置 margin；slice 以 global geometry 计算后再映射回本地 window。对相同输入，这个有界窗口的 chunk/cache 结果必须等同 full-history mel 的对应切片。
  - 若已排队 append 或 stage request re-open 导致 model session 中途缺失，则从当前 input frame 重新建立 perception state 并记录 warning。
- 验收：以长序列覆盖 window trim 后的 global-origin slice 与 full-history reference 的逐块等价，包括 cache、margin 和首帧边界；覆盖 mid-stream session reset/re-open 后从当前 frame 恢复，以及 prefill branch 由 engine position 而非 duplex sequence 决定。^[PR #6354]

## 决策与踩坑

- [NVC-1a] 禁止：把 scheduler segment finish 当作 codec stream lifetime finish；重放累计 code prefix 到 causal codec cache；从 `supports_core_resumable_request` 推出公开 reusable KV lease（该 adapter 明确 `supports_core_kv_lease=false`）。
- [NVC-1b] 禁止：第二个 tool result 抛出 stage-fatal 异常；在 delivery 前写 duplicate-output ledger；把 client tool result 解释为 server-side execution authorization。
- [NVC-1c] 禁止：每次 wake 重放累计 prefix；abort 后继承旧 `frames_seen`/cache；把普通 scheduler segment finish 当成 native codec lifetime finish。
- [NVC-1d] 禁止：用非空 bytes、约 1 LSB 的 RMS 或文本成功证明音频可用；把作者在 H200 实测、generic nightly selector 或 YAML 存在写成 Buildkite pass、wall-clock realtime、确定性 barge-in 或跨硬件保证。不得把 240 秒写成生产模型设置、把 `FINISHED_ERROR` 称作 client error delivery，或声称 #6816 已修复。
- [NVC-1e] 禁止：以第四个位置参数猜测 processor 能力而把 streaming context 传给 `next_stage_hf_config`；让 prompt 加 generation budget 超过 model length；让 coalesced duplex timeline 越过尚未执行的 frame；replay 时重采样、推进 unconditional stream，或从别的 request 复用 code tensor。
- [NVC-1f] 禁止：每个 frame 对全部历史音频重新 featurize；把 trimmed window 的 local column 当作 stream origin；或因 mid-stream reset / fused prefill 判错令整个 engine core 失败。
