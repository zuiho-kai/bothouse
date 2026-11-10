---
name: rules-codec-output
description: "Qwen3-TTS 规则 Q3TTS-6a：Code2Wav multimodal output 的 codec tokens 在根 client output registry 声明 CONCAT_DIM0，零有效帧返回 long [0,q]，只导出当前 request 有效 rows（async chunk 取当前块起始，非 async 去掉 left context，PR #8619）"
metadata:
  scope: 只收 Q3TTS-6a 一条规则；Prompt projection batching 归 rules-prompt-preprocess，async 分块与 decoder state 规则 Q3TTS-3a 至 3e 归 qwen3-tts-rules-2
---
# Qwen3-TTS codec tokens 输出合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen3-tts/rules-codec-output.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #8619
- 置信度（confidence）：high
- [Q3TTS-6a] codec tokens 按请求有效帧导出并沿注册 key 合并
  - 触发：修改 Qwen3-TTS Code2Wav multimodal output 或 codec token 客户端消费。
  - 强制：codec token key 在根 client output registry 声明 CONCAT_DIM0；零有效帧返回 long 类型 [0,q]，有效 codes 只取当前 request 的 valid rows 并转成 frames×q。async chunk 从当前块起始取，非 async 去掉已用 left context；顺序与对应音频块一致。
  - 验收：覆盖 empty、valid-row selection、async/non-async context、分块累计顺序和不同请求隔离；客户端按注册 CONCAT_DIM0 合并后与完整 codes 对照。 ^[PR #8619]

## 决策与踩坑

- [Q3TTS-6a] 禁止：把 padding/其他请求的 code 行或重复 left context 导出；只改模型输出而漏 registry，或将 shape 合同扩大成已完成端到端 transcript/音频验收。
