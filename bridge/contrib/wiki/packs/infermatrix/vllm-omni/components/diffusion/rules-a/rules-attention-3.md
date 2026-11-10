---
name: rules-attention-3
description: Diffusion attention 规则（3/3）DIFF-1z、DIFF-7a、DIFF-8a、DIFF-1ah、DIFF-1af、DIFF-1ai3、DIFF-1aj2、DIFF-1ai4、DIFF-1d2：混合 causal/full attention 走共享 Attention、Cosmos3 多控制 transfer attention、CFG 双分支与 TeaCache extractor 参数、equal-rank SP auto-pad、等长 batch mask 省略为 None、显式 Hub FlashAttention、NPU causal mask、Ring valid_kv_length、packed varlen 四字段
metadata:
  scope: 只收 DIFF-1z、DIFF-7a、DIFF-8a、DIFF-1ah、DIFF-1af、DIFF-1ai3、DIFF-1aj2、DIFF-1ai4、DIFF-1d2；DIFF-1ad 至 DIFF-1g 归 rules-attention-1，DIFF-1m 至 DIFF-1n 归 rules-attention-2，dense 4D mask 分流归 rules-4d-mask-routing，SP padding 归 rules-sp-padding
---
# Diffusion attention 规则（3/3）

## 关键事实

