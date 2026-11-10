---
name: rules-minicpmo-turn-end-drain
description: "MiniCPM-o duplex turn-end drain 规则 VLLM-OMNI-PR8911-TURN-END-DRAIN（PR #8911）：MiniCPM-o 4.5 native duplex 的 turn_end_drain 为三态（none / boundary mask / until-silent），仅完句 turn-end 走 until-silent——连续两个 silent codec frame 后放行 EOS、quiet frame 达 _TURN_END_QUIET_STOP_FRAMES 强制 EOS，条件文本用 <text_eos> 关闭；GPU 与 CPU codec state 由同一组 rules 驱动"
metadata:
  scope: 只收 MiniCPM-o 4.5 duplex turn-end condition、drain kind 与 turn-end EOS masking 的一条规则 VLLM-OMNI-PR8911-TURN-END-DRAIN；vision-only unit 与 scheduler token 预算归 rules-minicpm-vision-units
---
# MiniCPM-o duplex turn-end drain 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-minicpmo-turn-end-drain.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, model-executor；created: 2026-10-21；updated: 2026-10-21
- 来源（sources）：PR #8911
- [VLLM-OMNI-PR8911-TURN-END-DRAIN] MiniCPM-o duplex turn-end 必须按句尾选择 drain 策略并以静音帧判定 EOS
  - 触发：修改 MiniCPM-o 4.5 native duplex 的 turn-end condition、`turn_end_drain`、handoff 的 `turn_text_ends_sentence` meta、silent/quiet codec id 集合，或 turn-end EOS masking。
  - 强制：turn-end drain 必须是三态 kind（none / boundary mask / until-silent），不能用布尔；仅当 turn-end unit 交给 Talker 的本轮文本以句末标点（。！？.!?…，忽略收尾引号/括号）结束时才走 until-silent drain：EOS 只在当前 condition 连续两个 silent codec frame 后放行，连续 quiet frame 达到上限（`_TURN_END_QUIET_STOP_FRAMES`）时强制 EOS。
    - 完句 turn-end condition 的文本用 `<text_eos>` 关闭：该 token 插在文本之后、`<audio_bos>` 之前，且 Talker 在 condition 之后还会追加 `_boundary_embeddings()`，因此 `<text_eos>` 只是关闭条件文本，不是整个 prompt 的收束。句子未结束的 turn-end 仍保留 boundary mask，mid-turn condition 的 per-unit 25-frame pacing 不变。
    - GPU codec state 与 CPU 实现必须经由同一组 rules（eos/cadence/boundary/code_classes/silent_frames/quiet_stop_frames）驱动。
  - 验收：覆盖 `_turn_end_drain_kind` 的三态判定（非 turn-end、turn-end 未完句、完句）、trailing code runs 只统计当前 condition、until-silent 下 speech 或单个 silent code 仍 mask EOS、连续两个 silent code 放行、quiet 上限差一帧的强制 EOS 边界，以及 GPU 与 CPU codec state 在 until-silent 下输出一致。^[PR #8911]

## 决策与踩坑

- [VLLM-OMNI-PR8911-TURN-END-DRAIN] 禁止：让上一个 condition 遗留的 silent/quiet codes 计入当前 condition 的静音判定；对句子未完的 turn 无条件 drain 到静音（会跑到 104-token 上限产生编造语音）；改变 mid-turn condition 的 cadence。
