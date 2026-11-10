---
name: ming-omni-tts-overview
description: "Ming-Omni-TTS 目录入口：ming_tts 注册 key、dense ming_tts.yaml 与 MoE ming_tts_moe.yaml 两份 deploy、主实现与 stage input processor 与 speech adapter 的路径、文本到音频的 LLM、CFM/DiT solver、Audio VAE 流程、CUDA Graph 须复刻 eager 的 float32 solver、MING-4a 的 ISTFT FP32 operands 提示（PR #4341）"
metadata:
  scope: 只收 Ming-Omni-TTS 的名称、源码路径、变体与流程概述；MING-* 规则归 ming-omni-tts-rules，另一家族 Ming-flash-omni 归 ming-flash-omni-overview
---
# Ming-Omni-TTS

## 现状

### 名称、源码与变体

- 模型族：Ming-Omni-TTS；仓库目录/注册 key 使用 `ming_tts`，部署包含 dense `deploy/ming_tts.yaml` 与 MoE `deploy/ming_tts_moe.yaml`。
- 主实现：`vllm_omni/model_executor/models/ming_tts/`；stage input processor 在 `model_executor/stage_input_processors/ming_tts.py`，speech serving adapter 在 `entrypoints/openai/tts_adapters/ming_tts.py`。
- 共享 owner：[[model-executor-overview]]（Model Executor） 和 [[serving-overview]]（Serving）。

### 从文本到音频

- LLM/conditioning 产生 latent condition，CFM/DiT solver 运行 ODE/SDE 采样，Audio VAE 把 latent 解码为 waveform。CUDA Graph 路径必须复刻 eager solver 的 float32 状态、CFG 边界与最后一步更新；dense 模型不应因为 MoE-only 依赖的顶层 import 而不可导入。
- 描述直达源码与具体不变量见 [[ming-omni-tts-rules]]（rules；源锚点 #direct-代码快速入口）；共享优化路径门禁见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）。

### 什么时候查这里

- 审查 Ming-TTS dense/MoE、CFM CUDA Graph、solver dtype、CFG 或 Audio VAE 输出。
- 通用公开 speech 参数与 streaming 错误转到 [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（Serving rules）。
- ISTFT FP32 operands → complex64：MING-4a；沿本目录 rules 审查入口核对。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ming-omni-tts/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, model-executor；created: 2026-07-20；updated: 2026-10-06
- 来源（sources）：PR #4341；vllm_omni/model_executor/models/ming_tts/
- 置信度（confidence）：high
