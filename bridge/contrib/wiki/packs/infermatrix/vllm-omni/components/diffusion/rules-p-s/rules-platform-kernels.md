---
name: rules-platform-kernels
description: Diffusion 平台 kernel 与设备规则 DIFF-1t、1u、1v、1w、1ai5、1ai6：CPU offload 下 text encoder 输入跟随 self.device、NPU complex64 RoPE 用 index_select、packed SwiGLU 的 CUDA/NPU/XPU/MUSA 分派、Triton 融合 kernel 的 CUDA 与 contiguous 门禁、fused_qk_norm_rope 的 interleaved 模式与 token 门槛、AuK plain graph 在 ROCm 的 FP32 容差
metadata:
  scope: 只收共享 diffusion layer/kernel 在不同设备平台上的分派、门禁与精度规则；worker 与 platform 的配置合同（DIFFPLAT-1a、2a、3a）归 rules-platform-runtime，CustomOp 的 XPU 默认分派（DIFF-1ae）归 rules-custom-op-dispatch，规则入口表归 diffusion-rules-1
---
# Diffusion 平台 kernel 与设备合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-platform-kernels.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-07-20；updated: 2026-10-06
- 来源（sources）：PR #4341；PR #5001；PR #5087；PR #5088；PR #5136；PR #5255；PR #5344；PR #5543；PR #5720；PR #5737；PR #5764；PR #5801；PR #5802；PR #5838；PR #5839；PR #5848；PR #5872；PR #5881；PR #5896；PR #5981；PR #6094；PR #6102；PR #6279；PR #6385；PR #6445；PR #6651；PR #6722；PR #5831；PR #6989
  - vllm_omni/diffusion/attention/backends/flashinfer_attn.py；vllm_omni/diffusion/attention/backends/ring/ring_kernels.py；vllm_omni/diffusion/attention/parallel/ulysses.py；vllm_omni/diffusion/cache/cachedit/backend.py；vllm_omni/diffusion/data.py；vllm_omni/diffusion/distributed/hsdp.py
  - vllm_omni/diffusion/executor/multiproc_executor.py；vllm_omni/diffusion/layers/norm.py；vllm_omni/diffusion/layers/rope.py；vllm_omni/diffusion/lora/manager.py；vllm_omni/diffusion/model_loader/diffusers_loader.py；vllm_omni/diffusion/model_metadata.py；vllm_omni/diffusion/offloader/
  - vllm_omni/diffusion/registry.py；vllm_omni/diffusion/worker/diffusion_model_runner.py；vllm_omni/diffusion/worker/diffusion_worker.py；vllm_omni/engine/async_omni_engine.py；vllm_omni/entrypoints/openai/api_server.py；vllm_omni/quantization/component_config.py
  - vllm_omni/quantization/factory.py；tests/diffusion/attention/test_attention_sp.py；tests/diffusion/attention/test_ulysses_uaa.py；tests/diffusion/cache/test_cache_backends.py；tests/diffusion/layers/test_norm.py；tests/diffusion/layers/test_rope_broadcast.py
  - tests/diffusion/offloader/test_distributed_layerwise_backend.py；tests/diffusion/test_diffusion_config_propagation.py；tests/diffusion/test_multiproc_engine_concurrency.py；PR #4755；PR #5990；vllm_omni/diffusion/layers/fused_qk_norm_rope.py
  - vllm_omni/diffusion/cache/teacache/extractors.py；vllm_omni/diffusion/models/minimax_h3/minimax_h3_transformer.py；tests/diffusion/layers/test_fused_qk_norm_rope.py；PR #6165；PR #5677；vllm_omni/diffusion/quantization/hsdp_fp8.py；tests/diffusion/quantization/test_hsdp_fp8.py；PR #4845
  - PR #6173；PR #6070；vllm_omni/diffusion/models/ltx2/ltx2_components.py；vllm_omni/diffusion/model_loader/hub_prefetch.py；PR #5910；PR #5676；PR #6125；PR #6320；PR #5877；vllm_omni/diffusion/vllm_config.py；PR #6283；vllm_omni/diffusion/layers/activation.py；PR #6281
  - vllm_omni/diffusion/attention/ops/minimax_h3_modulation.py；PR #6130；PR #6364；PR #6073；PR #4820；vllm_omni/diffusion/attention/backends/fastvideo_vsa.py；PR #6150；PR #6410；tests/diffusion/layers/test_activation.py；tests/diffusion/layers/test_fused_qk_norm_rope_npu.py；PR #6982；PR #8342
