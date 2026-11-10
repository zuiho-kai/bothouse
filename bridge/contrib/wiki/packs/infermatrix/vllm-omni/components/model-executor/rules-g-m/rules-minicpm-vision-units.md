---
name: rules-minicpm-vision-units
description: "MiniCPM duplex vision-only unit 规则 VLLM-OMNI-PR8971-MINICPM-VISION-UNITS（PR #8971）：MiniCPM-o 4.5 duplex 的无音频视频帧是独立 VISION 单元（allow_emit、_vision_queue、_QueuedVisionHold、manual commit 按 wire order 排空 held prefix），Stage 0 对 vision-only unit 跳过 audio encoder，scheduler 只预留实际构建的 token（空 audio 不回落 64-token 预算），rollback 分离恢复 VISION prefix 与 audio unit 帧"
metadata:
  scope: 只收 MiniCPM-o 4.5 duplex 的 unit capability、vision-only append 与 unit scheduler token 预算一条规则 VLLM-OMNI-PR8971-MINICPM-VISION-UNITS；turn-end drain 与 EOS 判定归 rules-minicpmo-turn-end-drain
---
# MiniCPM duplex vision-only unit rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-minicpm-vision-units.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-20；updated: 2026-10-20
- 来源（sources）：PR #8971
- [VLLM-OMNI-PR8971-MINICPM-VISION-UNITS] 无音频视频帧必须是独立 VISION 单元且 scheduler 预算只含实际构建的 token
  - 触发：MiniCPM-o 4.5 duplex 修改 unit capability（AUDIO/VISION/OMNI）、空 PCM 帧的 unit 归类、预留与排放（含 `allow_emit`、`_vision_queue`/`_QueuedVisionHold`）、vision-only append、audio encoder 的 first-chunk 窗口、unit scheduler token 预算，或 manual commit 下 buffered VISION prefix 的排空与 rollback。
  - 强制：capability 中音频与视频各自可选。空 PCM 的 frame group 不等待 partial microphone chunk，也不给 audio buffer 合成静音 padding；其形态取决于 emission 是否被允许——emission 允许时立即预留为完整 VISION unit，`allow_emit=False` 时该帧留在 `_vision_queue`，返回的 `_QueuedVisionHold` 不携带 unit payload，之后允许 emission 的 `prepare_append` 取出该帧才完成 unit 构建；
    - manual commit 也按 wire order 以 `force_listen=True` 把 queued VISION prefix 作为 listen-only append 排空，commit 需等待活跃 response 时先 hold 这些 prefix、response 结束后仍按 wire order 在 retained terminal payload 之前提交；commit 上禁用 response creation 时，后续显式 `response.create` 必须先排空 held prefix 再提交 terminal payload。
    - Stage 0 对 vision-only unit 跳过 audio encoder，该 unit 使用独立 chunk index、不消耗 audio first-chunk 窗口，且可以从该 unit 开启 response。随真实或静音音频提交的帧仍走 OMNI speech gate，不得借 camera frame 重开已结束的 turn。
    - scheduler 只预留 Stage 0 实际构建的 token：首次 append 为 session context，其后为上一 terminator + `</unit>`，再接 `<unit>` 与 frame blocks；空的 `audio` 字段不得回落到默认 64-token audio 预算。rollback 必须把独立 VISION prefix 与属于 audio unit 的帧分开恢复。
  - 验收：覆盖 mute/video-only 提交、audio+frame 仍过 speech gate、先行 VISION unit 不影响后续首 audio chunk 编码、空 `audio` 不再保留 surplus `</unit>` pad embedding 的预算断言、`allow_emit=False` 下 frame-only append 留在 `_vision_queue` 且返回的 hold 无 unit payload、
    - 其后允许 emission 的 `prepare_append` 与 manual commit 两条取出路径均按 wire order 排空，以及 rollback 对独立 VISION prefix 与 audio unit 帧的分离恢复。^[PR #8971]

## 决策与踩坑

- [VLLM-OMNI-PR8971-MINICPM-VISION-UNITS] 禁止：把无音频帧塞进带合成静音的 audio/OMNI unit；把 `allow_emit=False` 下仍在 `_vision_queue` 的帧描述成已构建或已提交的 unit；把取出/排空义务只归给 commit——后续允许 emission 的 `prepare_append` 同样能取出该帧；让先行 VISION unit 占用或污染首 audio chunk 语义；
  - 用 `</unit>` pad embedding 填充 surplus slot 留在 KV 中（空 `audio` 回落 64-token 预算曾遗留约 61 个）；在 terminal commit payload 之前丢弃或合并 buffered VISION prefix；对 vision-only 路径复用 audio gate 判定 listen/speak。
