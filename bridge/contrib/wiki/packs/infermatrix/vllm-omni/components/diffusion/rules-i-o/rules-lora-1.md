---
name: rules-lora-1
description: Diffusion LoRA 规则（1/2）Direct 代码快速入口表与 DIFF-2l、2m、2n、2o：`--lora-backend` peft/distill 是 startup 配置、distilled delta `B @ A` 按 parameter 布局可逆合并与 alpha 折叠、Wan 双 transformer 按 [transformer, transformer_2] 位置绑定文件、LTX phase LoRA 由 recipe adapter_slot 切换
metadata:
  scope: 只收 LoRA 页的入口表、sources 清单与 startup/distilled 融合类规则 DIFF-2l、2m、2n、2o；request-time PEFT manager 与 LoRA linear 规则（DIFF-2ab、2x、2ae、2ag2、2ag3、2ag4）见 rules-lora-2，跨 component identity（DIFF-2f、2g）归 rules-component-lifecycle，SenseNova-U1.5 distilled 例外（SENSENOVA-1a）归 sensenova-u1-rules
---
# Diffusion LoRA 规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-lora.md` 的第 1/2 部分；第 2 部分 [[rules-lora-2]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-lora.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-10-09
- 来源（sources）：PR #2783；docs/user_guide/diffusion/lora.md；vllm_omni/config/omni_config.py；vllm_omni/config/stage_config.py；vllm_omni/diffusion/data.py；vllm_omni/diffusion/lora/loader.py；vllm_omni/diffusion/lora/manager.py；vllm_omni/diffusion/lora/layers/base_linear.py
  - vllm_omni/diffusion/models/qwen_image/pipeline_qwen_image.py；vllm_omni/diffusion/models/wan2_2/pipeline_wan2_2.py；vllm_omni/diffusion/models/wan2_2/pipeline_wan2_2_i2v.py；vllm_omni/diffusion/utils/tf_utils.py；vllm_omni/diffusion/worker/diffusion_worker.py
  - vllm_omni/engine/async_omni_engine.py；vllm_omni/entrypoints/cli/serve.py；tests/diffusion/lora/test_loader.py；tests/diffusion/lora/test_lora_manager.py；tests/entrypoints/test_async_omni_diffusion_config.py；PR #5500；vllm_omni/diffusion/models/ltx2/ltx2_adapter_parser.py
  - vllm_omni/diffusion/models/ltx2/ltx2_phase_adapter.py；PR #6070；PR #6476；PR #6550；vllm_omni/diffusion/models/minimax_h3/lora.py；PR #6268；benchmarks/kernels/benchmark_diffusion_lora_expand.py；tests/diffusion/lora/test_base_linear.py；PR #7195；PR #7349；PR #5907；PR #8008
- 置信度（confidence）：high
- 本页区分 request-time PEFT adapter 与 startup-time distilled weight fusion。跨 component identity 仍服从 [[rules-component-lifecycle]]（DIFF-2f/2g），模型专属 transformer 数量与顺序留在模型 owner。

### Direct 代码快速入口

| PR 描述在做什么 | 规则 | 第一批 live 源码 |
|---|---|---|
| `--lora-backend`、startup path/scale、deploy/CLI projection | `DIFF-2l` | `entrypoints/cli/serve.py` → `async_omni_engine.py`/stage config → `OmniDiffusionConfig` → `DiffusionWorker.init_lora_manager` |
| distilled merge、key conversion、packed QKV、alpha、unload | `DIFF-2m` | `diffusion/lora/loader.py` → pipeline mixin → transformer parameter |
| Wan dual transformer、high/low-noise file order、partial load | `DIFF-2n` | `WanLoraLoaderMixin` → `get_transformer_from_pipeline(name)` → `transformer`/`transformer_2` |
| LoRA linear active output slices、inference expand accumulation、autograd/dtype fallback | `DIFF-2ab` | `diffusion/lora/layers/base_linear.py::DiffusionBaseLinearLayerWithLoRA.apply` |
| legacy dynamic adapter hook、packed/stacked binding、DLO sidecar residency、activation rollback | `DIFF-2x` | `DiffusionLoRAManager::{_load_adapter,_bind_adapter_weights,_activate_adapter}` → model pipeline hook |
| PEFT deactivate/suspend、slice-mask resume、同 adapter+scale 再激活不 re-upload | `DIFF-2ae` | `DiffusionLoRAManager` deactivate/activate → `DiffusionBaseLinearLayerWithLoRA::{suspend_lora,resume_lora}` |

