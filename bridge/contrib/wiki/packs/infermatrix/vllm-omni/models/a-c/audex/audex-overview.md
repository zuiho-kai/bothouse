---
name: audex-overview
description: Nemotron-Labs Audex（2B 与 30B-A3B 共享 audex model-executor 目录）：五个 AR architecture、audex_tts / audex_tta / audex_thinker_only / audex_s2s 四个 pipeline key 与 nemotron_labs_audex alias、四种 pipeline 的 stage 合同（TTS 流式 AudexCode2Wav、S2S 文本与 audio 对齐、TTA 走 AudexXCodec1）、30B 必须显式选 *_30b.yaml 的部署边界、离线 / 在线验证入口
metadata:
  scope: 只收 Audex 的名称注册、四种 pipeline 的 stage 合同、部署边界和验证入口；共享 stage / config / serving 合同归 model-executor-overview、configuration-overview、serving-overview
---
# Nemotron-Labs Audex

## 现状

### 名称、源码与注册

- checkpoints：`nvidia/Nemotron-Labs-Audex-2B` 与 `nvidia/Nemotron-Labs-Audex-30B-A3B`；共享 `audex` model-executor 目录，包含 thinker、codec、decoder、pipeline 和 stage input processor。
- AR registry 新增五个 architecture：`NemotronDenseForCausalLM`、`AudexCode2Wav`、`AudexXCodec1`、`NemotronDenseAudexForConditionalGeneration`、`NemotronHAudexForConditionalGeneration`。
- pipeline registry 提供 `audex_tts`、`audex_tta`、`audex_thinker_only`、`audex_s2s`；repo-root 的 `model_type: nemotron_labs_audex` 是默认 TTS pipeline 的显式 alias，不应误路由到 thinker-only。

### 四种 pipeline 的 stage 合同

- TTS：thinker 逐 chunk 产生 codec frames，经 streaming `AudexCode2Wav` 解码；terminal chunk 带 `stream_finished`，不能把空 codec token 当作 engine failure。
- S2S：text 走 stage 0 的最终文本输出，audio payload 继续送到 `Code2Wav`；两类输出必须按同一 request 对齐，不能把 audio bridge 当成普通文本 completion。
- thinker-only：单 stage audio understanding，不自动追加 speech decoder；TTA 则是 synchronous full-payload 路径，使用完整 RVQ payload 交给外部 `AudexXCodec1` 解码。
- 这些 stage/shape 语义由 `stage_input_processors/audex.py` 和各模式 deploy 共同定义；只通过 registry import 或单一 TTS smoke 不能证明其他三种模式的 handoff。

### 部署边界

- 四种模式各有 2B/30B deploy YAML。TTS、TTA、thinker-only 和 S2S 的入口与输入/输出组合以官方 recipe 为准；共享 16 kHz 流式 decoder 不意味着所有模式都提供 speech output。
- 30B-A3B 必须显式选择对应的 `*_30b.yaml`；不能让 repo-root 自动检测复用 2B 的默认 stage topology。改 deploy 时同时核对 stage 显存预算、Mamba prefix-cache 约束和 decoder 的跨 stage payload。
- Audex 的模型专属事实留在本页和 recipe；共享 stage/config/serving 合同分别归 [[model-executor-overview]]（Model Executor）、[[configuration-overview]]（Configuration） 和 [[serving-overview]]（Serving）。

### 验证入口

- 离线脚本位于 `examples/offline_inference/audex/`，在线客户端和 server launcher 位于 `examples/online_serving/audex/`。审查新模式时至少按目标 mode 绑定对应 deploy、endpoint 和音频输出类型；单独通过 registry import 不能证明 stage handoff 或服务合同。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/audex/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, serving；created: 2026-08-05；updated: 2026-08-05
- 来源（sources）：vllm_omni/model_executor/models/audex/；vllm_omni/config/pipeline_registry.py；vllm_omni/deploy/audex_tts.yaml；vllm_omni/deploy/audex_tts_30b.yaml；recipes/NVIDIA/Nemotron-Labs-Audex.md；examples/offline_inference/audex/；examples/online_serving/audex/
- 置信度（confidence）：high
