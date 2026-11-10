---
name: diffusers-adapter-overview
description: Diffusers Adapter（main @ 5d44868e 源码派生页）：DiffusersAdapterPipeline 以接近零 per-model 代码把执行委托给 diffusers DiffusionPipeline.__call__ 的通用黑盒桥，无 pre/post-process 绑定、无 deploy YAML，三个源码文件（pipeline、pipeline_utils 的 IO 胶水、quantization_utils），docstring 明确不支持 CFG-parallel / sequence-parallel / TeaCache / Cache-DiT / step-wise 执行
metadata:
  scope: 只收 Diffusers Adapter 的注册、用途、设计边界和查阅时机；原生适配流程归 adding-a-model，共享 diffusion 实现的入口归 diffusion-overview
---
# Diffusers Adapter

## 现状

- 以下事实在 `main @ 5d44868e` 复核（源码派生页）。

### 名称与范围

- diffusion registry：`DiffusersAdapterPipeline` →（`diffusers_adapter`, `pipeline_diffusers_adapter`）;**无** pre/post-process 绑定。单 stage diffusion,引擎默认 stage 配置（[[configuration-architecture]]（Config 组件））。无 deploy YAML。
- 用途：以接近零 per-model 代码服务任意 HF Diffusers pipeline——执行直接委托 diffusers `DiffusionPipeline.__call__`。
- 无变体有据,无 deploy YAML,树内未 pin checkpoint（黑盒桥按被服务的 diffusers pipeline 决定行为）。
- 源码：`pipeline_diffusers_adapter.py`（25 KB）、`pipeline_utils.py`（`get_pipeline_utils`,按 pipeline 类型做 IO 胶水）、`quantization_utils.py`（把 vLLM 风格量化配置转换/应用到 diffusers 组件）。

### 边界（docstring 明确排除项）

- **不支持** CFG-parallel、sequence-parallel、TeaCache/Cache-DiT、step-wise 执行——评审时不要因这些能力缺失开票,这是设计边界不是缺陷。
- 输出封装按 `pipeline_utils.get_pipeline_utils` 分派;diffusers pipeline 类型→输出封装的完整映射未在 pin 上枚举,断言"某类型不支持"前先读该文件。
- 平台钩子经 `current_omni_platform`。

### 什么时候查这里

- 判断一个 diffusers-only 模型能否先经 adapter 服务再做原生适配;审查 adapter IO 胶水或量化转换改动。
- 原生适配流程见 [[adding-a-model]]（adding-a-model）; 共享实现归属见 [[diffusion-overview]]（Diffusion 组件）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/diffusers-adapter/_index.md`（InferMatrixCopilot@ecfb84d0）；title: Diffusers Adapter（通用 HF Diffusers 黑盒桥）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/diffusers_adapter/；vllm_omni/diffusion/registry.py