| 审查组 | 什么时候触发 | 规则 ID |
|---|---|---|
| `checkpoint-distributed` | diffusion LoRA backend、checkpoint、融合与 transformer mapping | `DIFF-2l`, `DIFF-2m`, `DIFF-2n`, `DIFF-2x`, `DIFF-2ae` |

### [DIFF-2l] backend 是 startup 配置，不是 request 字段

- 触发：增加 LoRA backend、CLI/deploy 字段、worker 初始化或 request adapter 路由。
- 强制：`peft` 保持默认，使用 `DiffusionLoRAManager` 的 cache 与 per-request `LoRARequest`；`distill` 必须同时有 startup `lora_path`，在模型加载后只调用一次 pipeline `load_lora_weights()`，融合结果在 server 生命周期内持续生效，普通请求不再携带 adapter。CLI → default/structured stage → diffusion projection → worker 必须保留 backend、path 与 scale；
  - stage 显式值优先于全局注入。
- 验收：CLI 正负测试覆盖 distill 无 path、PEFT 多 path、单/多 path 投影与 stage precedence；worker 测试分别断言 PEFT manager、distill 单次融合、unsupported warning。`lora_scale` 对 distill 完全不应用运行时 scale：大于 1 只 warning，小于等于 1 静默忽略；不得声称 scale 对 fusion 生效。config 类型同时出现 scalar/list 表述，扩展 list scale 前必须先统一 projection 与 worker 比较语义。
  - distill caller 还必须传具体 `.safetensors` 文件；目录或 Hub repo 没有 `weights_name`，当前调用链无法解析。^[PR #2783]

### [DIFF-2m] distilled delta 必须按真实 parameter 布局可逆合并

- 触发：修改 checkpoint key conversion、LoRA A/B/bias、packed parameter 或 load/unload。
- 强制：delta 为 `B @ A`，转到目标 parameter 的 device/dtype 后在 `no_grad` 下原位加；unload 必须用同一 state dict、key remap 与布局原位减回。`stacked_params_mapping` 的每个 source shard 都必须存在后才按目标 packed 顺序 concat，不能把缺 shard 当零。key remap 依声明顺序累积应用。
- Qwen 已是 Diffusers `lora_A/lora_B` 且带 `.alpha` 时，先把 `alpha/rank` 折进 B 并移除 alpha；alpha 缺 A/B 必须失败。non-Diffusers key 或其余带 alpha 格式再走 pipeline MRO 对应 converter；`.to_out.0` 等名称只在转换后映到树内参数。
- 兼容边界：融合发生在 `load_model()` 后，对 dense parameter 直接 `param.add_(B @ A)`；目标没有 TP/HSDP shard-aware delta，也没有量化 stored weight/scale 的合法 mutation 合同。因此当前可证明的 correctness envelope 仅为 dense、unquantized、TP=1；其他组合在宣称支持前必须增加 fail-closed compatibility check 或对应 shard/quantization-aware 实现。
- 验收：CPU 测试覆盖普通/bias/packed load、unload 精确恢复、累积 remap、non-unit alpha、缺配对 alpha 与 unknown key；真实 smoke 另需固定 adapter、模型 revision、sampling 参数与输出比较。当前 CPU evidence 使用 TP=1 `nn.Linear`；图片/视频附件是人工示例，没有 TP/HSDP/量化、自动质量阈值或性能测量，不能作为持续 correctness gate。^[PR #2783]
- 模型例外：SenseNova-U1.5 distilled adapter 是 startup-only exactly-one-file one-way fusion；它以 suffix/exact kohya mapping、fp32 delta 与 parameter `weight_loader` 做 TP sharding，zero-match fail，成功只留 sentinel，partial fuse 失败 abort/reload，不适用本规则的 unload/reversible contract。
  - 见 [[sensenova-u1-rules]]（SENSENOVA-1a；源锚点 #sensenova-1a-u15-distilled-lora-是启动期单文件单向融合）。^[PR #6516]

### [DIFF-2n] Wan 多文件必须逐位置绑定 architecture-declared transformer

- 触发：Wan 单/双 transformer pipeline 加载 distilled LoRA，或 boundary 部分加载。
- 强制：单 transformer architecture 只接受一个具体 `.safetensors`；`has_transformer_2` 声明的双 transformer architecture 必须按 `[transformer, transformer_2]` 位置提供等长文件列表（LightX2V 示例即 high-noise 在前、low-noise 在后）。getter 必须接收目标 attribute 名，不能每次都返回第一 transformer。即使 boundary 使其中一个 target 未实例化，仍要求两个 path；
  - 未加载 target 记录 warning 并跳过，已加载模块仍保存各自 state dict 供 unload。
- 验收：测试用不同 delta 断言两个 transformer 分别变化并在 unload 后恢复；覆盖文件数不匹配、单 transformer、多 transformer与缺失 target；high/low 顺序必须另用固定 checkpoint 的模型级语义/质量证据验证。目标单测覆盖双 transformer 的 load/unload，但没有真实 Wan checkpoint 数值或视频质量自动 gate。^[PR #2783]

### [DIFF-2o] LTX phase LoRA 必须绑定 recipe 并复用单一 Transformer

- 触发：LTX 多阶段 pipeline 需要在同一 Transformer 上加载官方 raw safetensors refinement LoRA，或需要区分普通两阶段与 merged distilled 两阶段的权重路径。
- 强制：以 recipe 的 `adapter_slot` 作为唯一 phase switch；普通两阶段使用 `None → ltx_distilled`，full-distilled 两阶段不得加载 LoRA。Sidecar 先查 model root，再按 profile 的官方文件名和仓库回退到 Hub；parser 必须逐一校验 A/B 配对、映射结果、重复目标和 shape。Adapter wrapper 要在 base 权重加载前安装并 remap 到 `base_layer`，保留 Row/Column/QKV 的 rank-local TP slice；
  - 未量化 BF16 使用 adapter dtype 中的 layer-fused `B@A`，量化 base 使用 dynamic LoRA。
- 验收：覆盖官方 key mapping、缺失 A/B、unmapped/duplicate target、dynamic 与 fused 精确算术、Row/Column/QKV 本地切片、base 权重不变、phase 进入/退出和 finalize 时机；同时验证 generic `model_paths` sidecar 覆盖与 model-root/Hub fallback。^[PR #5500]

## 决策与踩坑

- [DIFF-2l] 禁止：把 `lora_backend` 写入 PEFT request 的 dead `extra_args`；让 serve CLI 接受多个 PEFT startup path；把 distill 描述成可逐请求切换或 LRU cache。pipeline 没有 `load_lora_weights` 时当前只 warning 并以未修改 base weights 继续，是 fail-open capability gap，不能声称任意 diffusion pipeline 已支持。
  - 直接 config 仍可能把多 path 送到只接受单 path 的 PEFT manager，CLI 校验不能冒充所有入口的通用门禁。
- [DIFF-2m] 禁止：静默丢弃非单位 alpha；只验证已消费 key 数却不比较恢复后的 base weight；把 warning 的 unmatched keys 当严格成功。当前 loader 对 partial/zero-match key 都只 warning 并继续，是 fail-open gap，审查时必须核对目标模块集合和实际 applied-key count。
- [DIFF-2n] 禁止：用远端目录加硬编码文件名猜 checkpoint；把两个文件都融合到 `transformer`；从 T2V/I2V mixin 接入外推 VACE/S2V 或所有 registry Wan 变体支持。loader 只信任 caller 顺序，无法从文件内容结构性识别 high/low 是否颠倒。
- [DIFF-2o] 禁止：为 phase adapter 增加第二个 resident Transformer 或 LTX 专用环境变量；允许 request/static LoRA 与内部 phase adapter 组合；在非 BF16 或量化 base 上声称 layer-fused 可用；对缺失配对、未映射模块或不匹配 shard 静默跳过。
