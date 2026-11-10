---
name: rules-prompt-preprocess
description: "Qwen3-TTS 规则 Q3TTS-PROMPT-1a：initial prefill 的非流式 CustomVoice/VoiceDesign prompt projection batching，按 requestID 保存当前 step 切片并在下一 step 消费时 pop，speaker ID/embed cache 按 device+speaker（PR #8477）"
metadata:
  scope: 只收 Q3TTS-PROMPT-1a 一条规则；codec tokens 输出合同 Q3TTS-6a 归 rules-codec-output，ref-audio 与 task/variant 规则 Q3TTS-1a 至 1d 归 qwen3-tts-rules-1
---
# Qwen3-TTS prompt batching 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen3-tts/rules-prompt-preprocess.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8477
- [Q3TTS-PROMPT-1a] Prompt projection batching 必须只消费当前请求的切片
  - 触发：修改preprocess_infos_batch、_project_texts_batch、speakerembeddingcache或build_prompt_embeds。
  - 强制：仅initialprefill的nonstreamingCustomVoice/VoiceDesign批处理；保留Base/显式streaming和unsupportedinputserialfallback。texttemplate3leading/5trailing剥离后拼所有text一次projection，同一pinned H2D准备full/textids；按requestID保存当前step切片，下一step重置并消费时pop。speakerID/embedcache按device+speaker，未知speaker仍拒绝；保留EOS/pad/tail和语言条件。
  - 验收：CustomVoice/VoiceDesign serialvsbatched、不同textlength、reusedID、unconsumedcache、streaming/Base/invalidinput、device/speaker和EOS/tail均覆盖；projection与完整prompt逐元素对照，再独立检验seededPCM和servingcancel/recovery。 ^[PR #8477]

## 决策与踩坑

- [Q3TTS-PROMPT-1a] 禁止：用row/slot代requestID或重用上一步同名请求embedding；把Base默认nonstreaming改成true；为batching改变token/mode/模板；把上游历史H200numbers说成本次验证或忽略NUMA/cold/filteredround边界。
