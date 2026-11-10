---
name: diffusion-rules-2
description: Diffusion 共享规则（2/3）DIFF-1a、DIFF-1b、DIFF-1e、DIFF-1l、DIFF-1m、DIFF-1p：graph/compile/fused 路径复刻 eager 数值边界、请求本地 RNG 与零值、fused norm/RoPE 的精度布局与 MUSA 分派、fused Q/K RMSNorm+packed RoPE（head_dim=128、rotary_dim=96）、strict-Ulysses 局部 SP 边界、LTX-2.5 I2V 先 CRF 18 再 resize
metadata:
  scope: 只收 DIFF-1a、1b、1e、1l、1m、1p 六条规则；路由表归 diffusion-rules-1，DIFF-1x 起的规则归 diffusion-rules-3，tensor dtype 的 DIFF-1c 归 rules-tensor-dtype，attention 规则（含另一条同号的 DIFF-1m TRTLLM packed-padding）归 rules-attention-1 至 rules-attention-3
---
# Diffusion 共享规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[diffusion-rules-1]]；第 3 部分 [[diffusion-rules-3]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-07-20；updated: 2026-10-09

### 优化路径与 eager 的等价合同

- [DIFF-1a] graph/compile/fused 路径逐项复刻 eager 数值边界
  - 触发：新增或修改 CUDA Graph、compile、fused scheduler/solver 或缓存执行路径。
  - 强制：逐项对齐初始噪声、solver/timestep dtype、每步 cast 边界、最后一步更新、CFG=0/近零分支和输出 dtype；依赖行为有版本差异时固定并验证版本。
  - 验收：固定输入和 request-local generator，对 eager/优化路径逐步比较关键状态并覆盖零值和最后一步边界。Ming-TTS 的具体反例见 [[ming-omni-tts-rules]]（Ming-Omni-TTS 规则）；
    - local FlashAttention deterministic opt-in 的共享合同见 [[rules-attention-1]]、[[rules-attention-2]]、[[rules-attention-3]]（DIFF-1f），Qwen accuracy 边界见 [[qwen-image-rules]]（Qwen-Image 规则）。^[PR #4341]
- [DIFF-1b] 随机状态属于请求，零值不是缺省值
  - 触发：pipeline/scheduler 接收 seed、generator、guidance 或其他允许为零的数值。
  - 强制：使用请求本地 generator 并证明当前依赖版本真正消费它；用 `is None` 区分缺省与 `0`/`0.0`。
  - 验收：两个并发请求用不同 generator 可重复且互不影响，`0.0` 从 request 构造一路到达 consumer。Cosmos3 的落地约束见 [[cosmos3-rules-1]]、[[cosmos3-rules-2]]（Cosmos3 规则）。 ^[PR #5001]
- mixed-precision tensor/parameter dtype 合同见 [[rules-tensor-dtype]]（DIFF-1c 专页）。async output readiness、per-worker result channel、shutdown 与 constructor cleanup 合同见 [[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（DIFF-1d/1g/1h/1j 专页）。
- [DIFF-1e] fused layer 必须保留精度、布局与平台分派合同
  - 触发：共享 norm/RoPE 增加 fused op、平台专用实现、compile 分支或可配置 parameter dtype。
  - 强制：把 parameter 存储 dtype 与 reduction/累加 dtype 分开约束；CUDA/HIP eager 可尝试 fused op，但异常必须回退到数值等价的 native 实现，`torch.compile` tracing 直接走 native，NPU/MindIE 等专用 backend 则按其真实参数与频率布局调用。RoPE 适配器必须显式区分 full-dim tiled frequency 与 fused kernel 的 half layout，并保持未旋转 head tail 不变。
    - 若 caller 可传无 batch 的 `[S,H,D]`，进入只接受 `[B,S,H,D]` 的 fused kernel 前必须补 batch 维，返回后仅在本次确实补维时移除；原生 4D 输入不得被 squeeze。
  - 强制：MUSA 是独立 dispatch，不再假设兼容 CUDA。shared `RMSNorm.forward_musa` 保留 `F.rms_norm(x, (hidden_size,), weight, eps)` 的 aten graph，供 dynamic Inductor fusion；不能改走带 output mutation/`.data` 的 CUDA custom op。此共享路径直接影响 Cosmos3、HunyuanImage3、MiniMax-H3、Wan2.2 与 Z-Image 的 `RMSNorm` consumers。
    - shared RoPE 只有 full-dimension、非 interleaved NeoX layout 可走 MUSA inline 公式，当前还覆盖 Bagel/HunyuanImage3；half-dimension 或 interleaved layout 必须退回 native。3D cos/sin 只取共享 batch 0，再插 head broadcast 维；这些 fallback/shape 条件是 correctness contract，不能为 fusion 删除。^[PR #5881]
  - 验收：native reference 覆盖 parameter dtype、FP32 accumulation、旋转维度与 untouched tail；compile 路径断言不调用 fused op，平台 mock 只作为 wiring 证据。声称 fused parity 还需目标硬件上的同输入数值测试。mock kernel 的维度断言与 identity 回传只证明 adapter wiring/shape，不证明实际旋转数值。
    - 当前自动测试没有 MUSA dispatch/parity 或 shared-consumer census，也未证明 `F.rms_norm` 的 FP32 accumulation；CPU H3 reference fixture 强制 `forward_native`，只覆盖 `rot_dim=96`。硬件 A/B 是有界性能证据，不是持续回归 gate。^[PR #5801] ^[PR #5881] ^[PR #5896]

### Checkpoint 与分布式加载

- [DIFF-1l] fused Q/K RMSNorm 与 packed RoPE 必须共享布局并保留 eager fallback
  - 触发：共享 diffusion attention 新增或修改 Q/K RMSNorm+RoPE fused op、packed frequency table、custom-op dispatch，或 TeaCache 等 extractor 复用该边界。
  - 强制：公共 API 固定 `q/k` 为 `[tokens, heads, head_dim]`、norm weight 为 `[head_dim]`、`rope_table` 为 `[tokens, rotary_dim]`，并按 non-interleaved `[cos(theta), sin(theta)]` 存储；先完成 RMSNorm，再只旋转前 `rotary_dim`，原样保留 head tail。
    - 仅在 CUDA、Triton、BF16、`head_dim=128`、`rotary_dim=96` 时走 fused fast path，其余 device、dtype 与 geometry 必须走 eager reference；输入、权重和 table 的 dtype/device 合同必须保持一致。
  - 验收：CUDA/Triton 测试以 `F.rms_norm` 加显式 packed RoPE reference 对照 q、k，并覆盖 sequence length `1`、`257`、`1024`；另须覆盖 unsupported fallback、参数校验和非 contiguous 权重/table。当前 PR 只证明 BF16 专用 geometry 的三组数值对照，未证明 fallback、H3 集成或跨硬件 parity；4×B300 上一次 warmup/一次测量的 109.687→106.205 秒仅是该 workload 的性能观察。^[PR #5990]
- [DIFF-1m] 局部 SP 边界必须由已注册 strict-Ulysses hook 显式证明
  - 触发：修改 diffusion 模型的 rank-local sequence boundary、`local_sp_prepare`、SP layout 判定或 TeaCache extractor 的 `_embed()` 调用。
  - 强制：局部路径必须同时确认已注册 `sp_input---local_sp_prepare` hook、forward context 可用、`get_ulysses_mode() == "strict"`、sequence-parallel world size 大于 1 且等于 Ulysses size、Ring/AllGather size 均为 1，并确认 `seq_len` 可均匀切分；任一条件不满足都使用完整 sequence。需要完整上下文的 TeaCache extractor 必须显式传 `local_span=(0, seq_len)`。
  - 验收：覆盖 strict hook 的 rank span、缺 hook、forward context 不可用、SP=1、advanced UAA、Ring、AllGather-KV 和非整除长度 fallback，并回归 TeaCache extractor 的完整 span；当前合同只由 MiniMax-H3 caller 证明，其他模型仍需独立验证。 ^[PR #6173]
- [DIFF-1p] LTX-2.5 I2V 必须先执行 CRF conditioning 再 resize
  - 触发：LTX-2.5 I2V 修改 reference-image conditioning、`image_crf`、resize 顺序或 PyAV/FFmpeg 依赖。
  - 强制：PIL 输入默认执行 CRF 18，再进行 aspect-preserving resize；非零 `image_crf` 只接受 PIL 图像，tensor 输入必须显式使用 `image_crf=0` opt out；缺少 PyAV/libx264 要返回明确错误，任一尺寸小于 2 时在编码前原样返回。
  - 验收：覆盖默认/显式 CRF、PIL/tensor、无 PyAV、缺少 libx264、1xN 图像和非等比例输入，断言 CRF 顺序、错误类型、原图保护以及最终 conditioning shape。^[PR #6070]

## 决策与踩坑

- [DIFF-1a] 禁止：只比较 shape、无 NaN 或“能运行”；这些不能证明数值和请求语义等价。
- [DIFF-1b] 禁止：并发请求中修改 process-global RNG；使用 `x or default` 吃掉合法零值。
- [DIFF-1e] 禁止：用 platform dispatch 推断所有 backend 接收同一布局；用 CPU/reference 或 mock 参数 wiring 测试声称真实 CUDA/HIP/NPU/MUSA fused kernel 已完成数值 parity。
- [DIFF-1l] 禁止：把模型原始或 tiled `freqs` 直接当作 packed cos/sin table，交换 cos/sin、改用 interleaved layout，或仅因 Triton/custom op 可用就强制走 fast path；fast path 也不得物化 normalized Q/K 与 rotary 中间结果来掩盖布局错误。
- [DIFF-1m] 禁止：仅凭 SP rank/world size 推断局部 embedding 安全；让 Ring、AllGather-KV、advanced UAA、缺少 hook、非 forward context 或不可整除长度误走局部路径；把模型专属的局部 row 重建合同泛化为所有 diffusion 模型。
- [DIFF-1p] 禁止：在 CRF round trip 前 resize 或 squash 图像；按模型路径名猜版本；把非零 CRF 静默应用到 tensor；将 1-pixel 维度向下取整为零后交给 libx264。
