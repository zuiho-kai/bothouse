---
name: rules-rainfusion
description: "MiniMax H3 RainFusion：MMH3-1d 只在 Ascend NPU + MindIE-SD 上对已验证的 video span 稀疏，VideoTokenLayout 的 legacy 与 Ref2VA multi-span 合同、rf_v2 调用门槛、dense fallback、end_step 与 precision 取值、验收与证据边界（PR #5706、#6000、#6518）"
metadata:
  scope: 只收 RainFusion 稀疏 attention 一条规则；TRTLLM 与 NPU mask-free packed attention 归 minimax-h3-rules-2，NPU 部署数字归 rules-deployment-2
---
# MiniMax H3 RainFusion 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-rainfusion.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #5706；PR #6000；PR #6037；PR #6518；vllm_omni/diffusion/attention/backends/abstract.py；docs/user_guide/diffusion/attention_backends/rainfusion.md；vllm_omni/diffusion/attention/backends/rainfusion_attn.py；vllm_omni/diffusion/data.py；vllm_omni/diffusion/forward_context.py
  - vllm_omni/diffusion/models/minimax_h3/denoise_loop.py；vllm_omni/diffusion/models/minimax_h3/packed_sequence.py；vllm_omni/diffusion/models/minimax_h3/pipeline_minimax_h3.py；tests/diffusion/attention/test_attention_config.py；tests/diffusion/attention/test_rainfusion_plan.py
  - tests/diffusion/models/minimax_h3/test_minimax_h3_packing.py
- 置信度（confidence）：high
- [MMH3-1d] RainFusion 只在已验证的 H3 video span 上稀疏
  - 触发：修改 `RAINFUSION_ATTN`、`block_sparse`、packed video geometry、attention layout、denoise step/layer skip 或 NPU backend resolution。
  - 强制：显式选择时所有平台在构造模型前检查 backend platform/dependency；RainFusion 仅支持 Ascend NPU、要求 MindIE-SD，且不兼容 Ring（用 Ulysses）。H3 attention 显式声明 BSND。`VideoTokenLayout` 有两种 typed、tensor-free producer contract：legacy `(prefix_len, latent_grid)` 必须证明单个 video 是 packed document 0 的 tail；
    - Ref2VA 则发布 `used_len` 和每个 physical `VideoTokenSpan(start, latent_grid, role)`，其中 role 是 `reference|target`。H3 packer 只发布实际 video grid，不把 image/audio/padding 放进 span；denoise setup 一次性把 producer 的 plain values 转成 typed spans，禁止每层/每 step 从 device tensor 取标量。
  - 强制：只有 sparsity>0、step>=start_step、非 skip layer 且 video>=32×128 rows 时调用 `rf_v2`；prefix/text/reference/audio 保持 dense。无 layout、无 `max_seqlen_q`、长度不闭合、短序列或未声明 layout 仍走 NPU Flash dense fallback。
    - multi-span 必须 `used_len==max_seqlen_q`、正的三维 grid、按 start non-overlap/in-bounds、恰有一个 target，所有 video rows 合计达到 32×128；并且 non-contiguous clips 之间的 dense context 足以隔离每个 preceding clip 的 128-token tail block。任一失败保持 dense，不能合并或猜测 spans。
    - video rows 不被 128 整除时也传给 updated MindIE-SD，由它将 irregular real-video suffix 纳入 always-kept 段；vLLM 不 padding。shared planner 和 dependency 边界见 DIFF-1h。
  - 强制：`end_step` 使 denoise 形成 dense→sparse→dense：当 `end_step>0` 且 `step_idx >= total_steps-end_step` 时保持 dense；`end_step=0` 不启用 tail fallback。serial 与处于同一 progress point 的 homogeneous batch 必须发布 `(step, sigma, total_steps)`，请求结束后清空三者。heterogeneous batch 发布 `(None,None,None)`；
    - 目标实现没有单独用缺失 progress 阻断 sparse plan，因而不能把该状态宣称为已证明的 dense fallback。`precision` 只接受 `bf16|fp8|mix`，默认 `bf16`；non-BF16 只有在 MindIE-SD `sparse_attention` 的显式 signature 含 `precision` 时才可启用，不能信任会吞掉未知 kwargs 的旧实现。^[PR #6037]
  - 验收：CPU plan tests 覆盖 aligned/irregular 均进 sparse plan、tail closure、min length、layout 和 skip/step；NPU 条件数值测试以 `sparsity=0` 直接调用 kernel 对 dense reference，mean relative error 阈值为 `2e-3`；它不证明 `sparsity=0.8` 质量 parity。
    - PR #6518 的 CPU tests 覆盖 Ref2VA multi-span plan/packing 与旧 MindIE-SD startup rejection，但 review 没有同 seed 的 Ref2VA sparse(0.8) 对 dense NPU quality comparison。PR body 所报 800I A2 单次 1.62×（1958.81→1208.90 s）和 A2/A3/A5 “verified” 没有可审计的环境、raw artifact、repeats 或质量阈值，不能作为通用硬件/性能结论。
    - MindIE-SD 也只 feature-gate `video_spans` signature，未 pin version/commit。^[PR #5706] ^[PR #6000] ^[PR #6518]

## 决策与踩坑

- [MMH3-1d] 禁止：把 nominal sparsity 当 realized sparsity 或质量保证；未声明 layout 时不能让 sparse path 假设 BSND 而 dense fallback 解释成 BNSD。INT8、RainFusion、no-AllGather DLO 可组合，但 online quantization 不得与 DLO+AllGather 组合；本 PR 没有证明 HSDP 或其他 quantizer 的组合语义。
