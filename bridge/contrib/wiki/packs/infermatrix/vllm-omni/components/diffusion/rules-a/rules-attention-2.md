---
name: rules-attention-2
description: Diffusion attention 规则（2/3）DIFF-1m、DIFF-1h、DIFF-1k、DIFF-4v、DIFF-1n：TRTLLM PackedPaddingMetadata、Skip-Softmax lambda 与 SAGE 的 SP/schedule 合同，RainFusion rf_v2 irregular tail 由 MindIE-SD 保护，非等长 SP attention 保留 K/V mask 走 SDPA，FLASH_ATTN masked varlen 按 role 选择 unpad，cuDNN 单 token 的 auto MATH workaround
metadata:
  scope: 只收 DIFF-1m、DIFF-1h、DIFF-1k、DIFF-4v、DIFF-1n；CUDA backend 选择、FastH3 VSA、deterministic flag 与 NPU packed mask-free 归 rules-attention-1，DIFF-1z 及其后归 rules-attention-3
---
# Diffusion attention 规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules-attention.md` 的第 2/3 部分；第 1 部分 [[rules-attention-1]]；第 3 部分 [[rules-attention-3]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-attention.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-09-22
- [DIFF-1m] TRTLLM packed-padding、Skip-Softmax 与 SAGE 必须保留 producer、SP 和 schedule 合同
  - 触发：修改 `PackedPaddingMetadata`、TRTLLM packed `cu_seqlens`、`supports_packed_mask_free`、padded-output restore、SAGE/Skip-Softmax gate、calibration 或 multi-document varlen capability。
  - 强制：`PackedPaddingMetadata` 只表示 single physical batch producer-owned `[real,pad]`：Q/KV host lengths 是 Python int、在 flattened bounds 内并与 max lengths/可选 `valid_kv_length` 相等；canonical two-element `int32` cu_seqlens 与 Q/K 同 device。该 path trim Q/K/V、zero-restore output，且不读 `attn_mask`；
    - generic complete cu_seqlens 仍是 genuine multi-document ragged varlen，paired trailing empty document 删除，二者不可混用。
  - 强制：TRTLLM 仅在无 SP 或 pure Ulysses 运行；Ring+`skip_softmax` 报错、Ring 的 `quant` 不使用，AllGather-KV 拒绝。SAGE 和 Skip-Softmax 都须显式 opt-in。`threshold` 与 `target_sparsity` 互斥：kernel `lambda = threshold_scale_factor / max_kv_len`；direct path 的 factor 是 `threshold * max_kv_len`，故 `lambda = threshold`；
    - calibrated path 是 `threshold_scale_factor = a * exp(b * target_sparsity)`，故 `lambda = a * exp(b * target_sparsity) / max_kv_len`。请求 `target_sparsity` 而无 calibration metadata 必须失败，不得静默变 dense。
  - 强制：Skip-Softmax 的 tile 只有当 tile 内每个 query row 都满足 `exp(tile_max[i] - running_max[i]) < lambda` 时才跳过 Softmax/PV；`QK^T` 仍执行。正的 `disabled_until_timestep` 以已归一化、递减的 `t` gate：`t > cutoff` dense、`t <= cutoff` 才可 skip；`0` 关闭 gate，缺 `t` 时保持 dense。
    - MiniMax-H3 默认 flow shift `s=12` 的 `t = s*u / (1 + (s - 1)*u)`，50 sigma points/49 denoiser forwards 下 cutoff `.99`/`.97`/`.95` 分别留下 6/14/19 个 dense forwards；这些 counts 只属于该 schedule。
  - 验收：覆盖 malformed metadata、trim/zero restore、unequal Q/KV ragged、trailing empty、complete metadata+mask rejection、real-document SAGE minimum；
    - 再覆盖 SP admission、mutually-exclusive controls、missing calibration fail、tile-wide predicate、timestep gate/missing `t` 和 H3 flow-shift cutoff counts。^[PR #6542] ^[PR #6724]
- [DIFF-1h] RainFusion irregular tail 由 MindIE-SD 保护，不能 padding 伪对齐
  - 触发：修改 `RAINFUSION_ATTN`、`rf_v2`、`VideoTokenLayout`、block size、MindIE-SD 依赖或 packed video shape。
  - 强制：legacy resolver 传入真实 `prefix_len`、`latent_shape=[t,h,w]` 和 `used_len=prefix_len+t*h*w`；Ref2VA multi-span resolver 改传 `used_len` 与按 physical start 排序的 `video_spans=[{start, latent_shape}]`，将 interleaved text/image/audio 与 padding 保留 dense。
    - 只裁掉 document-0 后的物理 padding，kernel 输出再补零回 query shape。video rows 不再要求 128 整除；新 MindIE-SD 在空间重排后把不规则的真实 video suffix 提升到 always-kept segment，使余下 video 按 128-row block 稀疏。不能用人工 padding 替代，因为 `rf_v2` 不消费 padding mask，pad key 会污染 softmax。
  - 边界：`sparsity<=0`、未到 `start_step`、skip layer、无/未声明 BSND layout、无 video layout/无 `max_seqlen_q`、`prefix+t*h*w` 不闭合 document 0，或 video 少于 32×128 rows 均保持 FlashAttention dense fallback；显式错 layout、causal 或 Ring>1 仍 fail closed。非 8×8 空间网格的 residual 被 always-kept，因而 realized sparsity 低于 nominal；
    - 潜空间 h/w 为 8 的倍数（输入高宽为 256 的倍数）仍是性能首选。
  - 边界：`end_step>0` 时，forward context 必须同时提供当前 `step_idx` 与 `total_denoise_steps`，并在 `step_idx >= total_denoise_steps-end_step` 的最后窗口回到 dense；默认 `end_step=0`。`precision` 只允许 `bf16|fp8|mix` 且默认 `bf16`；
    - non-BF16 请求必须确认已安装 MindIE-SD 的 `sparse_attention` 显式声明 `precision` 参数，否则 fail fast，不能让 `**kwargs` 静默吞掉配置。
  - 验收：CPU plan 同时接受 128-aligned 与 irregular grid，并保持所有其他 fallback/rejection；真实 Ascend + updated MindIE-SD 用 irregular grid 对 dense reference。目标 NPU test 仅以 `sparsity=0` 证明 protected-tail 几何下全 block 等价，不证明稀疏选择的质量、realized sparsity 或加速。
    - CPU tests 还应覆盖 multi-span 的 used length、geometry/role/overlap/bounds、total threshold 与 clip-boundary dense-context fallback；它们只证明 plan payload。PR #6518 review 的 MindIE-SD `2661f83` field-name/layout check 与 4×B300 FLASH_ATTN regression 都不执行 RainFusion；真实 Ref2VA same-seed sparse quality 仍未覆盖。
    - 另覆盖 `end_step` 边界、zero-tail、precision enum normalization 与旧 MindIE-SD fail-fast；serial/homogeneous producer 必须发布并清理 progress trio。heterogeneous batch 的空 progress trio 在该目标没有独立 dense guard，不能据此声称安全 fallback。^[PR #6000] ^[PR #6518] ^[PR #6037]
- [DIFF-1k] 非等长 SP attention 必须保留 K/V mask 并走 mask-safe backend
  - 触发：模型在 strict Ulysses/SP 中为 self-attention 或 cross-attention 增加 K/V padding mask，且 Q 与 K 的序列长度可能不同。
  - 强制：保留完整逻辑 K/V mask，并以 `[B, 1, 1, K]` 语义传递；masked LTX attention 必须走支持该 mask 的 SDPA fallback，unmasked 请求才保留 native backend，不能修改通用 Ulysses 的 mask 语义来适配单一模型。
  - 验收：CPU/mock 覆盖 masked self-attention、masked unequal-length cross-attention 与 unmasked path，分别断言 SDPA/native dispatch 和 mask shape；真实 SP 再以带 padding 的 LTX 输出对照未分片参考。^[PR #5500]
- [DIFF-4v] FLASH_ATTN masked varlen packing 必须由 attention role 选择
  - 触发：修改 diffusion `FLASH_ATTN` 的 masked-varlen unpad/pad 路径、`Attention` role 传递，或给 cross-attention 增加二维 key-padding mask。
  - 强制：只有 self-attention 才可用同一 2D mask unpad Q/K/V；构造参数精确为 `role="cross"` 时 mask 只 unpad K/V，Q 保持 dense，并按每个 batch 的完整 query length 构造 `cu_seqlens_q`，输出直接 reshape 回 `[B, Q, ...]`。该提交没有扩展 namespaced `role_category="cross"` caller；
    - LTX strict-SP 的 SDPA fallback 仍由 [[rules-attention-2]]（DIFF-1k；源锚点 #diff-1k-非等长-sp-attention-必须保留-kv-mask-并走-mask-safe-backend） 约束。
  - 验收：CPU/mock 覆盖 self 与 `role="cross"` 的 masked varlen routing（包括 Q/K 等长），精确断言 cross 的 dense Q offsets 与 K/V offsets；GPU 将不同 batch valid-K lengths 的 cross output 与 SDPA 对照。^[PR #5866]
- [DIFF-1n] cuDNN 单 token 仅限 auto MATH workaround
  - 触发：修改 cuDNN dispatch 或动态 Q/K 长度。auto 的 Q/K=1 可在 cuDNN 前走 `SDPBackend.MATH`；显式 `CUDNN_ATTN` 必须拒绝该形状，不能静默换 backend。覆盖 `(1,1)`、`(8,1)`、`(1,8)`、`(8,8)` 的 explicit/auto dispatch、compile 和 mask。^[PR #6070] ^[PR #5543]

## 决策与踩坑

- [DIFF-1m] 禁止：接受 nonempty TRTLLM `attn_mask`、把 shortcut 用作 arbitrary mask/multi-request layout，或把 tail document 短于 `k_block_size` 的 dense fallback 当作 real-document SAGE gate 完成。不得将本 docs-only PR #6724 外推为 runtime、数值、质量或性能证明。
- [DIFF-1h] 禁止：只因 `mindiesd` 可 import 就断言 irregular-tail 或 multi-span 合同可用；availability 必须在模型构造前检查 `sparse_attention` 明确接受 `video_spans`，否则以可操作的 upgrade/FLASH_ATTN error fail closed，不能成功启动后在 T2VA/FL2VA/Ref2VA dispatch 才 TypeError，也不能静默尝试 legacy signature。
  - 该 feature check 不是版本 pin，仍不能据此推断任意 MindIE-SD build 的 kernel quality。
- [DIFF-1k] 禁止：因为 cross-attention 的 Q/K 长度不同就丢弃 mask；把只匹配 query 长度的二维 mask 交给 Flash varlen；把 backend 的 `supports_attention_mask` 能力等同于支持任意 mask layout。
- [DIFF-4v] 禁止：以 `Q == K` 推断 self-attention，或把 key-mask indices 用于 query gather/scatter；这会丢弃 query rows，且在 batch 大于一时可能令 query 对齐到另一样本的 K/V。
