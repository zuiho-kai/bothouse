---
name: ltx2-rules
description: "LTX-2.5 DiffVAE 规则：LTX-ACCURACY-1a 单 H100 distilled T2V reference 的 offload profile（PR #8453）、LTX25-1 decoder 统计量与 artifact 版本化（PR #6189、PR #7020）、LTX25-2 DiffVAE 请求边界与分布式 tile decode、LTX-3 decoded-video 设备端 uint8 量化（PR #7000）、LTX-4 vocoder 的 cudnn.deterministic 作用域（PR #7231）、LTX25-3 fusion 与 FNA 按 SM 门禁（PR #7350）"
metadata:
  scope: 只收 LTX-ACCURACY-1a、LTX25-1/2/3 与 LTX-3/4 规则；模型结构与证据索引归 ltx2-architecture，别名与 registry 入口归 ltx2-overview
---
# LTX-2.5 DiffVAE 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ltx2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, ltx2, diffusion；created: 2026-09-04；updated: 2026-10-06
- 来源（sources）：PR #6189；PR #7000；PR #7020；recipes/LTX/LTX-2.5.md；requirements/common.txt；docs/user_guide/diffusion/attention_backends/huggingface_hub.md；vllm_omni/diffusion/models/ltx2/ltx2_components.py；vllm_omni/diffusion/models/ltx2/ltx2_conditioning.py
  - vllm_omni/diffusion/models/ltx2/ltx2_diffusion_decoder.py；vllm_omni/diffusion/models/ltx2/ltx2_diffusion_decoder_distributed.py；vllm_omni/diffusion/models/ltx2/ltx2_latents.py；vllm_omni/diffusion/models/ltx2/ltx2_request.py；vllm_omni/diffusion/models/ltx2/ltx2_runtime.py
  - tests/diffusion/models/ltx2/test_ltx25_pipeline.py；tests/diffusion/models/ltx2/test_ltx2_output_cuda.py；tests/diffusion/models/ltx2/test_ltx2_pipeline.py；tests/diffusion/models/ltx2/test_ltx2_vae.py；PR #7231；PR #7350；PR #8453
