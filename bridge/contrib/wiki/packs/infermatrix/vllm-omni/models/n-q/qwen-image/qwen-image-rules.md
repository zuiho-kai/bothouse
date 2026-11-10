---
name: qwen-image-rules
description: "Qwen-Image 规则：QWENIMG-1a accuracy gate 先证同 seed repeatability（PR #5887）、1b 复数 RoPE 编译路径函数式算子（PR #6110）、1c Edit txt_seq_lens 取 padded width（PR #5586）、1d CUDA eager RoPE 走 RotaryEmbedding（PR #7513），以及 Qwen-Image-2.1 的 sigma 网格、idle KV graph 释放、ROCm 夜间精度、VAE tile 起点四条 VLLM-OMNI-PR 规则"
metadata:
  scope: 只收 QWENIMG-1a 至 1d 与四条 Qwen-Image-2.1 的 VLLM-OMNI-PR 规则；QWENIMG-1e 归 rules-qwen-image-21，变体映射与结构要点归 qwen-image-overview
---
# Qwen-Image 实现规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/qwen-image/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-10-24
- 来源（sources）：PR #5887；tests/e2e/accuracy/test_qwen_image.py；PR #6110；vllm_omni/diffusion/models/qwen_image/qwen_image_transformer.py；PR #5586；PR #7513；PR #8699；PR #9272；PR #9268；PR #8868
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| accuracy/repeatability gate | `QWENIMG-1a` |
| compiled complex RoPE | `QWENIMG-1b` |
| Edit `txt_seq_lens`/RoPE width、negative CFG length | `QWENIMG-1c` |

### [QWENIMG-1a] accuracy gate 必须先证明同 seed repeatability

