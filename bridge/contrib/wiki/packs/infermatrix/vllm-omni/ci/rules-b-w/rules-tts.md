---
name: rules-tts
description: TTS CI 规则 OMNI-CI-1d、3g、3f：Qwen3-TTS Base 的 dummy-ready 与 real-weight merge coverage 分离、perf/CI case 的 task 与 checkpoint 变体（Base/CustomVoice/VoiceDesign）成对绑定、speaker-embedding 测试不钉死 max_new_tokens 以保留 miss-EOS retry
metadata:
  scope: 只收 Qwen3-TTS 相关的 CI 收集、perf 配对与测试 retry 规则；Whisper 转写设备选择归 rules-whisper-transcription，Qwen3-TTS 模型自身规则（Q3TTS-4b 等）归 qwen3-tts 模型目录，AMD Qwen3-TTS argv 归 rules-amd
---
# TTS CI 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/rules-tts.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-Omni TTS CI 规则；type: rule；tags: vllm-omni, ci；created: 2026-09-05；updated: 2026-09-08
- 来源（sources）：PR #6861；.buildkite/cuda/test-merge.yml；.buildkite/cuda/test-ready.yml；.buildkite/amd/test-amd-merge.yml；tests/e2e/online_serving/test_qwen3_tts_base.py；PR #7054；PR #6924
- 置信度（confidence）：high
- [OMNI-CI-1d] Qwen3-TTS Base 的 dummy-ready oracle 与 real-weight merge coverage 必须分离
  - 触发：修改 Qwen3-TTS Base/CustomVoice 的 CUDA/AMD ready 或 merge step、marker、run level、source dependencies。
  - 强制：Base online 保留 `advanced_model`，但移除 `core_model`；CUDA Ready 不收集 Base step。CUDA merge 仍收集 Base offline+online real-weight pair，AMD merge 也保留相同 pair。新增 serving dependencies 只扩大 CUDA merge 的 Base/CustomVoice 与 CUDA Ready 的 CustomVoice；不得外推为 AMD dependency 变更。
  - 验收：Ready `core_model` collect-only 对 Base 为空；CUDA/AMD merge marker matrix 仍含 Base offline+online；source-file mutation 分别验证上述 CUDA scope。^[PR #6861] ^[issue #6855]
- [OMNI-CI-3g] Qwen3-TTS perf/CI case 必须把 task 与 checkpoint 变体成对绑定
  - 触发：修改 Qwen3-TTS benchmark registry、DFX perf JSON、nightly/merge TTS workload，或新增 `voice_clone` / `default_voice` / `voice_design` case。
  - 强制：每个 task 必须绑定与之匹配的 checkpoint 变体并在 server params 中显式启动该变体：`Base` 只服务 `voice_clone`，`CustomVoice` 只服务 `default_voice`，`VoiceDesign` 只服务 `voice_design`。切换 task 时必须重启到匹配 checkpoint；仅改 benchmark request body 或 `--model` 字段而不换 server，不构成有效 coverage。
  - 强制：registry/README/CI JSON 三处必须同步声明支持矩阵，防止 validation 已收紧后仍把旧 task 发到错误 checkpoint，令 suite 以 HTTP 400 失败。
  - 验收：至少一条实际 perf/CI 配置分别覆盖 Base、CustomVoice、VoiceDesign 的目标 task，并证明错误配对会在 serving validation 提前失败；通过结果只绑定所配对的那个 checkpoint-task workload。^[PR #7054]
- [OMNI-CI-3f] Qwen3-TTS Base speaker-embedding 测试不得钉死 `max_new_tokens`
  - 触发：修改 `test_qwen3_tts_speaker_embedding`、Base dummy/x-vector embedding E2E，或依赖 serving miss-EOS retry 的 TTS CI。
  - 强制：非流式请求省略 `max_new_tokens`，以便 serving 在 miss-EOS 时丢弃不完整生成并按 [[qwen3-tts-rules-1]]、[[qwen3-tts-rules-2]]、[[qwen3-tts-rules-3]]（Q3TTS-4b） 重试一次。raw PCM streaming 无法在 serving 内重试时，测试层可对 codec-EOS HTTP 500 或 `RemoteProtocolError` 整请求最多再试一次；无关 500 不得重试。
  - 验收：CPU 单测覆盖 EOS-miss 重试、无关 500 不重试、`extra_retries=0` 上抛；GPU real-weight 路径在省略 max 的非流式与带一次 client retry 的 streaming 上通过。^[PR #6924]

## 决策与踩坑

- [OMNI-CI-1d] 禁止：用 Ready dummy-weight 绿灯证明 Base real-weight/EOS 行为，或把 pending merge job 写成已证明通过。
- [OMNI-CI-3g] 禁止：沿用“相邻变体应该也能跑”的历史假设；把 one checkpoint covers all 三种 task 写进 perf smoke；或只改文档不改实际 perf case。
- [OMNI-CI-3f] 禁止：为“加快测试”固定 `max_new_tokens` 从而关掉 serving retry；把测试层成功重试写成 miss-EOS 已不是 failure；或对任意 500 盲目重试。
