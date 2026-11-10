---
name: rules-wan-fastpath
description: "Wan VAE fastpath 规则 DIFF-3d、DIFF-3e：decoder exact level 用 torch.equal、fused FP32 用 atol=1e-5/rtol=1e-4、fused BF16 要求 max error ≤ 0.03125 且 RMS ≤ 0.0078125（PR #8188）；首帧 causal Conv3d 仅在 channels_last、T=1、无历史等条件下换成 Conv2d，性能用 --first-frame-ablation 对照（PR #8179）"
metadata:
  scope: 只收 wan_vae_fastpath 的 decoder 数值预算与首帧 Conv2d 替换条件；Wan VAE spatial-shard 分片边界（DIFF-3b、3c）归 rules-wan-spatial-shard
---
# Wan VAE fastpath 精度与首帧合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-wan-fastpath.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8188；PR #8179；tests/diffusion/distributed/test_wan_decoder_fast_path.py；vllm_omni/diffusion/distributed/autoencoders/wan_vae_fastpath/forwards.py；tests/diffusion/distributed/test_wan_vae_fastpath_kernels.py；benchmarks/diffusion/bench_wan_vae_decode.py
- 置信度（confidence）：high
- 共享入口见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion 规则）；分片边界见 [[rules-wan-spatial-shard]]（Wan spatial-shard）。
- [DIFF-3d] Wan decoder exact 与 fused 的数值预算必须按精度边界分别验证
  - 触发：修改 decoder fastpath 的 exact/fused level、RMSNorm+SiLU cast 边界或 parity assertions。
  - 强制：exact level 保持 `torch.equal`；fused FP32 保持 `atol=1e-5, rtol=1e-4`。fused BF16 在 norm-affine/SiLU 后提前写回 BF16，使用绝对 max error ≤ 四个 BF16 eps（0.03125）和整体 RMS error ≤ 一个 eps（0.0078125），两项必须同时满足。
  - 验收：相同 reference/candidate latents 驱动同 session 的两个 chunk 与 fresh session，分别覆盖 local 和 two-rank sharded decode、FP32/BF16、exact/fused，并检查 cache 从 zero→history→zero。CPU/plumbing 与 exact AMD target case pass 需分开记录，邻近 CI 红/绿不改变本数值合同。^[PR #8188]
- [DIFF-3e] 首帧 Conv2d 只能替换无历史的受支持 channels_last 因果卷积
  - 触发：优化 `wan_vae_fastpath/forwards.py` 的 first-frame causal Conv3d、cache 或 deferred bias。
  - 强制：只在既有 CUDA inference path、`channels_last` opt-in、T=1、无历史 payload、受支持 dtype、kernel `(3,3,3)`/`(3,1,1)`、unit stride/dilation、groups=1、zero native padding 与精确 causal `_padding` 时用 Conv2d。有限输入 `[0,0,x]` 只读取最后 temporal weight slice；每次取当前 weight 并在该次调用 packing，不能缓存 reload/offload 后陈旧的 GPU copy。
  - 强制：cache 更新继续保存未被 autocast 舍入的输入与前导零，后续 T=1 有历史时恢复 Conv3d；channels-last output、deferred bias 的 activation dtype、fallback 与 cache ownership 保持原合同。
  - 验收：GPU 覆盖首帧和 cached 后续帧、None/Rep 起始、dtype/autocast/bias、unsupported fallback 与 weight reload。性能用同 head、同 VAE 的 `--first-frame-ablation` 仅切此 helper，保留实际命中计数、ABBA samples、warmup、packing 成本、峰值和输出差异；单卡首帧/整段 VAE 结果分别报告，不外推完整生成 latency 或其它硬件。^[PR #8179]

## 决策与踩坑

- [DIFF-3d] 禁止：把 fused FP32 称为 bit-identical；只用 near-zero relative tolerance 或只检查平均误差，使极端像素或广泛漂移漏过；将该 tanh-bounded decoder 合同扩展到任意模型/量化质量。
- [DIFF-3e] 禁止：把该实数等价说成 floating-point bit identity；在 lossless、multi-frame、非支持 padding/groups/stride/dilation 或有历史时应用优化；只测试第一帧而漏掉下一帧 cache。
