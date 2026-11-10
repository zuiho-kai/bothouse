---
name: rules-speech-output
description: "Speech 输出规则：SERV-9b sample_rate 由 adapter capability 限定（Qwen3-TTS 仅 {8000,24000}，streaming 只支持 mono integer downsample，PR #6553）；SERV-9c 稀疏音频非流式累积走 PreparedRequest.output_policy 的 accumulate_nonstreaming（PR #7499）；SERV-9d 非合同异常映射 HTTP 500 InternalServerError（PR #6487）"
metadata:
  scope: 只收 SERV-9b、9c、9d；SERV-9a diffusion admission width 归 rules-engine-lifecycle-2，非流式 speech usage headers（SERV-1j）与 word timestamps（SERV-1f）归 serving-rules-2，voice route 错误构造归 serving-rules-upstream-compat
---
# Speech 输出采样率规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-speech-output.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, serving；created: 2026-09-05；updated: 2026-10-09
- 来源（sources）：PR #6553；docs/serving/speech_api.md；vllm_omni/entrypoints/openai/audio_utils_mixin.py；vllm_omni/entrypoints/openai/protocol/audio.py；vllm_omni/entrypoints/openai/serving_speech.py；vllm_omni/entrypoints/openai/tts_adapters/base.py
  - vllm_omni/entrypoints/openai/tts_adapters/qwen3_tts.py；tests/entrypoints/openai_api/test_audio_format.py；tests/entrypoints/openai_api/test_serving_speech.py；tests/e2e/online_serving/test_qwen3_tts_customvoice_expansion.py；PR #7499；PR #6487
- 置信度（confidence）：high
- [SERV-9b] speech `sample_rate` 必须由 adapter capability 限定
  - 触发：public speech request `sample_rate`、TTS adapter capability、audio encoding 或 streaming output。
  - 强制：protocol 只接受 positive int；是否支持由 adapter capability 决定。Qwen3-TTS 只接受 `{8000,24000}`，omitted 使用 native 24k，其他 adapter 对 supplied value reject。Qwen non-streaming encoding 前 resample；batch default 可被 item override。
    - streaming 只支持 mono integer downsample，保持 persistent filter state、source-rate consistency 与 flush tail，target header/meta 只在 audio 后发出且 first audio 必须有 source sr。
  - 验收：Qwen native/8k、other adapter reject、batch override、streaming chunk continuity/tail/source mismatch/first-audio source-sr failure。CPU/DSP 与单一 expansion fixture 不证明跨硬件音质、TTFB 或带宽收益。^[PR #6553]
- [SERV-9c] 稀疏音频非流式累积必须走 adapter OutputPolicy，不得按模型名分支
  - 触发：新增/修改 TTS adapter 的非流式输出、`OutputPolicy.accumulate_nonstreaming`，或 `serving_speech._generate_audio_bytes` 对 per-step delta 的拼接。
  - 强制：MOSS-TTS-Nano、Gepard 等 `async_chunk=false` 的稀疏音频模型由 adapter 在 `PreparedRequest.output_policy` 声明 `accumulate_nonstreaming`。serving 用 `request_id` 键存 policy，仅非流式路径在准备成功后写入，并在累积器 `pop` 消费；优先使用 FINAL_ONLY 已拼接波形，否则 `torch.cat` delta。streaming 永不读写该表。
  - 验收：adapter 设/不设 flag 的非流式拼接与 sentinel-only final；并发非流式隔离；streaming 路径无 policy 条目。^[PR #7499]
- [SERV-9d] speech 非合同异常必须映射为 HTTP 500 InternalServerError
  - 触发：修改 `OmniOpenAIServingSpeech.create_speech` 的通用异常处理、`create_error_response` 的默认 type/status，或 API server 把 `ErrorResponse` 转成 HTTP。
  - 强制：CUDA OOM、codec/`RuntimeError` 等非请求合同失败必须显式 `err_type="InternalServerError"` 与 `HTTPStatus.INTERNAL_SERVER_ERROR`。`ValueError` 保持既有 HTTP 400 / `BadRequestError`；`EngineGenerateError` / `EngineDeadError` 仍向全局 Omni 异常处理器传播，`TTSGenerationError` 保持独立的 500 路径。
    - API 包装层按 `ErrorInfo.code` / `type` 透传，不得把所有 `ErrorResponse` 压成 400。
  - 验收：CPU mock 分别断言 OOM 与 unexpected `RuntimeError` 得到 500/`InternalServerError`，并参数化覆盖 API 包装对 400 与 500 的透传。^[PR #6487]

## 决策与踩坑

- [SERV-9b] 禁止：upsample、16k/stereo/general adapter support，或据 server-side resampling 声称降低模型生成 latency/cost。
- [SERV-9c] 禁止：在 `serving_speech.py` 增加 Gepard/MOSS 等模型名分支；在可失败步骤前写入 policy 导致泄漏；让并发请求共享可变 policy 槽位。
- [SERV-9d] 禁止：通用 `except` 省略 type/status，从而默认成 400；把 OOM 或内部 codec 失败写成客户端坏请求。
