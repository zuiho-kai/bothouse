---
name: krea2-overview
description: "Krea 2 目录入口（PR #4730）：vllm_omni/diffusion/models/krea2/ 的 pipeline_krea2.py 与 krea2_transformer.py、从 model_index.json 与 vae/config.json 取组件配置、text encoder 与 VAE 须统一目标 dtype、config-only 精确取文件、仅 Diffusers layout 可直接加载"
metadata:
  scope: 只收名称范围、配置与 checkpoint 流程和何时查；KREA-1a、KREA-1b、KREA-2a 规则正文归 krea2-rules
---
# Krea 2

## 现状

### 名称与范围

- 模型目录：`vllm_omni/diffusion/models/krea2/`。
- 主要实现：`pipeline_krea2.py`、`krea2_transformer.py`；注册在 `vllm_omni/diffusion/registry.py`。
- 共享依赖：[[diffusion-overview]]（Diffusion component） 的 loader、cache、worker 与 serving bridge。

### 配置、checkpoint 与流程

- Krea 2 pipeline 从 checkpoint 的 `model_index.json` 与 `vae/config.json` 得到组件和 scale 配置，加载 text encoder、VAE、tokenizer、scheduler 与 transformer。text encoder 和 VAE 必须使用统一目标 dtype；只需要 VAE config 时必须精确获取文件，不能下载整套权重。当前 loader 预期可直接加载的 Diffusers layout；raw/upstream checkpoint 是否可用必须单独验证。
- 请求经 text encoder 形成多层 hidden-state stack，进入 transformer denoise，再由 VAE decode 输出图像。描述直达源码与模型专有门禁见 [[krea2-rules]]（rules；源锚点 #direct-代码快速入口）；公开入口矩阵见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model adaptation guardrails）。

### 什么时候查这里

- 审查 Krea 2 loader dtype、config-only fetch、offline/online 或 capability claim。
- 共享 checkpoint/parallel 问题转到 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/krea2/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-20；updated: 2026-07-31
- 来源（sources）：PR #4730；vllm_omni/diffusion/models/krea2/
- 置信度（confidence）：high
