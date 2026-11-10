---
name: ltx2-architecture
description: "LTX-2/2.3/2.5 架构与证据索引（v0.26.0 @ a4ea67a2 复核）：纯 diffusion 的 22B transformer 加 text encoder、VAE、vocoder，serving 入口与 pipeline 变体、LTX-2.5 DiffVAE 与 ConvVAE、BWE vocoder 的 FP32 parity、latent_upsampler CPU 初始化、官方相似度阈值与保留矩阵（PR #6342、PR #6847）"
metadata:
  scope: 只收 LTX-2 家族的结构、serving 入口、音频 parity 与初始化合同及既有证据链接；DiffVAE 与 transport 等硬门禁归 ltx2-rules，别名与目录路由归 ltx2-overview
---
# LTX-2/2.3/2.5 模型架构与证据索引

## 现状

- 以下事实在 `v0.26.0 @ a4ea67a2` 复核（合并后的 recipe 与 live registry）。

### 结构与 serving

- 纯 diffusion（无 AR stage）：22B transformer + text encoder + VAE + vocoder；T2V 与 I2V 皆可，输出带 48kHz 同步音频。验证建议从 96GB 级 GPU 起步（recipe 原文）。
- serving 入口（LTX-2.3）：`vllm serve diffusers/LTX-2.3-Diffusers --omni --stage-init-timeout 600`；统一 `LTX2Pipeline` 由 checkpoint metadata 选择 LTX-2 或 LTX-2.3 profile。
- pipeline 变体：ordinary one-/two-stage 分别使用 `LTX2Pipeline`/`LTX2TwoStagePipeline`；distilled one-/two-stage 分别使用 `LTX2DistilledOneStagePipeline`/`LTX2DistilledTwoStagePipeline`，其中 legacy `LTX2DistilledPipeline` 是后者 alias。
  - 两个 explicit distilled class 的 serving metadata 都解析到 canonical `LTX2DistilledPipeline` video metadata，避免 final stage 静默回落为 image；DMD2 使用 `LTX2T2VDMD2Pipeline`/`LTX2I2VDMD2Pipeline`。T2V/I2V 通过是否提供 `image=` 选择，不再使用单独的 `*ImageToVideoPipeline` registry names。
  - PR #6847 仅以 CPU metadata capability test 覆盖 explicit two-stage 的 video 分类，不证明 `/v1/videos`、真实模型 load、recipe 执行或 output formatter 的 E2E 行为。
- LTX-2.5 的 video decode 将 canonical Native checkpoint 中的 decoder tensors 转换到 Diffusers-compatible DiffVAE；full 与 distilled 的 one-/two-stage profile 默认将其作为额外 video decoder component。ConvVAE 保留给 I2V encoding，也可由 startup-only `ltx2_use_conv_vae=true` 显式选择作视频 decoder；
  - 具体 fail-closed 约束见 [[ltx2-rules]]（LTX-2.5 decoder rules）。
- Python `forward` 只允许 `req` 作为 positional argument，其他参数必须 keyword-only；这对直接调用者和显式 `--model-class-name` 覆盖是 breaking change，CLI/HTTP recipe 已按 named fields 调用。
- 单段 diffusion 模型不在 `OMNI_PIPELINES` registry（走 `async_omni_engine.py` 的默认 diffusion stage 兜底），deploy 语义见 [[configuration-architecture]]（Config 组件）。

### 音频 parity 与初始化合同

- 自 `main @ d3c990dc` 起，带 `bwe_generator` 的 LTX BWE vocoder 在 CUDA 路径使用 FP32 输入及 FP32 autocast 执行长卷积栈，随后将波形转换回 decode 输入 dtype；不带该属性的基础 vocoder 保持原生调用。MPS 路径临时将 BWE 模块转为 FP32，并在调用后恢复原参数 dtype。合并代码以真实 CUDA BF16 `Conv1d` 回归验证中间输出为 FP32，但关于 CUDA FP32-autocast 可移植性的 P1 thread 在合并时仍未 resolve；
  - 该证据不得外推到未验证 backend。
- `latent_upsampler` 必须在显式 CPU device context 中构造、再加载权重；这是 rational-resampler 的 Long-tensor 初始化合同，避免 CUDA default-device 下不支持的 Long `addmm`，不改变已加载权重的 dtype 或运行时 placement。
- 官方相似度守卫对保留的 LTX-2.0/2.3/2.5 case 使用同一 profile：video SSIM mean/min ≥0.99、PSNR mean ≥40 dB、audio relative-L2 ≤0.10、audio cosine ≥0.99。该 profile 是精度回归门，而不是跨 checkpoint、硬件或配置的泛化质量声明。Omni runner 必须通过 symlink overlay 暴露已经解析并 pin 的 upsampler/LoRA sidecar，防止两侧比较不同 artifact。
- retained matrix 直接保留 LTX-2.5 Full one-stage，并以 LTX-2.0/2.3 two-stage 的 Stage 1 覆盖相应 denoising path；它删除了 LTX-2.0/2.3 的 direct one-stage case。关于这是否遗漏 `(one_stage, version)` recipe/profile dispatch 的 P2 thread 在获批合并时仍未 resolve，因此不得把 retained matrix 描述成对这两个版本 one-stage entry 的直接覆盖。^[PR #6342]

### 已有证据索引（只链接，不复制正文）

- 性能/profiling 陷阱：eager-trace 与 graph-benchmark 口径混同、mask-sync"优化" 改变精度——见 [[benchmark-incidents-overview]]（benchmark incidents #19/#20）。
- L4 基线与远端验证长跑教训（半冷测量偏置、babysit 走偏）——见 [[performance-validation-overview]]（remote performance-validation incidents）（030/031 两篇）。
- review 视角案例（PR #4381 的 reviewer-lens 教训）——见 reviewer-lens-cases（源链接 `../../../../general/review/guides/reviewer-lens-cases.md`）。
- checkpoint 布局差异（LTX-2 vs LTX-2.3）曾是 model-adaptation 审查的实例——见 [[model-adaptation-guardrails-1]]、[[model-adaptation-guardrails-2]]（model-adaptation-guardrails）。
- 相关 PR：#4381、#4464（graph/profiling 与性能对比线索）。
- 源码会变化，具体类名和行号在改代码前必须以目标仓库当前版本为准。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ltx2/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, ltx2；created: 2026-07-16；updated: 2026-09-05
- 来源（sources）：recipes/LTX/LTX-2.md；recipes/LTX/LTX-2.5.md；vllm_omni/diffusion/registry.py；#4381；#4464；PR #6189；PR #6342；PR #6847；vllm_omni/diffusion/models/ltx2/ltx2_components.py；vllm_omni/diffusion/models/ltx2/ltx2_diffusion_decoder.py
  - vllm_omni/diffusion/models/ltx2/ltx2_diffusion_decoder_distributed.py；vllm_omni/diffusion/models/ltx2/ltx2_runtime.py；tests/diffusion/models/ltx2/test_ltx2_vae.py；tests/diffusion/models/ltx2/test_ltx2_vocoder_cuda.py；tests/e2e/accuracy/ltx/test_ltx25_official_similarity.py
  - tests/e2e/accuracy/ltx/test_ltx_official_similarity.py
