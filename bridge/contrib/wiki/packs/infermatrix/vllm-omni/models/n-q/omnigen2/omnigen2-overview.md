---
name: omnigen2-overview
description: OmniGen2（指令驱动图像生成/编辑）目录入口：OmniGen2Pipeline 的 diffusion registry 登记与前后处理函数、pipeline_omnigen2.py 与 omnigen2_transformer.py、文件内 vendored FlowMatchEulerDiscreteScheduler、Qwen2.5-VL 编码与参考图校验、CFG-parallel、审查入口
metadata:
  scope: 本模型只有这一页，收名称、registry、源码文件与结构要点；没有独立规则页或架构页，无 deploy YAML
---
# OmniGen2

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页,尚无本模型的运行经验沉淀）。

### 名称与范围

- 正式名称 OmniGen2,无别名、无变体有据,无 deploy YAML/checkpoint 映射记录。diffusion registry: `OmniGen2Pipeline` →（`omnigen2`, `pipeline_omnigen2`）, pre `get_omnigen2_pre_process_func` + post `get_omnigen2_post_process_func`。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 源码：`pipeline_omnigen2.py`（55 KB）+ `omnigen2_transformer.py`（50 KB,`OmniGen2Transformer2DModel` + `OmniGen2RotaryPosEmbed`）。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）。

### 结构与要点

- **文件内 vendored `FlowMatchEulerDiscreteScheduler` 重实现**（`pipeline_omnigen2.py:66`,自带 `step()` 的 SchedulerMixin+ConfigMixin）——不是 diffusers import;涉及 scheduler 的修改需单独评审这份 vendored 实现。
- prompt 编码 `Qwen2_5_VLForConditionalGeneration` + `Qwen2_5_VLProcessor`; 自定义 `OmniGen2ImageProcessor(VaeImageProcessor)`（line 326）;参考图输入经 `is_valid_image_imagelist` 校验;CFG-parallel。

### 什么时候查这里

- 审查 omnigen2 的 vendored scheduler、参考图输入或编码链改动。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/omnigen2/_index.md`（InferMatrixCopilot@ecfb84d0）；title: OmniGen2（指令驱动图像生成/编辑）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/omnigen2/；vllm_omni/diffusion/registry.py
