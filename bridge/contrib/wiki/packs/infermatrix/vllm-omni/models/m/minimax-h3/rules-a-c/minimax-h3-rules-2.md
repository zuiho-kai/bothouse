---
name: minimax-h3-rules-2
description: MiniMax H3 规则（中）：MMH3-1b joint video/audio quality 与 offload 兼容性验收、MMH3-1c fused norm/RoPE 保持 checkpoint dtype 与 96/128 partial rotation（含 MUSA 单卡性能证据边界）、MMH3-1e TRTLLM dense/opt-in 路径与 role 隔离、MMH3-1g NPU mask-free opt-in 的 Ring 与 malformed-metadata fallback
metadata:
  scope: 只收 MMH3-1b、1c、1e、1g；路由表归 minimax-h3-rules-1，MMH3-1h、1i、1k、1j、1m、4a、4b 归 minimax-h3-rules-3
---
# MiniMax H3 规则（2/3）

## 关键事实

- 拆分说明：本页是源页 `rules.md` 的第 2/3 部分；第 1 部分 [[minimax-h3-rules-1]]；第 3 部分 [[minimax-h3-rules-3]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-09-09
- 来源（sources，续）：vllm_omni/platforms/npu/models/minimax_h3.py；vllm_omni/platforms/npu/platform.py；tests/diffusion/models/minimax_h3/test_minimax_h3_qwen3vl_rope.py；PR #6167；PR #6173；PR #6283；PR #6281；PR #6878；vllm_omni/diffusion/attention/ops/minimax_h3_modulation.py；PR #6476；PR #6526；PR #6410
  - vllm_omni/diffusion/models/minimax_h3/denoise_loop.py；PR #6876
- [MMH3-1b] joint video/audio quality 与 offload 兼容性必须一起验收
  - 触发：改变 H3 FP8 layer scope、kernel/loader、quality threshold、offload 或 nightly lane。
  - 强制：H3 online FP8 与 layerwise offload 当前标为 incompatible；resident FP8 可与 TP、VAE tiling 组合。BF16/FP8 A/B 使用同一 immutable checkpoint、prompt、seed、size、frames、steps、输入合同与并行/资源设置；T2VA case 即使显式给出 width/height，也必须在 `sampling_params.extra_args` 带合法 named `aspect_ratio`。
    - joint output 同时检查 video LPIPS 和 32 kHz audio 的 spectral cosine/RMS ratio。PSNR、MAE 与 peak memory 是 report-only 指标，不能冒充 gate。
  - 验收：当前 2x H100 case 的 gates 是 LPIPS <= 0.20、audio spectral cosine >= 0.80、RMS ratio 在 0.50–2.00，且 sample rate 为 32000；单测还要证明 phase-tolerant metric 接受相移但拒绝 spectral drift。质量 test 的 T2VA `aspect_ratio="16:9"` 是同一 case 的必填输入，不是量化变量；
    - 输入合同演进后应修正 fixture，不能靠跳过 case 或放宽质量 gate 恢复 CI。^[PR #5737] ^[PR #5829]
- [MMH3-1c] H3 fused norm/RoPE 必须保持 checkpoint dtype 与 partial-rotation 布局
  - 触发：修改 H3 q/k norm、RoPE frequency packing、head dim 或 shared fused-layer dispatch。
  - 强制：H3 使用共享 `RMSNorm`，gamma 保持 BF16，而 native reduction/scale 在 FP32 累加后 cast 回输入 dtype。CUDA/HIP eager 尝试 fused RMSNorm、异常时回退 native，compile tracing 直接 native；MUSA 独立走 `F.rms_norm` 以保留 dynamic Inductor 可融合 graph；XPU 走 native，NPU 直接调用 `npu_rms_norm` 且没有该 fallback。
    - RoPE 使用 NeoX `RotaryEmbedding(half_head_dim=False)`：128 维 head 只旋转前 96 维并原样保留末 32 维；CUDA/HIP/native 把 H3 的 tiled full frequencies 转为 half kernel layout，XPU 走 native；MUSA 对这个 full-dim、非 interleaved NeoX case 走 inline full-frequency 公式，其他 layout 回 native；MindIE 接收 full layout。
    - H3 `_apply_rope` 的 q/k 是 3D `[S,H,D]`；MindIE-SD kernel 只收 4D，因此 shared adapter 必须临时变为 `[1,S,H,D]` 并把输出恢复到 3D。
  - 强制：H3 旋转宽度从 config 静态派生为 `rot_dim = 6 * rope_inv_freq_len`，默认 16 得到 96，不再在 forward 从 `freqs.shape[-1]` 读取动态 symbol。这样 compile 保持静态 slice，但 caller 仍只调用 shared `RotaryEmbedding`、不含平台分支；config 与 frequency producer 不一致必须由 parity test 暴露，不能静默旋转另一宽度。^[PR #5881]
  - 验收：以 `cat([half, half])` frequency 对照 native reference，逐值断言 96 维旋转和 32 维 passthrough；另测 BF16 gamma/FP32 accumulation、compile native path 与各平台参数 wiring。真实 kernel 性能与数值结论需目标硬件复测；PR 报告的 491014→475070 ms 来自非目标 `5215e03a` 且缺硬件与重复次数，只能作为有界外部观察，不能写成稳定 3.35% 保证。
    - PR #5896 body 报告 8×Ascend 910B3、USP8/Ring1/DLO、50-step T2VA 完成并附视频，但 commit 只写 `main`、无数值对照或重复测量；它只补充运行完成证据。^[PR #5801] ^[PR #5896]
  - 验收：MUSA 性能证据只绑定 1×MTT S5000、driver 3.3.5-server、immutable container digest、BF16 packed QKV、S=96000、7 local heads、head_dim 128/rot_dim 96、`torch.compile(fullgraph=True,dynamic=True)`，5 warmups、2 discarded pilots、20 个带 512 MiB cache flush 的交错样本。
    - 该 exact Q/K RMSNorm+RoPE region 的 event median 30.0062→1.6323 ms（18.38×），同步 wall 30.0695→1.6893 ms（17.80×）；不是 TP8、端到端 request、其他 shape/dtype/layout 或其他 MUSA SKU 的保证。finite/shape/BF16 gate 与 direct-inline 接近只覆盖该 A/B，且未给 correctness tolerance/reference、benchmark script 或 raw artifact；
    - 当前自动测试没有 MUSA dispatch/parity，CPU reference 只验证 96 维旋转和 32 维 passthrough。^[PR #5881]
- [MMH3-1e] H3 TRTLLM 必须以兼容性、packed 合同和 role 隔离决定 dense/opt-in 路径
  - 触发：修改 H3 的 TRTLLM default、packed `cu_seqlens`/mask、SAGE、Skip-Softmax、`minimax_h3.token_refiner` role 或 denoise timestep context。
  - 强制：仅兼容 datacenter Blackwell SM100/103、`head_dim=128`、有 FlashInfer trtllm-gen capability 且模型声明 packed 或 mask-free path 时，H3 才自动选 dense BF16 `TRTLLM_ATTN`。workstation Blackwell、缺依赖、错误 geometry 或需要 mask 的路径必须走平台 fallback；显式不兼容选择必须启动失败。SAGE 与 Skip-Softmax 都是默认关闭的有损 opt-in。
  - 强制：TRTLLM 只允许无 SP 或 pure Ulysses；Ring 与 `skip_softmax` 组合报错、Ring 的 `quant` 不生效，AllGather-KV 在选择时拒绝。main DiT 与 token refiner 必须是独立 role；`per_role` 的 `AttentionSpec` 替换整个 default spec，故 token refiner 要显式只配 dense backend，不能继承 SAGE 或 Skip-Softmax。
    - H3 checkpoint 没有 calibration metadata，recipe 应使用 direct `threshold=0.05`，而非 `target_sparsity`。
  - 强制：单请求 producer-owned `[real,pad]` metadata 必须完整、Python host length 与同-device `int32` canonical cu views 一致且在 bounds；TRTLLM 裁 suffix 后恢复零输出，任何 nonempty `attn_mask` fail closed。generic complete cu_seqlens 保留真实 multi-document ragged path，尾部空 pair 折叠；不可把两种合同互换。
    - 短于 SAGE `k_block_size` 的实 KV 保持 dense，不得因 token refiner 关闭 main DiT。
  - 验收：覆盖 default/fallback/explicit-incompatible matrix、pure-Ulysses/Ring/AllGather admission、whole-spec `per_role` replacement 和 H3 direct-threshold recipe；并保留 packed trim/zero restore、malformed metadata、ragged/empty terminal、mask rejection和 short-role dense regression。^[PR #6542] ^[PR #6724]
- [MMH3-1g] H3 NPU mask-free opt-in 必须保留 Ring 与 malformed-metadata fallback
  - 触发：修改 H3 `_run_packed_attention`、NPU Flash backend capability、packed padding 或 LaserAttention scale。
  - 强制：H3 在非 Ring 时可因 backend 的 prefix slicing 或 packed-mask-free capability 不构造 mask，并发布四个 cu/max key、`valid_kv_length`、`npu_attn_varlen=True` 和 `laser_input_scale=256.0`。Ring 必须令 opt-in false 并保留 padding mask，因为 aligned rows 是固定 P2P buffer 合同；
    - CUDA packed varlen/cuDNN prefix slicing 继续走各自 capability，H3 caller 不按 platform 分支。shared NPU resolver/fallback 细节见 DIFF-1g。
  - 验收：model contract tests 分别覆盖 prefix-slice、packed-mask-free、普通 backend 与 Ring；backend tests 再覆盖 malformed fallback 和 Laser math。真实 Ascend parity/内存/延迟证据不能由 CPU mock 替代；同 seed E2E output comparison 与重新抓 memory snapshot 在 PR 中仍列为 follow-up。^[PR #5891] ^[PR #5997]

## 决策与踩坑

- [MMH3-1b] 禁止：只验视频就宣称 H3 joint-output quality；把一次 22% memory observation 写成稳定上界；让 FP8+layerwise offload 到 Cutlass kernel 才因 flattened-weight stride 失败。
- [MMH3-1c] 禁止：把任意 96 维随机 frequency 当成 H3 producer 合同；合法 full layout 是同一 48 维 half 的拼接。也不能从 CPU/reference 与 mocked NPU/MindIE wiring 推断真实 fused-kernel parity。PR #5896 的新增 mock 只断言 MindIE 收到 4D、输出恢复 3D 且 identity 回传不变；没有执行真实 rotary 数学，也没有新增原生 4D control。
- [MMH3-1e] 禁止：把 packed shortcut 泛化为 arbitrary mask、multi-request layout 或第三方 metadata；让 padding 进入 SAGE quantization；将 docs-only PR #6724 当作 runtime、质量或性能证明。
- [MMH3-1g] 禁止：让 capability method 变成 duck-typed backend 的硬依赖却不更新 doubles/plugins；不能把 H3 的 `[real,pad]` contract 泛化为 ragged multi-document。Laser 的 256 缩放只针对报告的 fp16 workspace overflow，其他 backend 忽略；online KV quant path不经过本优化。
  - repo 内 TeaCache `FakeBackend` 现已实现 capability 并返回 false，所以 extractor tests 保持 abstract-default 的 masked path；这不等于 production consumer 已有 default-safe access。第三方 duck-typed backend 仍必须继承 base 或实现该 classmethod，并对 registry override 做 capability census。
