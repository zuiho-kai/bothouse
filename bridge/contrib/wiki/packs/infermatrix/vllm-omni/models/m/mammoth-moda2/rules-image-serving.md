---
name: rules-image-serving
description: "MammothModa2 规则 MAMMO-SERV-1a：image 生成 admission 通过 is_image_generation_stage 与 final_output 识别、不绑定唯一 stage type，T2I 的 AR envelope 与 grid 预算 ar_height*(ar_width+1)+1、legacy LLM image stage 一请求一图（PR #7293）"
metadata:
  scope: 只收 image serving admission 与 decoded output 这一条规则；AR vocabulary 归 mammoth-moda2-rules，step runtime 归 rules-step-runtime，TeaCache 归 rules-cache-kernels
---
# MammothModa2 image serving 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/mammoth-moda2/rules-image-serving.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, serving；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7293
- 置信度（confidence）：high
- [MAMMO-SERV-1a] image 能力、AR envelope 与 decoded output 不得绑定唯一 stage type
  - 触发：修改 image-route admission、Mammoth multistage model resolution、T2I prompt/sampling 或 image output extraction。
  - 强制：image-generation admission 通过共享 `is_image_generation_stage` 识别 classical diffusion，或声明 `final_output=true` 且 `final_output_type=image/images` 的 final stage；优先读取 diffusion od_config model class，缺失时从 image-output stage 的 wrapper arch 解析。
    - T2I builder 按 resolved model class dispatch，在没有 reference images/bot_task/system-prompt override 的普通 T2I 路径生成 AR envelope；grid budget 为 `ar_height*(ar_width+1)+1`，与 offline 共用 helper。声明的 extra-body args、seed 和 dimensions 进入正确 stage；legacy LLM image stage 一请求一图、拒绝 `n>1`。
    - 结果优先取 images，否则使用 shared extractor 从 completion multimodal payload 取图。
  - 验收：legacy generation-LLM 与 diffusion topology 均覆盖 online image generation、wrapper model-class fallback、AR grid预算、extra args 和 completion image extraction；保留不支持 edit/multiple-image 的明确错误。^[PR #7293]

## 决策与踩坑

- [MAMMO-SERV-1a] 禁止：仅因不是 diffusion stage 就返回 503，或迁移为 diffusion stage 后跳过仍必需的 AR prompt builder；丢弃允许的 request model extras；把 image-generation capability check 扩大成 img2img 支持（image edit 仍按 classical diffusion gate）。
