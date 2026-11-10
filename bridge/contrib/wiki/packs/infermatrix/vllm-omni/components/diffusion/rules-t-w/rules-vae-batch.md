---
name: rules-vae-batch
description: "Diffusion 规则 DIFF-VAE-BATCH-1a：AutoencoderKL/Flux2 的 batch parallel decode 只沿 batch 轴分配完整图像的连续 chunk，每个 active rank 调 native decoder 后按原 index gather；B1、degree≤1 或 distributed 未初始化时走 native decode（PR #8162）"
metadata:
  scope: 只收 distributed_vae_executor 的 batch VAE decode 这一条规则；WORLD 拓扑门禁 CONF-4g 归 rules-parallel-topology，Wan VAE spatial-shard（DIFF-3b、3c）归 rules-wan-spatial-shard
---
# Batch VAE decode 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-vae-batch.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion, distributed；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8162；vllm_omni/diffusion/distributed/autoencoders/autoencoder_kl.py；vllm_omni/diffusion/distributed/autoencoders/autoencoder_kl_flux2.py；vllm_omni/diffusion/distributed/autoencoders/distributed_vae_executor.py
- [DIFF-VAE-BATCH-1a] 完整图像 chunk 必须保持 native decode 与原 batch 顺序
  - 触发：修改 AutoencoderKL/Flux2 的 batch parallel decode、split/merge 或 VAE factory routing。
  - 强制：配置通过 [[rules-parallel-topology]]（CONF-4g） 的 WORLD 拓扑门禁后，只沿 batch 轴分配完整图像的连续 chunk。每个 active rank 调用 native decoder，按原 index gather 并 broadcast 完整 batch；保留本地 Diffusers slicing/tiling。B1、degree≤1 或 distributed 未初始化时走 native decode；unsupported VAE class 在初始化拒绝。
  - 验收：KL/Flux2 覆盖 B1、uneven batch、idle rank、degree1、未初始化以及 tiling/slicing on/off；所有 rank 输出与 native reference 对齐，dtype、return_dict/tuple、图像顺序和 factory 支持边界不变。^[PR #8162]

## 决策与踩坑

- [DIFF-VAE-BATCH-1a] 禁止：在 callback 中调用已包装的 `self.decode` 造成递归；把独立请求拼成 batch；将 batch mode 禁用空间分布式执行误写为禁用本地 tiling；让 idle rank 解码伪造图像或改变输出顺序。
