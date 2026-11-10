---
name: diffusion-architecture
description: Diffusion 共享架构：vllm_omni/diffusion/ 负责与不负责的边界、当前子模块布局（executor、worker、sched、models、model_loader、cache、offloader、quantization、profiler、attention 等，main @ 238fc0a6 复核）、三步调查顺序，以及执行身份与 checkpoint 身份分开追踪（DIFF-1aa）
metadata:
  scope: 只收共享 diffusion 执行框架的职责边界、子模块布局与调查顺序；页面路由归 diffusion-overview，step 与 batching 模式归 step-and-batching，并行策略归 parallelism
---
# Diffusion 共享架构

## 现状

### 负责什么

- `vllm_omni/diffusion/` 承载 diffusion stage 的共享执行框架。它负责接收上游准备好的条件和 diffusion 配置，运行模型 pipeline 与 denoise 过程，并把生成结果交给后处理或下一阶段。

### 不负责什么

- 模型专有 transformer、tokenizer、VAE wrapper 和 checkpoint 兼容细节由对应模型目录说明。
- 请求字段怎样从 HTTP/CLI 进入系统由 serving 模块负责。
- AR/LLM stage 怎样产生跨阶段输入由 model-executor 负责。

### 当前子模块布局（main @ 238fc0a6 复核；此前亦在 dev/vllm-align @ 4f2b32c 验证，结果一致）

- 执行链相关：`executor/`（执行循环）、`worker/`（diffusion worker）、`sched/`（stage 内调度）、`models/`（共享模型实现）、`model_loader/`；显存与性能相关：`cache/`、`offloader/`、`quantization/`、`profiler/`；能力扩展：`attention/`、`layers/`、`lora/`、`hooks/`、`distributed/`、`postprocess/`、`utils/`。

### 调查顺序

1. 先确认问题是否同时影响多个 diffusion 模型。
2. 沿配置、runner、pipeline、denoise loop 和输出逐层查证。
3. 如果最终只在一个模型的 pipeline 或 checkpoint 上复现，把正文放回模型目录，并从这里链接。
- 执行身份与 checkpoint 身份必须分开追踪：custom pipeline、Diffusers adapter 与 native pipeline 决定实际 executor 和 hook；checkpoint `model_class_name` 则继续提供 modality/capability metadata。不要因 `diffusion_load_format=diffusers` 就覆盖 native metadata 或绕过 custom-pipeline precedence；
  - 具体审查合同见 [[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（DIFF-1aa）。
- 源码会变化，具体类名和路径在改代码前必须以目标仓库当前版本为准。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, components, diffusion；created: 2026-07-10；updated: 2026-09-05
- 来源（sources）：vllm_omni/diffusion/；PR #6749