- 置信度（confidence）：high
- [LTX-ACCURACY-1a] 单 H100 的 LTX-2 distilled T2V reference 必须保留 matched offload profile
  - 触发：修改 LTX official-similarity matrix、ltx2_distilled_t2v fixture 或 offload 选择。
  - 强制：该全分辨率单 H100 case 启用 layerwise offload，reference 与 Omni 保持 bf16 arithmetic、相同 checkpoint/seed/recipe 与独立 similarity thresholds；shutdown 用共享无权重恢复的 teardown 合同，不能为 OOM 改 accuracy 数值口径。
  - 验收：实际跑该 full_model hardware selector，核对视频/音频指标及 clean exit；单次作者 H100 结果仅支持该 case 的范围。^[PR #8453]

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| DiffVAE artifact/version 或 request/distributed decode | `LTX25-1`、`LTX25-2` |
| decoded-video transport、device quantization 或 profiler boundary | `LTX-3` |

### [LTX25-1] LTX-2.5 的 decoder、统计量与 artifact 必须作为同一版本化合同维护

- 触发：修改 LTX-2.5 full/distilled one- or two-stage pipeline 的视频 decoder、`ltx2_use_conv_vae`、latent normalization、Native sidecar、component residency 或 NATTEN Hub-kernel dependency/remediation guidance。
- 强制：LTX-2.5 默认构造 canonical Native DiffVAE；仅布尔 `ltx2_use_conv_vae=true` 可在启动时 opt into ConvVAE，I2V encoding 仍使用 ConvVAE。provided latent 的 normalize 与 decode 前的 denormalize 必须从实际视频 decoder 取得 mean、std 和 scaling factor。Native decoder 与独立 sidecar 先查 model root；
  - Hub fallback 使用 artifact repository 自己的 pinned revision，不能把 Diffusers model revision 跨仓库复用。DiffVAE 初始化必须要求 runtime `kernels==0.15.2`、支持的 NATTEN Hub kernel 和可操作的失败说明；该 pin 必须与支持范围 `transformers >=5.10.1, <5.15` 同步维护。
- 验收：覆盖 full/distilled profile 的默认和 ConvVAE opt-in、非布尔拒绝、Native decoder strict conversion、active-decoder statistics、local-first/repository-scoped revision routing，以及缺少 NATTEN runtime prerequisite 的 actionable error；
  - `requirements/common.txt`、Hugging Face Hub installation guidance、production error 和 LTX-2.5 test 必须一致地说明 `kernels==0.15.2` 与上述 Transformers 范围。^[PR #6189] ^[PR #7020]

### [LTX25-2] DiffVAE 请求边界与分布式 decode 必须显式 fail-closed

- 触发：修改 LTX-2.5 decode、`vae_parallel_mode`、tiling、request resolution validation 或 request RNG。
- 强制：DiffVAE request validation 从首个 decoder-stage kernel 推导最小 latent H/W，并在 denoising 前拒绝不足的 geometry；ConvVAE opt-in 保留其原有边界。分布式 DiffVAE 只接受 `vae_parallel_mode='tile'`。
  - stages 1–3 在所有参与 rank 上处理完整 low-resolution feature volume，只有 stage 4 与 diffusion stage 作为 overlapping tile task 分发，rank 0 按 serial reference 顺序 blend/merge。tile split 必须使每个 rank 从 rank-0 generator state 出发，并保持与 serial tiled decode 相同的 noise-consumption order；
  - 只有 active decoder 确认 collective decode 时非输出 rank 才参与。
- 验收：覆盖 early geometry rejection 与 ConvVAE control、tile positive/non-tile negative modes、serial RNG-order parity，以及 output/non-output rank 在 collective/non-collective decode 的分支。^[PR #6189]

### [LTX-3] LTX decoded-video transport 必须在设备端量化且保持 presentation 与 profiler 边界

- 触发：修改 LTX-2/2.3/2.5 decoded-video finalization、`output_type="np"`、worker/IPC transport，或 LTX diffusion-pipeline profiler wrapping。
- 强制：fast path 只接受 floating-point RGB `BCTHW` decoded video；detach 后仅当 `video_processor.config.do_normalize` 为真时在 decoder output dtype 中 denormalize，始终 defensive clamp 到 `[0, 1]`，再在该 dtype 中 scale/round 并直接转为 contiguous `uint8` `BTHWC`，随后由既有 post-process boundary 一次 `detach().cpu().numpy()` 交付。
  - 该 boundary 只接受 contiguous RGB `BTHWC` uint8；非 `np` output type 继续走 `VideoProcessor.postprocess_video`。profiler targets 必须同时覆盖 `video_processor.postprocess_video` 与 `_prepare_video_output_for_transport`；I2V 替换 video processor 后，profiler 启用时必须重新 wrap 前者。
- 验收：CPU 覆盖 dtype/normalization、shape/dtype/contiguity、无效 BCTHW/RGB/floating contract 与 profiler rewrap；CUDA 覆盖 BF16/FP16、normalize true/false 的 device-side contiguous BTHWC uint8 和一次 D2H 对比。有效 `[0, 1]` 的 `do_normalize=False` 输入须与 unclipped legacy path 比较；
  - 另测 intentional out-of-range defensive clamp。FP32 presentation bytes 必须 exact，BF16/FP16 相对 legacy FP32 presentation 最多相差一个 uint8 level；官方 similarity 仅是本 PR 所报 LTX matrix 的限定证据。^[PR #7000]

### [LTX-4] LTX vocoder 的 CUDA 路径必须 scoped 启用并恢复 `cudnn.deterministic`

- 触发：修改 `ltx2_runtime._run_ltx_vocoder` / `_deterministic_ltx_vocoder`、BWE vocoder 调用，或 accuracy reference runner 的官方 vocoder forward。
- 强制：仅在 `device_type == "cuda"` 时进入 context：将 `torch.backends.cudnn.deterministic` 设为 `True`，成功与异常退出都恢复调用前值；不得改动其他 cuDNN 开关。保留既有 BWE FP32 autocast / MPS float 合同。官方 reference runner 对 pinned BWE vocoder 施加同一 scoped pin，使两侧音频可稳定对照。
- 验收：CPU 覆盖初始 True/False 与注入异常后均恢复，且 `enabled`/`benchmark`/`allow_tf32` 等其他设置不变；相似度/固定 mel 实验只作有界证据，须在相同硬件与序列化执行假设下解读。^[PR #7231]

### [LTX25-3] DiffVAE pointwise fusion 与 TileLang FNA 必须按 SM 独立门禁

- 触发：修改 `resolve_ltx2_vae_operators`、fusion/FNA compute-capability allowlist，或 LTX DiffVAE 加速准入。
- 强制：pointwise fusion 与 TileLang FNA 分两个 capability 集合独立判定；已验证的 SM100/SM103 可开自校验 fusion（首用 bit-exact，失败回退普通数学），FNA 在未单独验证前保持 SM90-only。不得用单一 allowlist 绑死两条路径。
- 验收：平台单测覆盖 SM90 fusion+FNA、SM100/103 fusion-only、以及更低/未列 SM 全关。^[PR #7350]

## 决策与踩坑

- [LTX-ACCURACY-1a] 禁止：一个 case 通过就扩大到 LTX 全 matrix、其他卡或普遍性能收益；把 official 与 Omni 的不同 offload 执行时间当作相同性能条件。
- [LTX25-1] 禁止：让 ConvVAE statistics 处理 DiffVAE latent；将非布尔 opt-in 静默转换；把 local primary model path 误当成独立 sidecar 必须离线；使用未 pin 的 canonical Native artifact，或向用户建议不存在的 production FlexAttention fallback。
- [LTX25-2] 禁止：让不足 geometry 在 NATTEN/decode 中变成 HTTP 500；静默接受 height/width shard mode；按 rank placement 改变固定 seed 的 tile noise，或用 ConvVAE 的 distributed-state 判定 DiffVAE collective。
- [LTX-3] 禁止：为量化 materialize 全帧 `.float()` CUDA temporary、改变 latent/generation，或让 non-`np` output 走 uint8 fast path；不得把 `do_normalize=False` 的 out-of-range clamp 当作 legacy parity，或把 H200 的精确 shape/配置性能结果、LTX similarity matrix 外推为一般硬件、吞吐或兼容性结论。
- [LTX-4] 禁止：把 process-wide deterministic 永久打开；假设并发 worker 可安全争用该全局 flag；把偶发相对-L2 过线当作已消除算法漂移。
- [LTX25-3] 禁止：因 FNA 未验证而关闭已合格 SM 上的 fusion；或把 fusion 资格静默推广成 FNA/NATTEN schedule 已验证。
