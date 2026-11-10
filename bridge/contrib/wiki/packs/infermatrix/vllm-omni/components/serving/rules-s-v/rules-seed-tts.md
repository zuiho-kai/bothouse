---
name: rules-seed-tts
description: "规则 VLLM-OMNI-PR9284-SEEDTTS-VERBATIM：SEED_TTS_DEFAULT_OMNI_SYSTEM_PROMPT 须令模型把 user 消息逐字朗读而非回答（nightly #17816 旧提示 mean WER 0.224804 / 0.267329，逐字提示 0.028078），_MAX_SEED_TTS_MEAN_WER 收紧为 0.03，新增 test_qwen3_omni_seed_tts_reads_questions_verbatim，docs/cli/bench/serve.md 说明 ref_audio 不等于声音克隆（PR #9284）"
metadata:
  scope: 只收 Seed-TTS 基准默认系统提示、WER 门槛与逐字朗读回归这一条规则；speech 输出采样率与异常映射（SERV-9b–9d）归 rules-speech-output
---
# vLLM-Omni Serving：Seed-TTS 基准与准确率规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-seed-tts.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-10-23；updated: 2026-10-23
- 来源（sources）：PR #9284
- [VLLM-OMNI-PR9284-SEEDTTS-VERBATIM] Seed-TTS 默认系统提示须令模型逐字朗读：问题/指令是待读文本，WER 门槛收紧至 0.03 并配文本级回归
  - 触发：改动 `vllm_omni/benchmarks/data_modules/seed_tts_dataset.py` 中的 `SEED_TTS_DEFAULT_OMNI_SYSTEM_PROMPT`，或 `tests/e2e/accuracy/qwen3_omni/test_qwen3_omni.py` 中 Seed-TTS 门槛常量（`_MAX_SEED_TTS_MEAN_WER` 等）与逐字朗读回归测试，或 `docs/cli/bench/serve.md` 的 "Seed-TTS reference speech as real audio input" 小节。
  - 强制：默认系统提示保留 Qwen 身份前缀，并明确要求把整条 user 消息当作待朗读文本逐字读出：问题与指令是要说的内容而非要回答或执行的任务，文本响应必须与 user 消息完全一致，不加引言、解释、回答或其他词语，不改写、翻译或续写；保留 `--seed-tts-system-prompt` 覆盖入口。
    - 依据 PR #9284：旧提示未区分"读问题"与"答问题"，nightly build #17816 中 1088 条英文 mean WER 0.224804（中位数 0）仍通过旧 0.35 门槛，`I feel sick, what should I do?` 被答成 67 秒建议音频；同 1088 条目标上旧提示 mean WER 0.267329（74 条 WER>1），逐字提示 0.028078（0 条 WER>1），据此 `_MAX_SEED_TTS_MEAN_WER` 收紧为 0.03，数据集目标与全音频 WER 计算保持不变。
    - 新增 `test_qwen3_omni_seed_tts_reads_questions_verbatim`：以默认提示直连 chat completions（temperature 0、max_tokens 128、仅 text 模态），断言 `finish_reason == "stop"` 且 `message.content == target`，参数化覆盖 nightly #17816 的两条已知失败目标。文档须说明：发送 `ref_audio`/`ref_text` 字段不等于声音克隆——克隆需要模型与端点支持这些字段，对 Qwen3-Omni chat 不生效；
    - `--seed-tts-wer-save-items` 用于排查内容错误时在结果 JSON 保留每条目标、ASR 转写与 WER（准确率 CI 不启用逐项保存）；WER 的对比对象是数据集目标而非模型生成的回复。
  - 验收：`SEED_TTS_DEFAULT_OMNI_SYSTEM_PROMPT` 含逐字朗读与不回答/不执行的语义；`test_qwen3_omni_seed_tts_reads_questions_verbatim` 及 `tests/e2e/accuracy/qwen3_omni/` 目标测试通过；`_MAX_SEED_TTS_MEAN_WER == 0.03`；`docs/cli/bench/serve.md` 记录默认提示、覆盖旗标、`--seed-tts-wer-save-items` 与 WER 对比语义。^[PR #9284]

## 决策与踩坑

- [VLLM-OMNI-PR9284-SEEDTTS-VERBATIM] 禁止：把默认提示改回仅描述 TTS/voice-clone 角色而不要求逐字输出、使模型重新回答或执行目标文本的措辞；删除 Qwen 身份前缀或 `--seed-tts-system-prompt` 覆盖；在未换提示、未在同数据集复测的情况下放宽 `_MAX_SEED_TTS_MEAN_WER`；删除或弱化逐字朗读回归（例如只断言 finish_reason 而不比对内容）；在文档中声称向 Qwen3-Omni chat 发送参考字段即可获得声音克隆，或把 WER 描述为与模型回复对比。
