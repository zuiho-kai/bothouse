---
name: stable-audio-overview
description: "Stable Audio Open（main @ 5d44868e）目录入口：StableAudioPipeline 在 diffusion registry 的登记（stable_audio / pipeline_stable_audio）、StableAudioDiTModel 与 StableAudioSchedulerWrapper、尾部唯一 cosine DPM-solver 家族、AutoencoderOobleck 与 T5 + StableAudioProjectionModel 时长条件、示例页已删除后的在线发现入口与 test_stable_audio_online_expansion.py 的 HTTP 200 smoke（PR #4807）"
metadata:
  scope: 只收 Stable Audio Open 的 registry、源码、scheduler 与时长条件要点、在线发现与 E2E 覆盖；与 EulerDiscrete 的对照归 sdxl-overview，共享 diffusion 模块归 diffusion-overview，本目录尚无规则页
---
# Stable Audio Open

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页）。

### 名称与范围

- 正式名称 Stable Audio Open(Stability AI),无别名、无变体有据。diffusion registry：`StableAudioPipeline` →（`stable_audio`, `pipeline_stable_audio`, `StableAudioPipeline`）,post `get_stable_audio_post_process_func`。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_stable_audio.py`（24 KB）+ `stable_audio_transformer.py`（`StableAudioDiTModel` + `StableAudioSchedulerWrapper`）。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）。

### 结构与要点

- **尾部唯一 cosine DPM-solver 家族**：`CosineDPMSolverMultistepScheduler` 包在家族内 `StableAudioSchedulerWrapper`（`pipeline_stable_audio.py:167`）——scheduler 抽象改动的另一个反例（对照 [[sdxl-overview]]（sdxl） 的 EulerDiscrete）。
- `AutoencoderOobleck` 音频 VAE;T5 编码器 + `StableAudioProjectionModel` 做 `seconds_start`/`seconds_total` 时长条件;1D rotary 位置嵌入（`get_1d_rotary_pos_embed`）;`SupportAudioOutput`。

### 什么时候查这里

- 审查 stable_audio 的 scheduler wrapper、时长条件或 Oobleck VAE 改动。

### 在线发现与覆盖

- `main @ 72beeaee` 已删除模型专属的 `examples/online_serving/stable_audio/` 和对应 User Guide 示例页；不要从这些旧路径寻找可运行示例。当前可发现的使用入口是上游 `recipes/StabilityAI/Stable-Audio-Open.md` 与 `docs/serving/audio_generate_api.md`；模型目录的 registry 导航仍从 [[models-catalog]]（模型 catalog） 进入。
- 在线 E2E 位于 `tests/e2e/online_serving/test_stable_audio_online_expansion.py`：对 gated `stabilityai/stable-audio-open-1.0` 使用 2 秒、4 steps 的请求，并断言 `/v1/audio/generate` 返回成功 HTTP 200。它是接口可达 smoke，不是音频字节/WAV 完整性验证。^[PR #4807]

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/stable-audio/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Stable Audio Open（T2A,cosine DPM-solver）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-08-25
- 来源（sources）：vllm_omni/diffusion/models/stable_audio/；vllm_omni/diffusion/registry.py；recipes/StabilityAI/Stable-Audio-Open.md；tests/e2e/online_serving/test_stable_audio_online_expansion.py
