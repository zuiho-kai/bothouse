---
name: rules-vae-ops
description: "MiniMax H3 VAE：MMH3-4c decoder 的 model-local eager ops 仅在 CUDA+Triton 的 SM90/SM100/SM103 与完整远程模型合同下安装、选择性 FP16 materialization 与 compile/spatial-parallel fallback，MMH3-4d keyframe encode 的 deterministic cuDNN TF32 pin（PR #6607、#7191、#7913）"
metadata:
  scope: 只收 VAE decoder eager ops 与 keyframe encode 的 cuDNN pin；audio VAE 确定性归 rules-audio-vae-determinism，decoder tile 不足 rank 与 residency window 归 rules-deployment-2，encoder cuDNN 状态归 rules-encoder-state
---
# MiniMax H3 VAE eager-ops rules

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-vae-ops.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-05；updated: 2026-10-09
- 来源（sources）：PR #6607；vllm_omni/diffusion/models/minimax_h3/vae.py；vllm_omni/diffusion/models/minimax_h3/ops/README.md；vllm_omni/diffusion/models/minimax_h3/ops/vae/__init__.py；vllm_omni/diffusion/models/minimax_h3/ops/vae/dispatch.py
  - vllm_omni/diffusion/models/minimax_h3/ops/vae/qk_norm_rope.py；vllm_omni/diffusion/models/minimax_h3/ops/vae/scaled_residual.py；tests/diffusion/models/minimax_h3/test_minimax_h3_vae_ops.py；PR #7191；PR #7913
- 置信度（confidence）：high
- [MMH3-4c] H3 VAE eager ops 必须以完整远程模型合同和 reference fallback 安装
  - 触发：修改 `MiniMaxH3VideoVAE`、其 model-local `ops/vae/` dispatch、decoder block patch、FP16 materialization 或 VAE exactness tests。
  - 强制：只在 CUDA+Triton、非 HIP、Omni CUDA platform available 且 compute capability 精确为 SM90、SM100 或 SM103 时，从 flat operator-set table 选一个完整实现；其他 capability 保持 reference。
    - 安装前必须验证 official remote decoder 的 block/linear shapes、RMSNorm/FP32 QK-norm semantics、gated SiLU FF、scale tensor、non-compiled FF state 和 spatial-parallel flag；不匹配不改变模块。安装只能一次，并且只将 transformer-block 的 `to_qkv`、`to_out`、`w1`、`w2` FP32 weights materialize 为 FP16；
    - keyframe encode 与 block 外 decoder parameters（包括 `proj_out`）保持 FP32。
  - 强制：融合 Q/K norm+RoPE 和 scaled residual 都是 exact contract：前者只收 CUDA contiguous FP16 Q/K `[B,S,H,64]` 与 contiguous FP16 `[B,S,1,48]` cos/sin，保持 FP32 RMS reduction 和显式 FP16 multiply/add rounding；后者只收 contiguous FP32 residual、FP16 branch、FP32 scale，hidden width 2048，并禁止 FMA contraction。
    - 任一 shape/dtype/device/layout/gradient guard 不满足必须返回 `None`，由原 operation 执行。
  - 验收：CPU/mock contract tests 覆盖 all-target dispatch、unsupported untouched、remote-structure rejection、idempotence、selective FP16 and FP16 SwiGLU path、compile/SP/original-forward fallback；target GPU 另以 direct Q/K、residual 与 complete decoded tensor 的 `torch.equal` 对 reference 验 exactness。
    - 性能报告必须绑定 exact device/software/workload，不能代替持续 CI gate。^[PR #6607]
- [MMH3-4d] GPU keyframe VAE encode 必须 pin 并恢复 deterministic cuDNN TF32
  - 触发：修改 `MiniMaxH3VideoVAE.encode_image`、keyframe encode 的 cuDNN/TF32 设置，或该路径与后续 denoiser 的数值敏感边界。
  - 强制：仅在 CUDA 设备上进入 scoped context：`cudnn.enabled=True`、`benchmark=False`、`deterministic=True`、`allow_tf32=False`（CUDA capability major=9/Hopper），其他 CUDA capability 或查询未知时 `True`；成功与异常退出都必须恢复调用方原 backend 状态。非 CUDA 设备 no-op。该 pin 只包裹 keyframe encode，不改变非 keyframe 路径或 accuracy 阈值。
  - 验收：CPU/mock 覆盖 Hopper、其他/未知 capability，enter/exit 四标志 pin 与 restore、encode 成功与失败路径都离开 context；真实 GPU accuracy gate 另绑定固定拓扑与 workload，不得用本 context 单测代替。^[PR #7191] ^[PR #7913]

## 决策与踩坑

- [MMH3-4c] 禁止：在 `torch.compile` 或 spatial-parallel attention 使用 patch；把 model-local kernel 提升为 shared operator proof，或由 SM90/SM103 exactness/latency evidence外推 SM100、其他 GPU、task、tile/parallel topology 或 E2E benchmark。新 backend 应新增 complete operator-set entry 并重做其 platform evidence，不能放宽现有 allowlist。
- [MMH3-4d] 禁止：依赖进程 ambient cuDNN algorithm 选择；把 pin 做成进程级永久开关；把单次卡组差异描述成已证明的跨 SKU/driver 完全确定性。
