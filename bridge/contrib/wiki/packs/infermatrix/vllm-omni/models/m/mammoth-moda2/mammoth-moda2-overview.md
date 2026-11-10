---
name: mammoth-moda2-overview
description: "MammothModa2（Preview/Dev，main @ 4245fd69 复核）目录入口：bytedance-research 的 Preview 与 Dev checkpoint（PR #6694）、七个 AR architecture 与 DiT 目录、两 stage 文生图 mammoth_moda2 与单 stage AR-only 的 mammoth_moda2_ar 拓扑和 deploy YAML、维护入口、text_guidance_scale/cfg_range 经 extra_body 进入 DiT 的边界"
metadata:
  scope: 只收 MammothModa2 的名称范围、拓扑、维护入口与明确边界；MAMMO-1a 至 1d 归 mammoth-moda2-rules，step runtime 归 rules-step-runtime，TeaCache 与 QK RoPE 归 rules-cache-kernels，image route 与 AR grid 归 rules-image-serving
---
# MammothModa2

## 现状

- 以下事实在 `main @ 4245fd69` 复核。

### 名称与范围

- Checkpoint：`bytedance-research/MammothModa2-Preview` 与 `bytedance-research/MammothModa2-Dev`。PR #6694 恢复此前移除的家族，但不恢复 AudioX。Preview/Dev 共用 `mammoth_moda2` 实现、tokenizer、typed transformers config、request extras 和 AR→DiT bridge。^[PR #6694]
- AR registry 有七个 architecture，均映射到 `model_executor/models/mammoth_moda2/`：`MammothModa2Qwen2ForCausalLM`、`MammothModa2ARForConditionalGeneration`、`MammothModa2Qwen3ARForConditionalGeneration`、`MammothModa2Qwen3ForCausalLM`、`MammothModa2DiTPipeline`、`MammothModa2ForConditionalGeneration`、
  - `Mammothmoda2Model`。DiT 实现在 `diffusion/models/mammoth_moda2/`；不要把它当成独立 diffusion-registry family。
- `mammoth_moda2` 是两 stage 文生图：stage 0 `LLM_AR` 输出 latent，stage 1 `LLM_GENERATION` 经 `stage_input_processors.mammoth_moda2.ar2dit` 生成 image，默认 deploy 是 `mammoth_moda2.yaml`。`mammoth_moda2_ar` 是单 stage `LLM_AR` 文本输出，用于图像/视频理解和 summarization，默认 deploy 是 `mammoth_moda2_ar.yaml`。

### 维护入口

- prompt、image grid、EOL/visual-token constraints 或 text/image→text：`model_extras/mammothmodal2_preview.py` 与 AR model consumer；
  - 共享 image task envelope 见 [[rules-image-task-envelope]]（Model Executor），模型专属约束见 [[mammoth-moda2-rules]]（MAMMO-1a；源锚点 #mammo-1a-ar-sampling-必须按-task-隔离-text-与-visual-vocabulary）。
- 改 AR→DiT payload：先沿 `ar2dit` 的 `full_hidden_states`、token ids、question/answer boundary 和 dimensions 追到 DiT consumer；跨 stage 传输的一般合同见 [[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（bridge/batch rules），模型专属合同见同页 `MAMMO-1b`。
- 改 stage、default deploy 或 runtime topology：检查两个 `OMNI_PIPELINES` key、两个 YAML 和 [[adding-a-model]]（Config 的 model registration entry）。T2I deploy 的两个 stage 都默认 device `0`，这是 profile 默认值，不是通用硬件或性能承诺。

### 明确边界

- `text_guidance_scale`、`cfg_range`、`num_inference_steps` 经 model extras 的 `extra_body` 进入 DiT；DiT 使用 kwargs 接口，因此不能假定 shared diffusion request 字段会自动透传。
- Preview/Dev 的支持范围以合并后的 upstream docs/registry 为准：Preview 有文生图与 image understanding；Dev 在 supported-model 表只声明 AR-only image understanding。不要从 PR 作者的单张 GPU 示例外推硬件、吞吐、质量或全部任务支持。^[PR #6694]
- T2I None/default 与16-pixel dimension validation：MAMMO-1d；沿本目录 rules 审查入口核对。
- [[rules-step-runtime]]（step execution、request scheduler 与 CFG）
- [[rules-cache-kernels]]（TeaCache joint context 与 fused QK RoPE）
- [[rules-image-serving]]（image route、AR grid 与 legacy image stage）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/mammoth-moda2/_index.md`（InferMatrixCopilot@ecfb84d0）；title: MammothModa2（Preview/Dev 的 AR→DiT 与 AR-only 拓扑）；type: index；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：PR #6694；vllm_omni/model_executor/models/mammoth_moda2/；vllm_omni/diffusion/models/mammoth_moda2/；vllm_omni/model_executor/stage_input_processors/mammoth_moda2.py；vllm_omni/deploy/mammoth_moda2.yaml；vllm_omni/deploy/mammoth_moda2_ar.yaml