- 拆分说明：本页是源页 `rules-attention.md` 的第 3/3 部分；第 1 部分 [[rules-attention-1]]；第 2 部分 [[rules-attention-2]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-attention.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-09-22
- [DIFF-1z] 混合 causal/full attention 必须经过共享 Attention 能力路径
  - 触发：diffusion 模型包含文本 causal 行与 image/timestep full-attention 行的混合序列，或修改 `full_attn_spans`、attention mask 与高分辨率长序列 dispatch。
  - 强制：通过 `vllm_omni.diffusion.attention.layer.Attention` 传递 `AttentionMetadata`；piecewise backend 消费连续的 `full_attn_spans`，不支持时才使用按请求构造并复用的 dense mask，且 mask 形状必须覆盖完整 text+image 序列。strict Ulysses paged path 必须保存/恢复 SP padding 并要求 `query_lens`、`image_mask`、`position_ids`；
    - Ring、AllGather 和 non-strict Ulysses 必须 fail-closed，不能借 paged marker 落入其他 path。^[PR #6563]
  - 验收：CPU/mock 覆盖 contiguous full-span、piecewise path、dense fallback、batch mask shape 与 piecewise/dense 输出一致性；高分辨率请求另验证实际 backend 选择、显存边界和 attention mask 不被重复构造。^[PR #5194]
- [DIFF-7a] 多控制 transfer attention 必须按控制独立计算并显式承担 Ulysses 复制成本
  - 触发：修改 Cosmos3 transformer 的多控制 transfer attention、控制 token packing、控制权重传递或其 Ulysses/sequence-parallel 路径。
  - 强制：多控制 attention 必须为每个 control 独立构造 `[text, control_i, target]` 的 K/V 序列；保留该 control 自己的输出，target 输出按已归一化的 control weights 加权后再拼回控制区与 target 区。control token size 与 weight 数量必须一一对应，所有 control range 必须为正且完整覆盖 packed control 区。
    - 该路径使用 `skip_sequence_parallel=True` 的专用 attention，multi-control 时不得执行 `gen_sp_prepare`/`gen_sp_gather`，以完整的 `[control_i | target]` 序列在每个 Ulysses rank 复制执行，并显式告警其不降低每-rank memory 或 latency；未提供权重时使用均匀相对权重。
  - 验收：CPU/mock 测试用至少两个 control 的不同 value 和非均匀权重断言 target 是加权结果、control 输出来自各自 pass，并覆盖 token-size/weight 长度及非法权重；带 Ulysses 的测试断言专用 attention、复制执行和 warning，真实多卡再与单卡 dense reference 对照并分别测量显存、延迟和输出质量。^[PR #5614]
- [DIFF-8a] CFG 双分支与 TeaCache extractor 必须保持参数合同一致
  - 触发：修改 diffusion transformer 的 `forward` 参数、TeaCache `extract_*_context` hook、CFG 正/负分支 kwargs 或 `guidance_scale > 1` 的执行路径。
  - 强制：以被 hook 的实际 `forward` 签名作为参数合同；extractor 必须兼容真实调用的可选字段，CFG 正负分支必须传递全部 required conditioning kwargs，尤其是 `guidance`，并保持对应 tensor 的语义与形状一致。
  - 验收：TeaCache 启用且 `guidance_scale > 1` 时分别覆盖 LongCat T2I 与 Edit 的正/负分支，断言 extractor 两次均收到 `guidance` 且不抛 `TypeError`；再以固定输入、seed 和 checkpoint 对照无缓存输出。^[PR #6181]
- [DIFF-1ah] equal-rank SP auto-pad 只能在已发布合同下跳过长度 gather
  - 触发：修改 Ulysses/UAA sequence-parallel attention、forward context、auto-pad sharding metadata，或尝试移除每次 attention 的 `_all_gather_int`。
  - 强制：只有 framework-managed SP boundary 明确发布“各 rank local seq_len 相等”的 contract 时，attention 才可跳过长度 all-gather，并直接复用 `query.shape[1]` 作为每个 rank 的 local length；该 fast path 必须保留 `SymInt`，不能 `int(...)` materialize，否则会引入 host sync、graph break 和 shape specialization。
    - 混合 auto-pad/manual shard 时必须按 boundary stack 精确 push/pop，任何一层不保证等长都回到 slow path。
  - 强制：advanced UAA metadata 继续携带真实 `seq_lens` / `local_seq_len` 语义，但 fast path 可用 symbolic equal-length list 构造它们；hybrid Ulysses+Ring 仍保留自身等长检查合同。
  - 验收：覆盖 equal-pad fast path、manual/mixed boundary slow path、boundary pop 只影响自身层级，以及 UAA metadata 仍与各 path 一致；mutation 到 `any(...)` 或错误清空 stack 时测试必须失败。^[PR #5717]
- [DIFF-1af] 等长 batch 的 padding mask 必须省略为 None
  - 触发：diffusion 模型为 joint/image/self-attention 构造 boolean padding mask，或修改共享 `make_attention_mask` / FlashAttention dense-vs-masked 选择。
  - 强制：仅当 `seq_lengths` 存在真实 padding（至少一档短于 `max(seq_lengths)`）时才物化 `(batch, max_len)` bool mask；单样本或全员等长 batch 必须返回 `None`，让 backend 直接走 dense path。all-true CUDA mask 会触发 `torch.any(~mask)` 的 device→host sync，不能当作“无害 no-op”。
  - 验收：等长与单样本断言 helper/`forward` 得到 `None`；可变长断言 mask shape 与 True/False 边界；不得用一次端到端加速数字代替 sync 合同。^[PR #6871]
- [DIFF-1ai3] 显式 Hub FlashAttention 必须在选择时解析构建并失败可见
  - 触发：修改 `FLASH_ATTN_HUB` / `FLASH_ATTN_3_HUB` 选择、`flash_attn_hub._load_hub_module` / `_get_hub_module`、`kernels` pin，或依赖 Hub FA 的 accuracy/serving 路径。
  - 强制：显式 Hub backend 在 platform 返回 path 前必须走与执行相同的 loader：对 `kernels-community/flash-attn2` 或 `flash-attn3` 依次尝试 `get_kernel(..., version=1)` 再 `version=2`；任一命中即缓存。variant miss 或加载失败必须 `RuntimeError`，说明无兼容 torch/CUDA build，并提示 `kernels>=0.16.1`（含 stable-ABI 匹配）或改选其他 backend。
    - `requirements` 与 LTX/NATTEN remediation 文案中的 `kernels` / `transformers` floor 必须与该 loader 所需 companion pin 同步（当前为 `kernels==0.16.1` 与 `transformers>=5.13.0,<5.15`）。
  - 验收：CPU 覆盖 v1 miss→v2 hit 的版本序列、双 Hub backend 的 variant miss 均 raise、显式选择无 silent fallback；真实 torch/CUDA 环境再证明 stable-ABI 或 exact-tag build 可加载。不得用 SDPA 噪声 SSIM 解释 Hub miss。^[PR #7185]
- [DIFF-1aj2] NPU dense FlashAttention 在 `causal=True` 时必须物化因果掩码
  - 触发：修改 `FlashAttentionImpl.forward_fa_npu`、NPU MindIE-SD / `npu_fusion_attention` dense path，或 `self.causal` 语义。
  - 强制：`causal=True` 且无显式 mask 时，必须走 bottom-right 对齐的压缩/物化因果 mask（`Sq!=Skv` 时按 `key_pos <= query_pos + (Skv-Sq)`），不能把 `attn_mask=None` 交给非因果 dense op。显式 keep-mask 须与因果条件组合后 contiguous 下发；`causal=False` 保持原无 mask 行为。
  - 验收：CPU/mock 覆盖 `Sq==Skv`、更短/更长 query、显式 mask 组合与非因果 `None`；目标 NPU 用已知因果模型对照。^[PR #7324]
- [DIFF-1ai4] Ring Attention 的 `valid_kv_length` 是全局前缀，且不得与 causal 并用
  - 触发：修改 Ring Flash/PyTorch attention、`AttentionMetadata.valid_kv_length`、`ring_kv_block_valid_length`，或向 ring forward 传入前缀裁剪语义。
  - 强制：`valid_kv_length` 表示整条全局 K/V 序列的 contiguous 有效前缀（`0 < L <= block_size * world_size`）；每个 circulated block 按全局 `block_rank` 映射为本地 `max(0, min(block_size, L - block_start))`，再 `k/v[:, :local]`。`None` 表示整块有效。本地长度为 0 时跳过该 step 的 FA/LSE 更新，不得对空 K/V 调 kernel。
  - 强制：`causal=True` 且 `valid_kv_length is not None` 必须立即 `ValueError`。裁短 circulated K/V 会缩短 `seqlen_k` 而 query 仍是 padded 长度，FlashAttention causal 对角线 bottom-right 对齐会静默错位；caller 须先 unpad 再进 ring，或使用 `causal=False`。
  - 验收：覆盖全局前缀落在首块/中块/末块、越界/非 int fail-closed、零长 block 跳过，以及 causal+valid_kv_length 拒绝；local dense backend 仍可直接消费同一全局前缀语义。^[PR #7047]
- [DIFF-1d2] packed varlen 边界是原子合同，所有并行路径都必须保留
  - 触发：producer 或 backend 读写 `cu_seqlens_q`、`cu_seqlens_k`、`max_seqlen_q`、`max_seqlen_k`，或把带 padding 的 packed 输入送入 Ring/Ulysses/hybrid attention。
  - 强制：四个字段一起生产、转发和消费；每条启用的 parallel/backend 路径必须把相同 sequence boundary 交给 kernel，无法表达时在执行前明确拒绝。
  - 验收：缺任一字段立即失败；两个不同长度样本的 packed 结果分别与独立运行对齐且无 cross-sequence attention；local 与每个声明支持的 Ring/Ulysses 组合做数值 parity，不支持的组合有 fail-fast 测试。 ^[PR #5691]

## 决策与踩坑

- [DIFF-1z] 禁止：在模型内直接调用 raw `scaled_dot_product_attention`，绕过 diffusion attention backend/configuration；把所有 full rows 当作任意离散 spans；在每个 denoise step 重建只依赖 `token_types` 的 SxS mask，或因 fallback 方便而关闭 backend 能力检查。
- [DIFF-7a] 禁止：把多个 control 直接拼成一个共享 attention 序列后让一个 control 污染其他 control 的输出；按 control token 数对拼接序列做 Ulysses 切分；只验证 output shape 就宣称 sequence parallel 为多控制 transfer 提供 per-rank 节省，或把一个控制的局部测试外推为多控制数值/性能 parity。
- [DIFF-8a] 禁止：只让正分支携带 extractor 所需参数；假设 negative branch 可以省略 `guidance`；用宽泛 `**kwargs` 或不启用 CFG 的测试掩盖 hook 与 model `forward` 的签名漂移。
- [DIFF-1ah] 禁止：把“当前 shape 看起来相等”当成可省 collective 的证明；用单个 counter 代替 boundary stack；在 gather path 之外删掉 slow-path coverage；或把去掉 `int(...)` 的 compile 好处写成任意 SP mode 的通用结论。
- [DIFF-1af] 禁止：无条件 `new_zeros` + 填 True；把 all-true device mask 交给 FlashAttention 只为“形状完整”；把省略 mask 说成改变了可变长 batch 的有效 token 集合。
- [DIFF-1ai3] 禁止：显式 Hub 选择在 miss 后静默落到 native/SDPA；preflight 只试 `version=1` 或再试无 version 的第三态；把 accuracy 探针在 Hub 不可用时双方改跑 SDPA 仍当作 FA3-vs-FA3 门禁；把 import/`has_flash_attn` 成功误当成 Hub build 已解析。
- [DIFF-1aj2] 禁止：依赖 MindIE-SD 隐式因果参数；让因果请求静默变成双向 attention；只靠“推理未崩”证明因果语义。
- [DIFF-1ai4] 禁止：把 `valid_kv_length` 当成“本 rank 本地长度”直接切片；在 causal ring 路径上静默 trim；用 bool/非 int 冒充长度；或把 trim 当成慢路径而不是 unsupported 组合。
- [DIFF-1d2] 禁止：只提供部分 metadata；在 Ring 路径丢弃边界；假设已分配但 backend 忽略的 `attn_mask` 能阻止真实 token 关注 padding 或下一条 packed sequence。