- 触发：修改 Qwen-Image accuracy threshold、regional compile 或 fixture 的 deterministic opt-in。
- 强制：accuracy fixture 显式启用 shared [[rules-attention-1]]、[[rules-attention-2]]、[[rules-attention-3]]（DIFF-1f） 的 dense FA flag；先以相同 seed 多次比较 Omni↔Omni 唯一性，再用独立 gate 比较 Omni↔Diffusers。
- 验收：regional compile + dense FA 下固定完整请求至少重复运行多次，先断言同实现输出稳定，再执行 SSIM≥0.97、PSNR≥30 的跨实现 gate。PR 的 L20X run 为 0.960/28.188，未通过恢复后的两个 gate；合并后评论仍报告 0.958，因此目标证据不能证明 flake 已消除。^[PR #5887]

### [QWENIMG-1b] 复数 RoPE 分量在编译路径使用函数式算子

- 触发：修改 Qwen Image `QwenImageCrossAttention` 的 complex RoPE 频率分解、regional compilation 或 MUSA 执行路径。
- 强制：对 `vid_freqs` 和 `txt_freqs` 使用 `torch.real()`/`torch.imag()` 后再转换为 query 对应 dtype；即使问题由 MUSA 暴露，也保持 CUDA 与其他平台使用同一等价函数式表达式。
- 验收：以 legacy 属性表达式作为 reference，验证函数式路径的值与 dtype 精确一致；在目标 MUSA 上以 Qwen Image 默认编译配置验证不再出现 `Duplicate tensors found`，并在 CUDA smoke 中确认输出 parity。^[PR #6110]

### [QWENIMG-1c] edit path 的 `txt_seq_lens` 必须来自 padded embed width，不得来自 mask token count

- 触发：修改 Qwen-Image Edit pipeline 的 prompt encode、RoPE table length、negative prompt wiring，或 request-batch padding。
- 强制：传给 RoPE / `diffuse()` 的 `txt_seq_lens` 与 `negative_txt_seq_lens` 必须由实际 prompt embed 的 padded width 推导，而不是 `prompt_embeds_mask.sum()` 的 valid-token 数。mask 只表达语义 token 有效区，不能缩短需要为 padded encoder width 构造的 text frequency table。
- 强制：有 negative prompt 且启用 true CFG 时，正负两侧都使用各自 embed width；无 negative prompt 时 negative length 必须是 `None`，不能伪造一个来自正分支 mask 的长度。
- 验收：以 padded embeds 但较短 valid-token mask 的 request 覆盖 Edit `forward()`，精确断言传入 `diffuse()` 的长度等于 padded width；同时覆盖有/无 negative prompt 的 CFG 分支，防止单侧回归。^[PR #5586]

### [QWENIMG-1d] CUDA eager RoPE 必须走激活 dtype 的 RotaryEmbedding

- 触发：修改 Qwen-Image `_qwen_image_qk_norm_rope` 的 CUDA/eager 分支、`RotaryEmbedding` 调用，或把 RoPE 放进 regional compile。
- 强制：所有设备的 eager 路径在 RMSNorm 之后使用 `RotaryEmbedding`；`cos`/`sin` 由 `torch.real`/`torch.imag` 得到并 cast 到激活 dtype（BF16）。这是 pipeline 对 Diffusers 的路径。fused kernel 可以继续对照 FP32 complex multiply，但那不是 eager CUDA 路径。
- 验收：`use_fused=False` 对所有设备对照 `RotaryEmbedding`；fused 测试单独对照 FP32 complex reference。eager CUDA 与 fused reference 不得再共用同一个 expected。^[PR #7513]

### [VLLM-OMNI-PR8699-QWEN21-SIGMA-GRID] checkpoint 预设 sample_sigmas 必须按请求>模型>回退优先级贯通到步数解析

- 触发：为 native `nn.Module` pipeline（如 `QwenImage21Pipeline`）接入 checkpoint `model_index.json` 中的预设 `sample_sigmas` 网格，或修改 `OmniDiffusionConfig.enrich_config` 的 extras 提取、`prepare_timesteps` 的 sigmas 回退、pre-process hook 的请求级注入、`default_num_inference_steps` 或 `sigmas` 的 extra_body 白名单。
- 强制：保持与 upstream diffusers #14950 一致的优先级：请求级 `sigmas` > 模型级 `sample_sigmas` > `linspace(1.0, 1/num_inference_steps, num_inference_steps)` 回退；网格生效时总步数由 `len(sigmas)` 决定，显式 `num_inference_steps` 被忽略。
  - `enrich_config` 的提取条件按实现是 `self.extras.get("sample_sigmas") is None`：extras 缺失该键或显式为 `None` 时都会写入 checkpoint 网格，即显式 `None` 同样会被覆盖；只有非 `None` 的显式 extras 值胜出。请求未携带 sigmas 时，pre-process hook 必须把预设网格注入为请求级 `sigmas`，使 `StepScheduler._get_total_steps` 与 cache backends 经既有 `len(sigmas)` 路径解析正确总步数；
  - runner 的 cache-refresh 路径经 `default_num_inference_steps` 解析步数。`sigmas` 只能通过既有多模型 extra_body 白名单机制（同 LTX2）按请求开放，并在 chat 与 images/generations 两条路径生效。
- 验收：CPU 单测覆盖 extras 三种情形（从 model_index 提取、缺失不写入、显式非 `None` extras 不被覆盖）与 `prepare_timesteps` 优先级（请求 sigmas 胜出、config 网格决定步数并压过 `num_inference_steps`、无网格回退 linspace）；断言请求未携带 sigmas 时步数解析等于网格长度；extra_body `sigmas` 在 `/v1/chat/completions` 与 `/v1/images/generations` 均可覆盖默认网格。
  - Turbo 的 CFG=1 用法与 Qwen Research License 属 checkpoint 使用约束，不是本规则的验收对象。^[PR #8699]

### [VLLM-OMNI-PR9272-QWEN21-IDLE-KV-GRAPHS] decode graph 静态 prefix KV 必须在下次 prefill 前按 owner 存活状态释放

- 触发：修改 `vllm_omni/diffusion/models/qwen_image_21/decode_graph.py` 中 `QwenImage21DecodeGraphManager` 的 entry/owner 生命周期（`release_idle_entries`、`_owners` weakref 表、`max_entries` LRU、`clear`），或 `pipeline_qwen_image_21.py` 的 `release_step_request`、`_release_idle_decode_graphs`、
  - `_denoise_step_homogeneous` 的 prefill 相位判定，或 `cfg_parallel.py` `diffuse()` 中 prefill 前的清理，以及 Qwen-Image-2.1 前缀 K/V（`_scatter_kv_cache` clone）与 request geometry 的请求退役路径。
- 强制：graph key 含 batch size、prefix length 与完整 `img_shapes`，每个 entry 由指向请求 prefix K tensor 的 weakref 拥有。
  - owner 已死亡或未记录的 entry 必须在下一次 prefill clone 新 prefix 之前经 `release_idle_entries()` 释放：`cfg_parallel.diffuse()` 与 step 路径 `_denoise_step_homogeneous`（`_kv_cache_phase(...) == "prefill"` 时）都要触发，确有释放时调用 `current_omni_platform.empty_cache()`；
  - owner 仍存活的 entry 必须保留，让并发请求继续 replay——放弃同 key 复用的代价只是下一次请求多付一次 recapture。
- 强制：请求退役走 `release_step_request`：显式置空 `extra["kv_cache"]` 并调用 `release_request_geometry()`，但不动 graph 表，dead entry 留到下一次 prefill 释放。跨请求累积的是 graph 侧静态 prefix 拷贝（普通 tensor，不是 CUDA graph private pool），不是随请求结束被丢弃的 `state.extra["kv_cache"]`。
- 验收：CPU 单测以 weakref + `gc.collect()` 断言 `release_idle_entries()` 后 dead-owner key 从 `entries`/`_owners` 消失且静态 prefix 张量可回收（weakref 归 None）、live key 保留且 `_owners[live_key]()` 仍指向在飞请求的 key tensor；`release_step_request` 置空 kv_cache 与 geometry 且不调用 `clear`/`release_idle_entries`；
  - prefill 路径断言 `release_idle_entries` 恰好被调用一次。weakref 单测证明的是 entry 生命周期机制，不构成 GPU 端到端 OOM 已消除的证据。^[PR #9272]

### [VLLM-OMNI-PR9268-QWEN21-ROCm-ACC-NIGHTLY] ROCm 夜间精度任务必须跑真实对照；gfx942 IT2I 的文档化 XFAIL 是对 QWENIMG-1a 的显式窄例外

- 触发：修改 `tests/e2e/accuracy/qwen_image_21/` 的 contract/preflight/thresholds/测试/参考脚本、`.buildkite/amd/test-amd-nightly.yml` 或 `tests/buildkite/test_amd_pipeline.py` 中 "Qwen-Image 2.1 Accuracy" 作业合同，
  - 或 `vllm_omni/diffusion/models/qwen_image_21/autoencoder_kl_qwenimage21.py` 的 `_cudnn_deterministic()` 平台判定。
- 强制：ROCm 在 torch 侧复用 `cuda` 设备命名空间但 cuDNN attention 不可用——contract 平台项固定 `rocm` 为 `generator_device: "cuda"`、`attention_backend: "TORCH_SDPA"`，preflight 把 `rocm` 映射到 `torch.cuda`；cuda 与 rocm 都断言 `total_memory >= 70 * 1024**3`（实际检查阈值是 70 GiB，失败文案却写 "Use one >=80 GB GPU"，审阅时不要把文案当成 80 GB 检查）。
  - ROCm CI 镜像返回空 marketing name 时必须以 `gcnArchName` 作为稳定设备身份，防止校准静默落回 CUDA 默认阈值。VAE 的 `_cudnn_deterministic()` 只在 `torch.version.hip is None`（CUDA）时临时启用 determinism 并在退出时还原原值，HIP/MIOpen 必须保持默认卷积策略。平台 attention 策略各自固定：ROCm 用 Torch SDPA，CUDA 保留 cuDNN attention，NPU 维持既有执行 profile。
  - AMD 夜间作业为 NonBlocking、`mi300_1`、mirror `amdproduction`、180 分钟超时，以 `full_model and diffusion and rocm and MI325 and cards_1` 标记先 collect-only 恰好收集 `it2i`、`t2i` 两个节点（数量或节点不符即 exit 5）再运行，环境固定 `QWEN_IMAGE_21_CALIBRATE=0`（正常执行而非校准掩盖）与 `DIFFUSION_ATTENTION_BACKEND=TORCH_SDPA`，并上传 junitxml、
  - pytest 日志与 accuracy 产物（含 metrics 与图像）。T2I 保持严格数值门限 SSIM ≥ 0.99、PSNR ≥ 40 且必须真实通过。
- 强制：与 QWENIMG-1a 的显式关系——gfx942 IT2I 必须完整执行 native/reference 对照并保留 metrics 与图像后按文档化 expected XFAIL 报告，根因是默认 MIOpen condition-image VAE 编码跨隔离进程不确定。该 XFAIL 构成对 QWENIMG-1a "先证同 seed repeatability、再上跨实现数值 gate" 要求的显式窄例外：范围仅限 ROCm gfx942 的 IT2I case，且以跨进程非确定性根因仍然成立为前提；
  - 除此之外的一切情形（含 ROCm T2I 以及 CUDA/NPU 全部 case）QWENIMG-1a 继续完全生效。任何把该 XFAIL 改为真实数值阈值的变更，必须先按 QWENIMG-1a 证明同 seed repeatability 并定位/消除 MIOpen 非确定性根因，再执行跨实现数值 gate。
- 验收：`test_amd_pipeline.py` 断言 grade/pool/mirror/timeout、两个 env 值、`full_model and diffusion and rocm and MI325 and cards_1` 标记、节点守卫文案、`setup_reference.sh` 与 BUILDKITE_COMMIT 读取，并断言 "Qwen-Image 2.1 Accuracy" 不出现在 ready/merge pipeline；
  - `test_vae.py` 以 monkeypatch 分别证明 determinism scope 仅 CUDA 生效且退出后还原、MIOpen 路径保持默认策略。gfx942 IT2I XFAIL（SSIM 0.9834/PSNR 32.30）与 T2I 通过（0.9968/44.63）是 MI300 nightly 的历史证据，不构成对 MIOpen 非确定性的定量刻画。^[PR #9268]

### [VLLM-OMNI-PR8868-QWEN21-VAE-TILE-STARTS] VAE tiled decode 的 tile 起点必须均匀铺开且尾 tile 贴边结束

- 触发：修改 Qwen-Image-2.1 VAE 的 tiling/tile 布局——`vllm_omni/diffusion/models/qwen_image_21/autoencoder_kl_qwenimage21.py` 的 `_tile_starts`、tiled decode 循环或 `tile_sample_min`/`tile_sample_stride` 语义，
  - 或 `vllm_omni/diffusion/distributed/autoencoders/autoencoder_kl_qwenimage21.py` 的 `tile_split`/`tile_merge` 与 `tile_spec` 中的 `starts_*`/`overlap_*`/`cells_per_latent` 字段。
- 强制：轴向 tile 起点必须统一由 `_tile_starts(size, tile_min, stride)` 一类布局产生，并保持不变量：首起点为 0、严格递增、尾 tile 恰好在边界结束（`starts[-1] == size - tile_min`）、相邻间距落在 `[1, stride]` 且整数网格内尽量均匀（max-min ≤ 1）、轴尺寸 ≤ tile_min 时单 tile 覆盖；每个 tile 都保持完整 decode window。
  - 分布式 `tile_split` 的 overlap 必须由相邻起点的实际差值乘 `cells_per_latent`（`spatial_compression_ratio // (patch_size or 1)`，unpatchify 前的折算）推导并写入 `tile_spec`，`tile_merge` 从 `tile_spec` 读回同一组 starts/overlap，grid 形状等于两轴起点数、坐标使用起点索引。
- 验收：布局单测对 1..256 等全尺寸范围断言上述不变量（含单 tile 分支与间距均匀性）；以非 stride 整除的 latent 尺寸（如 tile 8、stride 6 下的 16x22、22x16）断言所有解码 tile 窗口等于完整 tile 尺寸；分布式路径回归 tile_split/tile_merge 与整体 tiled_decode 结果一致（16x16 latent、8x8 tile、stride 6 时起点为 [0,4,8]，9 个 task、3x3 grid）；
  - 端到端可用列中值相对两侧 6..20 像素邻域中值偏差 ≥3 的检测器确认无接缝。^[PR #8868]

## 决策与踩坑

- [QWENIMG-1a] 禁止：从单次跨实现 SSIM/PSNR 推断 nondeterminism 已消失；把 accuracy-only opt-in 当成普通 serving 默认；用跨实现系统偏差解释同实现双稳态，或反向混淆两者。
- [QWENIMG-1b] 禁止：在该编译路径恢复 `freqs.real`/`freqs.imag` 属性链，或仅用 `--enforce-eager` 掩盖重复 tensor alias guard；不得把该模型级修复泛化为所有 diffusion RoPE caller 已具备同等保障。
- [QWENIMG-1c] 禁止：在 Edit path 回退到 `mask.sum()`，即使别的 Qwen-Image pipeline 仍正确；或仅以 helper test 证明 RoPE table 正确而不锁定实际 `forward()` call site。
- [QWENIMG-1d] 禁止：在 eager CUDA 上恢复 `_apply_qwen_image_rotary_emb` 或其它 FP32 复数乘。该 helper 能在单元测试里对齐 Diffusers `apply_rotary_emb_qwen(..., use_real=False)`，但 Inductor 不能 codegen 复数算子，且会把 Omni↔Diffusers pipeline PSNR 打到门限以下。不要用 `--enforce-eager` 掩盖，也不要为迁就 helper 去降 pipeline gate。
- [VLLM-OMNI-PR8699-QWEN21-SIGMA-GRID] 禁止：让 `enrich_config` 覆盖用户显式提供的非 `None` extras 值，或把提取判定改成键存在性/truthiness 检查（现状以 `is None` 判定，显式 `None` 会被 checkpoint 网格覆盖，语义不同）；省略 hook 注入导致 step-wise 执行与缓存按调用方步数（如示例默认 50）而非网格步数（8）解析；网格生效时仍让 `num_inference_steps` 参与步数决定；绕过白名单机制向请求开放调度参数。
- [VLLM-OMNI-PR9272-QWEN21-IDLE-KV-GRAPHS] 禁止：把 `max_entries`（默认 8）的 LRU 淘汰当成唯一回收路径——每张图按自身宽高比 resize（`calculate_dimensions`）后重排即改变 `img_shapes`、更换 key，静态拷贝跨请求堆积，在下一次 `_scatter_kv_cache` clone 时 OOM（#8831；#8760 的 retention 修复不覆盖这份拷贝）；为保留同 key 复用而留下 dead-owner entry；
  - 请求退役时 `clear()` 整个 graph 表或释放 live-owner entry；用关闭默认开启的 `causal_condition` 掩盖泄漏（报告中延迟约 11 s → 36 s）。
- [VLLM-OMNI-PR9268-QWEN21-ROCm-ACC-NIGHTLY] 禁止：为 ROCm 引入未经验证的数值下限或用校准吸收差异；为通过门限删减 IT2I 真实对照或产物上传；在 HIP 上强制 `cudnn.deterministic`；省略 collect-only 精确节点守卫；把该作业加入 ready/merge pipeline 或改为 blocking；accuracy test 丢失 `os.environ.get("BUILDKITE_COMMIT")` 证据锚点；
  - 把 gfx942 IT2I 例外扩大到其他平台或 case，或在未满足 QWENIMG-1a 前置条件的情况下移除 XFAIL 改设数值阈值。
- [VLLM-OMNI-PR8868-QWEN21-VAE-TILE-STARTS] 禁止：回到 `range(0, size, stride)` 固定步长铺 tile 使尾 tile 被图像边界截短——被截断的尾 tile 以更小窗口参与 causal conv 解码，与邻 tile 产生系统性亮度偏移，blend 掩盖不了，
  - 接缝位置恰为尾 tile 起点 + blend 宽度（#8850：tile 512/stride 384 时，高 1024、宽 1024/1408/1440/1792 出现约 8-11 px、+6/+7 luma 的固定位置竖条纹，与 prompt/seed 无关；stride 整除或尾 tile 恰为完整窗口时不可见）。不得把关闭 tiling 当作修复方向（4096x2048 untiled 时 VAE 每 rank 峰值约 74.5 GB，tiled 约 24 GiB，#8850）。
