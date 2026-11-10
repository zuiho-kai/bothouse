---
name: flux2-rules
description: "FLUX.2 规则 FLUX2-1a…FLUX2-1d：Mistral text encoder FP8 保留 text_encoder 前缀、meta 初始化与 CPU offload 边界、transformer online FP8 到达两类 block 而 outer projection 保持 BF16、text_encoder_out_layers 是 checkpoint 属性（PR #5136 / #3027 / #6390），附代码入口表"
metadata:
  scope: 只收 FLUX2-* 规则与其代码入口表；FLUX.2 的 owner 范围归 flux2-overview，FLUX.2-Klein 的 HWR 规则归 flux2-klein-rules，SP padding 规则归 rules-sp-padding
---
# FLUX.2 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/flux2/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-07-20；updated: 2026-09-05
- 来源（sources）：PR #4645；PR #5136；vllm_omni/diffusion/models/flux2/flux2_transformer.py；PR #5910；PR #3027；PR #6390；vllm_omni/diffusion/models/flux2/pipeline_flux2.py；tests/model_tests/diffusion/diff_model_builders.py
- 置信度（confidence）：high
- 只有 `FLUX2-数字字母` 是可审计规则 ID。

### Direct 代码快速入口

| PR 描述信号 | 规则组 | 第一批源码 |
|---|---|---|
| FLUX.2 pipeline/transformer | FLUX2-1b、FLUX2-1c | `diffusion/registry.py::_DIFFUSION_MODELS["Flux2Pipeline"]` → `diffusion/models/flux2/pipeline_flux2.py::Flux2Pipeline`、`flux2_transformer.py::Flux2Transformer2DModel` |
| Mistral text encoder、FP8、component namespace | FLUX2-1a | `diffusion/models/mistral_encoder/` → component quantization selector/loader |
| meta parameter、CPU offload、BF16 baseline | FLUX2-1b | FLUX.2 component loader/materialization 路径 → `Flux2Pipeline` |
| SP auto-padding、`mask_sp_padding`、dense/varlen | [[rules-sp-padding]]（SPPAD-1a；源锚点 #sppad-1a-padding-mask-是显式正确性性能策略不是无损优化） | Flux2 `_sp_plan` → forward context → `hidden_states_mask` → attention |
| text encoder hidden-state 层、`text_encoder_out_layers`、prompt embedding 宽度 | FLUX2-1d | `pipeline_flux2.py::Flux2Pipeline.__init__` → `encode_prompt` → `__call__` → Mistral encoder |

- FLUX.1 和 FLUX.2-Klein 不自动归到本页；必须由描述/registry key 明确命中对应 owner。

### [FLUX2-1a] Mistral text encoder FP8 保留 component namespace

- 触发：为 FLUX.2 Mistral text encoder 增加或修改在线量化。
- 强制：`text_encoder` 量化配置独立于 transformer/VAE 解析，完整 `text_encoder.language_model...` 前缀一路到 component selector；只向 attention/MLP 的 weight-bearing linear 传量化配置。
- 验收：text-encoder-only FP8 下 transformer/VAE 保持 BF16，目标 linear 被量化，embedding/head 未量化，TP 构造与加载均通过。 ^[PR #5136]

### [FLUX2-1b] meta 初始化与 CPU offload 分别守住加载和资源边界

- 触发：FP8 参数从 meta device 初始化，或单卡加载保留 BF16 transformer。
- 强制：未物化参数不得提前 `.to(cuda)`；CPU offload 作为避免瞬时/峰值 OOM 的资源前提，在 baseline/candidate 对称启用并在质量 case 旁说明。
- 验收：meta parameter 完成量化物化后再迁移；运行与测试完全一致的 10-step case，LPIPS 阈值由该 case 直接产生。 ^[PR #5136]

### [FLUX2-1c] transformer online FP8 必须到达两类 block，外层 projection 保持 BF16

- 触发：修改 FLUX.2 transformer 的 online FP8 构造、`quant_config`、block prefix 或量化覆盖范围。
- 强制：将同一 online `quant_config` 传给每个 `Flux2TransformerBlock` 与 `Flux2SingleTransformerBlock`，并使用稳定的 `transformer_blocks.<i>` 与 `single_transformer_blocks.<i>` prefix 供 component selector 匹配；`x_embedder`、`context_embedder` 与 `proj_out` 保持普通 BF16 `nn.Linear`。
- 验收：用 dynamic `Fp8Config` 构造小模型，分别枚举两类 block 的 config 与 prefix，并断言三个 outer projection 仍是 `nn.Linear`。 ^[PR #3027]

### [FLUX2-1d] 选择的 Mistral hidden states 是 checkpoint 属性，不是请求参数

- 触发：修改 `Flux2Pipeline` 的 prompt encoding、`text_encoder_out_layers`、Mistral config，或 FLUX.2 tiny-model builder 的 encoder/transformer geometry。
- 强制：构造期从 `text_encoder.config.text_encoder_out_layers` 读取并固化为 pipeline 实例的 tuple；旧 checkpoint 没有该字段时只回退到 `(10, 20, 30)`。`encode_prompt` 及正/负 prompt 的 `__call__` 路径都必须使用同一实例值，把选出的 hidden outputs 按既有顺序拼接，并保持结果宽度与 transformer `joint_attention_dim` 一致。
- 验收：tiny builder 使用 3 个 text-encoder layers、`[0, 1, 2]` 和 `joint_attention_dim=96`；离线 `Flux2Pipeline` 的 text-to-image、determinism 和 multi-output 三个子测试通过。该 PR 未运行“无 config 字段”的完整尺寸 checkpoint，故 legacy fallback 的 full-size 行为仍是源码合同，不应写成已完成的 full-model 验证。 ^[PR #6390]
- 共享 component-quantization 合同见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion rules）；加载器 upstream 边界见 [[upstream-api-drift-loading-1]]、[[upstream-api-drift-loading-2]]（loading drift）。

## 决策与踩坑

- [FLUX2-1a] 禁止：量化 embedding 或 LM head；裁掉 `text_encoder` 前缀后再匹配；因为 transformer 未量化就把 text encoder 配置清空。
- [FLUX2-1b] 禁止：把 offload 当成 FP8 质量收益；用不同 step 数或加载条件验证测试阈值。
- [FLUX2-1c] 禁止：用仅适用于 serialized/ModelOpt checkpoint 的 safety config 覆盖 double-stream block，从而关闭 online FP8；或因同属 transformer 就量化上述三个 outer projection。PR 历史中的早期 H20 benchmark 来自已删除实现，不得当作当前 main 的性能或质量证据。
- [FLUX2-1d] 禁止：从 request `extra_args` 或 `encode_prompt`/`__call__` 参数在推理时覆盖层集合；模型是在特定抽取层上训练的，Diffusers 的可传参数不改变这个 FLUX.2 checkpoint contract。也不得只缩小 text encoder 层数却不同时缩小选择列表或 `joint_attention_dim`。
