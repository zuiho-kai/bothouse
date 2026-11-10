---
name: boogu-image-overview
description: Boogu Image 目录入口：owner models/boogu-image 对应上游 boogu_image 目录与 registry key BooguImagePipeline，源码 5 个文件、依赖的 diffusion 共享模块清单、上游无 deploy 预设（pipeline 自述为 Boogu-Image-0.1 的 native port）、什么时候查与不放什么、指向 Boogu rules 的路由
metadata:
  scope: 只收 Boogu Image 的名称、源码路径、共享依赖和目录路由；revision、RoPE、Edit CFG、request batching、Turbo DMD 与 TorchAO FP8 的规则归 boogu-image-rules，registry 快照归 models-catalog
---
# Boogu Image

## 现状

### 正式名称与别名

- 知识树 owner：`models/boogu-image`；上游目录 `boogu_image`。
- registry 登记的 architecture / stage key：`BooguImagePipeline`。

### 源码路径

- 共 5 个文件：
  - `vllm_omni/diffusion/models/boogu_image/`
  - revision/component loader、Edit-Turbo checkpoint boundary：见本页目录中的 Boogu rules。

### 依赖的共享代码模块

- `vllm_omni/diffusion/data/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/attention/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/distributed/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/model_loader/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/models/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/platforms/` → 无对应 component owner
- `vllm_omni/diffusion/request/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/worker/` → [[diffusion-overview]]（diffusion）

### checkpoint、尺寸与量化

- 上游没有 deploy 预设。pipeline 模块自述：Native vLLM-Omni pipeline for Boogu-Image-0.1. Ported from the upstream ``boogu`` package (``boogu/pipelines/boogu/pipeline_boogu.py``) with the following changes: - Diffusers …

### 什么时候查这里

- 只查 Boogu Image 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| revision/component loader、Edit-Turbo checkpoint、real RoPE/platform selection、Edit CFG branch/rank/VAE decode 合同，或 request-level T2I batching、TI2I batch=1 gate、request-major mask/generator/output mapping、Turbo DMD schedule 或 TorchAO FP8 scope | [[boogu-image-rules]]（Boogu rules） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/boogu-image/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-09-05
- 来源（sources）：PR #6701；PR #6571；PR #6786；PR #6968；docs/models/supported_models.md；recipes/Boogu/Boogu-Image.md；vllm_omni/diffusion/models/boogu_image/；vllm_omni/entrypoints/utils.py
- 置信度（confidence）：high
