---
name: minimax-h3-rules-3
description: MiniMax H3 规则（下）：MMH3-1h packed RoPE table 预构造与 TeaCache 复用、MMH3-1i 与 MMH3-1k Qwen3-VL 编码器 NPU RoPE/GQA/AddRMSNorm、MMH3-1j strict Ulysses 局部 embedding 与 projection-before-gather、MMH3-1m modulation 融合的操作顺序与精度、MMH3-4a NPU 文本 MLP packed SwiGLU、MMH3-4b DiT packed SwiGLU 本地 activation
metadata:
  scope: 只收 MMH3-1h、1i、1k、1j、1m、4a、4b；路由表归 minimax-h3-rules-1，MMH3-1b、1c、1e、1g 归 minimax-h3-rules-2
---
# MiniMax H3 规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 3/3 部分；第 1 部分 [[minimax-h3-rules-1]]；第 2 部分 [[minimax-h3-rules-2]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-09-09
- [MMH3-1h] H3 必须预构造 packed RoPE table 并让缓存提取器复用
  - 触发：修改 MiniMax H3 的 `MiniMaxH3Rope`、`MiniMaxH3Attention`、SP prepare、TeaCache extractor 或 q/k fused 调用。
  - 强制：H3 先将 `MiniMaxH3Rope` 的 tiled frequency 输出交给 `_build_rope_table`，只从其前半段构造 cos/sin 并生成 BF16 packed table；该 table 必须在完整 packed sequence 上构造一次，经 `sp_prepare` 原样传给所有 DiT blocks 和 attention，TeaCache extractor 复用同一 helper。`rope_table=None` 的 token-refiner 路径继续只做 q/k RMSNorm；
    - H3 的 128 维 head 只旋转前 96 维并保留后 32 维。共享算子边界以 [[diffusion-rules-2]]（DIFF-1l；源锚点 #diff-1l-fused-qk-rmsnorm-与-packed-rope-必须共享布局并保留-eager-fallback） 为准。
  - 验收：模型合同测试须断言完整 sequence 的 table shape 与 `[cos, sin]` 数值、SP 透传 identity、DiT q/k 的 96/128 partial rotation 和 32 维 tail preservation，并覆盖 TeaCache extractor 与 `rope_table=None` 分支。当前 PR 新增的仅是独立 fused-kernel BF16 测试，没有 H3 集成或 TeaCache 数值回归，因此不能据此宣称模型端到端 parity。^[PR #5990]
    - 在 NPU，BF16 packed table 必须 request-/SP-rank-local，且 shape、width、device、dtype 与本 rank span 一致；不能重建 model-global table 或把复用写成通用性能保证。^[PR #6410]
- [MMH3-1i] Qwen3-VL 文本编码器 NPU RoPE 必须保持 BNSD 与逐样本 M-RoPE
  - 触发：修改 MiniMax H3 Qwen3-VL text encoder 在 Ascend NPU 上的 `_apply_rotary_pos_emb`、`npu_rotary_mul_with_bsnd_fallback`、BNSD/BSND layout 或逐样本 M-RoPE。
  - 强制：q/k 保持 BNSD `[batch, heads, seq, head_dim]`，`cos/sin` 保持逐样本 `[batch, seq, dim]` 并通过 `unsqueeze_dim=1` 对齐；优先使用 CANN 支持的 BNSD fused path，仅在不支持的 BNSD tiling shape 下回退 BSND，同时保留每个样本的 M-RoPE 频率，不改 MiniMax H3 DiT 的 `RotaryEmbedding` 路径。
  - 验收：NPU correctness tests 覆盖 BNSD fast shapes、BSND fallback shapes 和不同样本的真实 M-RoPE positions，分别以 NeoX reference 核对 q/k 输出并断言样本频率确实不同；另从平台注册入口验证生产 consumer 已启用 fused path。^[PR #6061]
- [MMH3-1k] Qwen3-VL encoder 的 NPU GQA 与 AddRMSNorm 只改变目标平台合同
  - 触发：修改 Qwen3-VL text encoder 的 `_scaled_dot_product_attention`、post-attention residual、NPU MiniMax-H3 patch 或 `RMSNorm` 的 optional residual 参数。
  - 强制：通用 encoder helper 保持 causal SDPA 的 reference 语义：当本地 Q heads 多于 K/V heads 时先沿 head 维 repeat-interleave K/V；NPU patch 才保留压缩 BNSD `[B,Q,S,D]` / `[B,KV,S,D]` 输入并调用 `F.scaled_dot_product_attention(..., dropout_p=0.0, is_causal=True, enable_gqa=Q != KV)`。
    - 进入该 NPU op 前必须拒绝 K/V head 数不等、零 KV head 和不能整除的 Q:KV 比率。patch 与已有 RoPE/SwiGLU patch 独立且幂等，并仅在 NPU diffusion runtime 已建立、pipeline 尚未加载时注册到此 encoder helper。
  - 强制：shared `RMSNorm(x, residual)` 的语义为先计算 `updated_residual = residual + x`，再以该值 norm，返回 `(normalized, updated_residual)`；MiniMax-H3 decoder 必须将此 updated residual 用于后续 MLP residual add。仅 NPU residual 分支调用 `torch_npu.npu_add_rms_norm`；
    - CUDA、HIP、MUSA 和 XPU residual 分支保留 native equivalent，不能由这个补丁推断其他平台获得 fused AddNorm。
  - 验收：CPU contract 覆盖通用 expanded-K/V fallback 与 decoder residual order；NPU 覆盖独立/幂等生产 patch、valid/invalid head shapes，以及真实 BF16 causal GQA 相对 expanded-K/V reference（PR fixture：`B=1,Q=8,KV=2,S=16,D=128`，`atol=rtol=2e-2`）。还应保留 native NPU op 的目标硬件数值测试；
    - mock 仅可证明 parameters and registration wiring。^[PR #6040]
- [MMH3-1j] strict Ulysses 必须保持局部 embedding 与 projection-before-gather 的边界
  - 触发：修改 MiniMax-H3 的 strict Ulysses、`_embed()`、packed RoPE、`local_sp_prepare`、DiT final projection 或 `sp_gather` 边界。
  - 强制：只有共享 strict-Ulysses gate 通过时，按 rank 的 packed span 先筛选 image/audio latent rows；token refiner 仍处理完整 text context 后再筛选 text rows；构造局部 embedding 与对应局部 RoPE rows，使用 `local_sp_prepare` 运行 blocks。局部 transformer 输出必须先执行 final projection，再拼接 video/audio logits 并 gather compact FP32 rows；
    - 恢复后按 architecture output width 拆分并执行原有 target/condition row selection。其余路径保留完整 embedding、RoPE、`sp_prepare`、hidden gather 后 projection 的旧顺序。
  - 强制：TeaCache 的 strict-SP 路径保持 modulation input、hidden state、residual 与 cache decision 为 rank-local；以 SP MAX reduction 同步是否 compute，cache-forced rank 必须重置累计 L1 state，compact projected logits 只 gather 一次。非 strict/global 路径仍保留一次 hidden-state gather。^[PR #6410]
  - 验收：模型合同测试须证明各 rank 的局部 multimodal rows 拼接等于完整 embedding、RoPE 行数与 span 对齐、所有 fallback 恢复旧路径，并断言 projection-before-gather 的 payload width 与最终 logits/target/condition rows 等价；性能和 video/audio quality 只能在固定 PR workload、硬件、steps、seed 与 gate 下复核，不能外推到其他 task 或拓扑。 ^[PR #6173]
- [MMH3-1m] H3 modulation 融合必须保持操作顺序、精度与平台回退
  - 触发：修改 MiniMax H3 的 AdaLN scale/shift、gated residual、`norm1`/`norm2` 融合、最终输出调制、Triton modulation wrapper 或 TeaCache extractor 的对应调用。
  - 强制：保持 H3 的操作顺序：`norm1` 后执行 indexed scale/shift，attention 后执行 gated residual 并紧接 `norm2` 与第二组 indexed affine，最终层继续在投影前调制；CUDA Triton 路径先以 FP32 计算 `residual + gate * branch`，必须立即经 BF16 再转回 FP32，并以同一个已舍入值写入 `residual_out` 和执行 RMSNorm；该 round trip 必须留在寄存器，不能增加全局内存中间量。
    - CPU fallback 必须保留旧的两步数值边界，即 RMSNorm 结果先转换为输入 dtype，再执行 affine；所有路径都必须按 `combined_indices` 逐行选择同一 shift、scale 和 gate。
  - 验收：H3 contract test 以 eager 公式分别核对 `norm1` 调制、gated residual+`norm2` 调制和 final-layer 调制，覆盖 index reorder、空行、输出 dtype 与 CPU 两步 fallback；新增 CUDA+Triton fixed-seed BF16 regression 必须以 `torch.equal` 断言 fused `modulated_out` 等于从返回的 `residual_out` 重算的 `rms_norm_indexed_scale_shift`。
    - NPU 测试必须确认使用 `RMSNorm.forward_npu`/`torch_npu.npu_rms_norm` 而非 Triton；B300 video A/B 仅作手工有界复现，PR head 的 Buildkite vllm-omni build #14512 已失败，不能替代此 CUDA contract test。^[PR #6281] ^[PR #6878]
- [MMH3-4a] H3 Qwen3-VL NPU 文本 MLP 必须使用 packed gate/up 与融合 SwiGLU
  - 触发：修改 MiniMax H3 Qwen3-VL text encoder 的 MLP、`gate_up_proj` packing、NPU fused operator 或对应 platform override。
  - 强制：NPU 路径调用一次 `self.gate_up_proj(x)`（或等价模块 `__call__`）生成 packed gate/up，再调用 `torch_npu.npu_swiglu(gate_up, dim=-1)`，最后复用既有 `down_proj`；模块调用保留 linear 层的量化 dispatch（online INT8 的 `quant_method.apply`），gate/up 顺序和结果须等价于 `F.silu(gate) * up`，且补丁只作用于 NPU 目标 text MLP，CPU/CUDA 保持原路径。
  - 验收：NPU 测试以多个 packed shape 对照 split projection reference，并从真实 diffusion runner 初始化入口断言目标 `MiniMaxH3Qwen3VLTextMLP.forward` 已替换且重复初始化幂等；NPU regression 另断言 `gate_up_proj` 以模块被调用且 packed 输出进入融合 SwiGLU，全局 `--quantization int8` 的 H3 生成路径不得再出现 `DT_INT8`/`aclnnMatmul` matB 失败；
    - 未通过生产入口的 helper 数值测试不能作为 hook 生效证据。^[PR #6167] ^[PR #6876]
- [MMH3-4b] H3 DiT 的 packed SwiGLU 必须通过本地 activation 接入
  - 触发：修改 MiniMax H3 `MiniMaxH3MLP`、`fc1` packed gate/up 输出或 DiT activation 实现。
  - 强制：`MiniMaxH3MLP` 必须把 `fc1` 的 packed 输出按 `[gate, up]` 顺序直接交给本地 `SiluAndMul`，再将结果交给既有 `fc2`；模型接入遵循 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（DIFF-1v） 的平台与精度合同，且只改变 H3 DiT，不改变 Qwen3-VL text encoder 的独立 MLP 路径。
  - 验收：H3 contract test 用 packed sentinel 验证 gate/up 顺序、半维输出及 `fc2` 输入，并分别覆盖 CUDA fused 与 NPU/XPU/native fallback；固定 checkpoint、seed、steps 和输入对照 native/fused 输出并设数值容差，同时以 kernel/profile 证据确认优化路径确实生效。^[PR #6283]

## 决策与踩坑

- [MMH3-1h] 禁止：把 H3 已复制的第二个 frequency half 当成独立 sin 输入，向 fused API 传 raw `rope_freqs`，或在每个 block、SP 分支和 TeaCache extractor 内重建不同 table；也不能把 token-refiner 的无 RoPE 路径误接到 fused table 调用。
- [MMH3-1i] 禁止：把 batch-specific frequency 广播、展平或转置成单样本语义；绕过共享 helper 直接调用 NPU 算子而失去 fallback；用 helper 直测代替生产 platform hook 验证，或把该 text-encoder 优化外推到其他 H3 RoPE 路径和平台。
- [MMH3-1k] 禁止：把 NPU compressed-GQA patch 提升为 shared diffusion Attention/backend policy、改变 DiT attention 或其他 encoder，或用 NPU mock wiring 宣称真实 kernel parity。不得把 PR 的单次 A3 eight-card FL2VA observation（one warmup；249028.120→248662.942 ms）写成跨 workload、checkpoint、topology 或平台的性能保证。
- [MMH3-1j] 禁止：在局部路径 gather `[S, 5376]` BF16 hidden state；绕过 `sp_input---local_sp_prepare` hook；只截取 text embedding 而不先运行完整 refiner；修改 Ulysses Q/K/V all-to-all、attention backend、packed-prefix 或 scheduler 语义；把约 21 倍 gather payload 降低写成端到端性能保证。
- [MMH3-1m] 禁止：交换 residual、RMSNorm、affine 或 MLP 的顺序；让 CUDA RMSNorm 消费未写入 residual 的未舍入 FP32 更新值；为该修复增加全局中间 materialization；让非 CUDA 平台绕过原生 RMSNorm backend；把 CUDA BF16 exact test、B300 手工 video A/B 或一次 CI 结果描述成跨平台 parity、广泛质量恢复或通用性能保证。
- [MMH3-4a] 禁止：`F.linear(x, self.gate_up_proj.weight)` 直接读 weight 绕过量化 dispatch（INT8 `matB` 会落入不支持的普通 matmul）；在 NPU 上切分 packed 权重后发起两次 `F.linear` 或使用未融合的 SiLU 乘法；只直接调用 helper 而不验证生产注册链；把该优化扩展到 H3 DiT 或其他模型。
- [MMH3-4b] 禁止：在已选择 fused 路径后重新 `chunk` 并执行两次 native SiLU/乘法；用通用 vLLM activation 类替代本地 diffusion layer；把当前 NPU native fallback 描述成 H3 NPU fused support，或把一次 H3 性能/精度观察推广到其他 task、平台和拓扑。
