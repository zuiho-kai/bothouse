---
name: rules-duplex-turn-closure
description: "MiniCPM-o duplex turn closure 规则 MCPMO-TURN-1a：turn_eos 后关闭 speech unit 的 LISTEN 不能吞掉最终 Talker handoff，DuplexPolicy 与 plugin/native data-plane 的反向扫描和 llm2tts 终止（PR #8227）"
metadata:
  scope: 只收 MCPMO-TURN-1a 一条规则；native duplex 的会话、Talker 与 profile 规则归 rules-duplex-1 与 rules-duplex-2
---
# MiniCPM-o duplex turn closure 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minicpm-o-4-5/rules-duplex-turn-closure.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8227
- [MCPMO-TURN-1a] turn_eos 后关闭 speech unit 的 LISTEN 不能吞掉最终 Talker handoff
  - 触发：修改 MiniCPM-o DuplexPolicy、plugin decide_output、native data-plane decision 或 llm2tts delta 边界。
  - 强制：最后一枚为 LISTEN 时，从当前 unit 反向扫描，只在遇到上一 LISTEN/chunk_eos/chunk_tts_eos 前已出现 turn_eos 才判为 speech-closure；plugin 和 native data-plane 都保留该 unit 给 Talker。completion、cumulative 与 segment token 视图选择最长可用当前历史，不能只看最后 delta。llm2tts 在 turn_eos 结束 handoff，尾 LISTEN 不进入 TTS；
    - plain LISTEN 和 mid-speech forced LISTEN 继续 direct-response。
  - 验收：policy truth table、previous terminator、delta+cumulative、plugin/native 两条decision、最终speech+turn_end与plain LISTEN分别回归；soft interrupt/response.done 和下一unit hidden-state归属另做真实模型验收。 ^[PR #8227]

## 决策与踩坑

- [MCPMO-TURN-1a] 禁止：把所有 ending-LISTEN unit 直接短路；跨前一 unit 找旧 turn_eos；去掉 LISTEN-terminated 最终speech而丢掉 turn end/own-token hidden rows；把本 native duplex 修复当 MRv2 turn/duplex eligibility 变更。