- 置信度（confidence）：high
- 入口与其他规则见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（共享规则）。
- [DIFF-1t] CPU offload 下 text encoder 输入必须跟随 pipeline compute device
  - 触发：pipeline 启用 CPU offload，组件参数仍报告为 CPU，但 forward hook 会在执行前将 text encoder 权重移到 pipeline 的加速设备。
  - 强制：text encoder 组件初始化和 `encode_prompt` 输入都必须以 pipeline 的 `self.device` 为设备合同；输入 ids 不得通过 `next(text_encoder.parameters()).device` 推导设备，并保持 CUDA、XPU、CPU 等后端可用。
  - 验收：在启用 CPU offload 的 SDXL text-to-image 测试中，断言 text encoder 输入与 `self.device` 一致，并覆盖 XPU 及至少一个其他后端；确认 embedding lookup 不再出现 CPU/XPU 混用错误。^[PR #6125]
- [DIFF-1u] NPU complex64 RoPE 索引必须使用 `index_select`
  - 触发：修改 `WanS2VRotaryPosEmbed` 或 `RotaryEmbeddingS2VGrid` 的频率表采样、complex64 索引，或 NPU RoPE 兼容路径。
  - 强制：对 `freqs_split`/`freqs` 的帧、空间高度和空间宽度频率表统一使用 `torch.index_select(..., 0, index)`；当 `f_o < 0` 时先对帧频率表执行 `conj()` 再选择，并保持既有 `view`、`expand`、`reshape` 与采样顺序。
  - 验收：分别覆盖两个 RoPE 类的正向与共轭频率采样，断言 `index_select` 结果的 shape/value 与参考实现一致；在 NPU TP2 上运行 Wan2.2-S2V 端到端推理，确认不再因 `aclnnIndex`/`DT_COMPLEX64` 崩溃并产生视频输出。^[PR #6320]
- [DIFF-1v] diffusion packed SwiGLU 必须保持平台分派与精度边界
  - 触发：共享 diffusion MLP 将 `F.silu(gate) * up` 替换为 packed SwiGLU fused activation，或新增平台专用 activation dispatch。
  - 强制：输入最后一维必须保持 `[gate, up]` packed 合同，输出形状为输入去半后的最后一维，并保持输入的 device/dtype。通过本地 `CustomOp` 和 `current_omni_platform` 分派；CUDA 调用 `torch.ops._C.silu_and_mul`，NPU 调用 `torch_npu.npu_swiglu(..., dim=-1)`，XPU 保持 native fallback，其他平台必须有独立且已注册的实现。
    - 不会实际使用 fused op 的平台不得在构造时 eager resolve 该 op，尤其是 MUSA 应延迟解析。
  - 验收：CUDA 与目标 NPU 分别以 native reference 对照 fused 输出的 shape、dtype、device 和数值，并确认实际命中对应 kernel；XPU 断言 native fallback，MUSA 覆盖无 op 注册时的构造与 forward。固定 checkpoint、输入、seed 和步数比较 H3 输出时使用明确数值容差；NPU 路径只是目标 kernel contract，不产生通用性能或跨平台证据。^[PR #6283] ^[PR #6410]
- [DIFF-1w] Triton 融合 kernel 必须有设备能力与连续布局门禁
  - 触发：共享 diffusion 增加或修改 Triton fused op，尤其是 indexed modulation、in-place 输出、RMSNorm 融合，或被模型与 TeaCache extractor 复用的 kernel wrapper。
  - 强制：启动前同时检查 `HAS_TRITON`、`current_platform.is_cuda()`、输入/输出 tensor 的 CUDA device、支持的 dtype/shape 以及 kernel 所需的 row-major contiguous 布局；若列 stride 不是 1，必须回退或显式改用支持该 stride 的实现。非 CUDA、unsupported 或 strided 路径走 eager reference，并通过原生 `RMSNorm` 保留 NPU 的 `torch_npu.npu_rms_norm` 等平台分派。
    - 融合 reduction 与 elementwise 在 FP32 中完成，最终只在写回时转换到目标 dtype。
  - 验收：CPU/mock 覆盖 CUDA、NPU、XPU、MUSA、unsupported dtype/shape、空行和 contiguous/strided 输入，断言非 CUDA 路径不启动 Triton 且 NPU 保留 native RMSNorm；CUDA 目标硬件以 FP32 reference 核对值、dtype 和容差，并单独记录 kernel 数量/延迟。当前 PR 未新增该模块测试且 NPU CI 不覆盖 H3，在补齐前不得称为生产级跨平台支持。^[PR #6281]
- [DIFF-1ai5] fused_qk_norm_rope 的 interleaved 模式与 token gate 必须分模式闭合
  - 触发：修改共享 `fused_qk_norm_rope`、packed RoPE table、`interleaved` 分派、Boogu/MiniMax consumer，或 `VLLM_OMNI_FUSED_QK_NORM_ROPE_MIN_TOKENS`。
  - 强制：`interleaved=False` 保持 half-split `(d, d+rotary_dim/2)` 与既有 MiniMax-H3 fused geometry（`head_dim==128`、`rotary_dim==96`）；`interleaved=True` 使用相邻对 `(2i, 2i+1)`，CUDA Triton 仅在 even `rotary_dim <= head_dim <= 256` 时融合，否则 eager。
    - consumer 的 packed `[cos|sin]` table 必须匹配所选 pairing，不得把 half-split 与 adjacent-pair frequency 混用。融合路径的 token 门槛由 op 级 env 覆盖；短于门槛时整条 eager 链必须 bit-exact。新增 env 必须进入 public inventory 与 docs。
  - 验收：分别覆盖 half-split 与 interleaved 的 fused/eager 数值、geometry 拒绝、门槛上下切换，以及 env 缺省/覆盖；Boogu 集成断言 table 去重与 `[B*S, D]` 复用。^[PR #6982]
- [DIFF-1ai6] AuK plain graph parity 必须保持平台精度与输出所有权边界
  - 触发：修改AuK VAE eager/graph replay test、ROCm tolerance或graph pool retirement。
  - 强制：shape/dtype相同、双方finite；NVIDIA plain graph继续exact equality，ROCm仅FP32 plain graph使用max absolute≤1e-6、RMS≤1e-7、rtol=0。bucket/compiled fusion原有不同容差保持独立。返回waveform拥有自己的storage，后续replay和整generation/pool retirement不得改旧输出。
  - 验收：四GPU graph case在独立hardware lane执行；跨length、重复replay、cache满retirement后逐项核对已保存输出，另测CPU tile coverage/stitching与线程finally恢复。目标job真实pass只证明精确AuK matrix，不等同整AMD aggregate或模型质量/性能资格。^[PR #8342]

## 决策与踩坑

- [DIFF-1t] 禁止：因 offload 参数位于 CPU 就把 encoder 输入放到 CPU；硬编码 CUDA 设备；把 offload hook 已移动权重当作输入可以留在 CPU 的依据。
- [DIFF-1u] 禁止：在 NPU 路径对 complex64 频率表使用 `tensor[index]` advanced indexing，触发不支持 `aclnnIndex`/`DT_COMPLEX64` 的算子；不得因替换索引而改变共轭顺序、采样位置或输出布局。
- [DIFF-1v] 禁止：依赖 vLLM 通用 `SiluAndMul` 代替 diffusion 本地合同；把 `CustomOp` 注册本身当作目标设备实际命中证明；让 MUSA 构造因缺少 `_C.silu_and_mul` 失败；把 fused kernel 的输出宣称为必然 byte-identical，忽略不同舍入边界。
- [DIFF-1w] 禁止：只用 `x.is_cpu` 作为 Triton 门禁；让 NPU、XPU、MUSA 或其他非 CUDA tensor 进入 raw Triton launch；认为传入 row stride 就足以支持非连续列；对错误布局静默读写；或用 mock/wiring 结果宣称真实 kernel 数值 parity。
- [DIFF-1ai5] 禁止：把 interleaved 默认塞进 MiniMax half-split path；无门槛强制融合；只改一个 consumer 却不更新共享 op 合同或 inventory。
- [DIFF-1ai6] 禁止：将ROCm budget扩展到NVIDIA、compiled/bucket path或任意audio quality；用宽relative tolerance隐藏near-zero误差；CPU tile/thread调整删掉halo/stitching/输出所有权检查。
