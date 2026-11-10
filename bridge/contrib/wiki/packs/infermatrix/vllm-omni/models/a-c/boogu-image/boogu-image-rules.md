---
name: boogu-image-rules
description: "Boogu-Image 规则 BOOGU-1a 至 BOOGU-1f：global revision 只补未显式声明的 stage 并传到六个 consumer（PR #6701）、RoPE 以 real cos/sin 贯穿各 stream（PR #6571）、Edit CFG 三分支与 CFG2 rank0=[0,2] / rank1=[1] 分派及 VAE efficient→math fallback（PR #6786）、request batching 只合并 T2I 而 TI2I 保持 batch=1（PR #6968）、Turbo DMD student 路径独立分流（PR #6699）、预量化 TorchAO FP8 只量化 DiT（PR #6925）"
metadata:
  scope: 只收 BOOGU-1a 至 BOOGU-1f 及其代码入口表；名称、源码路径和共享依赖归 boogu-image-overview
---
# Boogu-Image 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/boogu-image/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-05；updated: 2026-09-08
- 来源（sources）：PR #6701；PR #6571；PR #6786；PR #6968；docs/models/supported_models.md；recipes/Boogu/Boogu-Image.md；vllm_omni/config/omni_config.py；vllm_omni/diffusion/models/boogu_image/pipeline_boogu_image.py；vllm_omni/diffusion/models/boogu_image/boogu_image_transformer.py
  - vllm_omni/entrypoints/utils.py；tests/diffusion/models/boogu_image/test_pipeline_boogu_image.py；tests/diffusion/models/boogu_image/test_boogu_image_transformer.py；tests/entrypoints/test_utils.py；tests/e2e/online_serving/test_boogu_image_edit.py；PR #6699；PR #6925
- 置信度（confidence）：high

### Direct 代码快速入口

| PR 描述信号 | 规则 |
|---|---|
| revision、RoPE、Edit CFG/rank/VAE、request batching | `BOOGU-1a`–`BOOGU-1d` |
| Turbo DMD few-step schedule/renoise、TorchAO FP8 DiT-only quantization | `BOOGU-1e`、`BOOGU-1f` |

### [BOOGU-1a] global revision 必须填入每个未显式设 revision 的 stage

- 触发：全局/stage checkpoint revision handoff、Boogu component loader 或 Edit-Turbo recipe 变更。
- 强制：global revision 只补入未显式声明 revision 的 resolved stage；effective revision 必须一致传播到 transformer source/prefetch、scheduler、mLLM、processor 和 VAE loaders。
- 验收：分别覆盖 global fill 与 stage override，并断言六个 consumer 的 effective revision 一致。Edit-Turbo 文档/测试仅覆盖 `Boogu/Boogu-Image-0.1-Edit-Turbo` 的 `hotfix-1k-20260708`、4 steps、guidance 1.0；不证明 distinct Turbo class、DMD/renoise、quality 或一般 registry claim。^[PR #6701]

### [BOOGU-1b] RoPE 必须以 real cos/sin 表示贯穿 Boogu streams

- 触发：RoPE table/gather、stream propagation 或 platform dtype selection 变更。
- 强制：`(cos,sin)` 各为 `B,S,D`；per-axis tables 用 `use_real`/`repeat_interleave_real` adjacent-pair frequency，分别 gather/concat cos、sin。MPS CPU-gather indices 后返回原 device；NPU/MPS/no-FP64 用 FP32，否则 FP64。adjacent pairs 在 FP32 以 `even*cos-odd*sin`/`even*sin+odd*cos` rotate 后 cast x dtype；
  - instruction/image refinement、double/single stream 和 pipeline 全部传此表示。
- 验收：old complex reference assert-close，加 MPS/NPU selection 和 pipeline propagation；E2E/perf 仅作者报告。^[PR #6571]

### [BOOGU-1c] Edit CFG 分支、rank 分派与 VAE decode 必须保持语义闭合

- 触发：修改 Boogu-Image Base/Edit sampling、single/double-stream transformer、CFG parallel branch construction/combination，或 CUDA VAE decode。
- 强制：Base 与 single-stream Edit 都构造两条 branch。double-stream Edit 必须按 `[positive+reference, negative+reference, negative-no-reference]` 构造；CFG2 时 rank 0 消费 `[0,2]`、rank 1 消费 `[1]`，CFG3 时每 rank 消费一条。合并严格按 `pwr + (text - 1) * (pwr - nwr) + (image - 1) * (nwr - uncond)`；
  - CFG 关闭时每个 rank 只执行 positive branch。CUDA VAE encode/decode 优先 `EFFICIENT_ATTENTION`，再以 `MATH` fallback。
- 验收：有界测试覆盖 Base/single Edit 两分支、double-stream Edit 三分支、CFG2 的 `rank0=[0,2]`/`rank1=[1]`、CFG3 一 rank 一 branch、精确 guidance 合并式、CFG-off 每 rank positive-only，以及 CUDA VAE efficient→math fallback；不将这些测试外推为 TP/SP/HSDP、cache、offload 或通用性能结论。^[PR #6786]

### [BOOGU-1d] request batching 只能合并 T2I，并保持请求行与输出的对应关系

- 触发：修改 `BooguImagePipeline` 的 request batching、pre-process compatibility key、prompt/mask reshape、generator collate 或 request-level output split。
- 强制：纯文本或无 reference image 的 T2I 必须写入稳定的 `("boogu_image", "t2i")` compatibility key 后才可合批；带 reference image 的 TI2I 必须把 `request_id` 放进 key，并在 `has_reference and req.num_reqs > 1` 时 fail-close。
  - TI2I 保持 batch=1，直到 scheduler key 能区分 `guidance_scale_2_provided`：该字段目前不在 `RequestBatchSamplingParamsKey` 中，而 `forward` 会从 batch 首请求读取它。request-local generators 按 request-major/output-minor 合并；`num_outputs_per_prompt` 的结果必须拆回每个原始请求一个 `DiffusionOutput`。
  - prompt mask 用 `repeat_interleave` 保持与 reshaped embeds 相同的 request-major 行序。
- 验收：用真实 `DiffusionRequestBatch` 和 scheduler key builder 覆盖 stable T2I/unique TI2I key、batched TI2I raise、B=2/N=2 distinct-mask 行序、request-major generators 和每请求 output slice；CFG B=2 isolation 至少分别改变 partner 的 positive prompt、negative prompt 和 seed。
  - CPU/mock tests 不证明 GPU CFG、TI2I batch safety、吞吐或 QPS/perf claim。^[PR #6968]

### [BOOGU-1e] Turbo DMD student 路径必须与 Base/Edit scheduler 路径严格分流

- 触发：新增或修改 `BooguImageTurboPipeline`、Turbo few-step sampling、explicit `timesteps`/sigmas、renoise loop，或 request batching。
- 强制：Turbo 必须走独立的 DMD student contract，而不是复用 Base/Edit 的 regular scheduler+CFG path。其 sigma schedule 只能来自两种来源：显式 1D finite sequence（接受 `[0,1]` 或 `0..1000` 训练 timestep 归一化后形式），或由 `conditioning_sigma..1.0` 线性生成的 `num_inference_steps` 个 ascending sigma points；
  - 任一非法 shape、空序列、越界值或非正 step count 都必须 fail closed。
- 强制：每个 Turbo step 执行 upstream `x + (1-sigma) * velocity` 预测，并在非末步以同一 request RNG renoise 到下一 sigma；解码输出与 Base/Edit 共用 VAE/postprocess，但 Turbo request batching 必须保持 `batch=1`，因为其额外 schedule/request args 不在现有 compatibility key 中。
- 验收：覆盖 explicit sigma normalization、default four-step schedule、predict/renoise step math、batch>1 rejection，以及 Turbo/Base 两条路径互不串用；真实质量结论仍需独立的 upstream-reference 与硬件 E2E 证据。^[PR #6699]

### [BOOGU-1f] 预量化 TorchAO FP8 只量化 DiT，且不走 online 量化

- 触发：修改 Boogu-Image 的 TorchAO/`torchao_float8_weight_only` 配置、transformer `quant_config`/layer prefix、pipeline 组件量化 scope，或官方 Base-fp8/Edit-fp8 checkpoint 加载。
- 强制：只支持加载已序列化的 TorchAO float8_weight_only checkpoint，不在运行时把 BF16/FP16 量化成 FP8。`quant_config` 与 fully-qualified prefix 必须传到可量化 `ReplicatedLinear`/`ColumnParallelLinear` 等层；量化范围隔离在 DiT transformer，不得波及 MLLM、VAE、scheduler。
- 验收：覆盖 serialized TorchAO config、shorthand、prefix 传播，以及 DiT-only scope；真实权重 smoke 另绑 checkpoint 与硬件。^[PR #6925]

## 决策与踩坑

- [BOOGU-1a] 禁止：覆盖 stage explicit revision，或只让一个 component 使用 global revision 而其余悄然跟 default branch。
- [BOOGU-1b] 禁止：Ascend complex path、swapped trig/pair layout，或 bitwise/broad platform/perf claims。
- [BOOGU-1c] 禁止：重排或省略 Edit 的 reference-aware negative branch；把 CFG2/CFG3 rank 负载混用；CFG-off 仍执行 negative branch；以 TP、SP、HSDP、cache 或 offload 组合宣称该合同已支持。
- [BOOGU-1d] 禁止：让 T2I/TI2I 共用 key、以首请求的 guidance mode 代表 edit batch、把 TI2I 作为已安全合批，或把不同 physical batch shape 的数值差异说成跨请求值泄漏或 serial-equivalence。
- [BOOGU-1e] 禁止：把 Turbo 混进 regular scheduler、接受 batched Turbo requests、从 mask/CFG state 猜测 sigmas，或把 few-step path 的通过外推到 Edit/Base quality parity。
- [BOOGU-1f] 禁止：宣称 online FP8；对序列化 `.bin`/`.pt` TorchAO 权重启用 multithread load；或因 shorthand 配置而量化非 DiT 组件。
