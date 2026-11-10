---
name: rules-lora-2
description: "Diffusion LoRA 规则（2/2）DIFF-2ab、2x、2ae、2ag3、2ag4 与已退役的 DIFF-2ag2：LoRA linear expand 的 in-place addmm 条件、DiffusionLoRAManager 专用 loader hook 与 activation 事务化及 DLO sidecar 放置、deactivate 用 suspend_lora/resume_lora、默认只扫描 transformer/transformer_2/unet、任一未绑定 module 即 ValueError（PR #8008 取代零绑定规则）"
metadata:
  scope: 只收 request-time PEFT/dynamic LoRA 的 manager、layer 与 binding 规则；DIFF-2ag2 已被 DIFF-2ag4 取代，放在历史；入口表与 startup/distilled 规则 DIFF-2l 至 2o 见 rules-lora-1
---
# Diffusion LoRA 规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-lora.md` 的第 2/2 部分；第 1 部分 [[rules-lora-1]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-lora.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-02；updated: 2026-10-09
- [DIFF-2ab] LoRA linear expand 只能在原输出 slice 上作受限的 inference 累加
  - 触发：修改 `DiffusionBaseLinearLayerWithLoRA.apply()` 的 stacked/packed LoRA shrink-then-expand 路径、其 active-slice 跳过、输出 slice，或为该路径做 kernel/temporary-allocation 优化。
  - 强制：保留 fully-sharded LoRA 与 `tp_size > 1` 的 `NotImplementedError`，直到 shrink 与 expand 之间实现所需 all-gather。将 `x`/base output 展平后，按 `output_slices` 的累计 `offset` 处理每一 slice；inactive 或空 A/B slice 也必须推进 offset，且 slice metadata 与 A/B stacks 长度不一致必须失败。
    - 对 active nonempty slice 先算 `buffer = x_flat @ A.t()`，再以 `torch.addmm(y_slice, buffer, B.t(), out=y_slice)` 直接累加 expand，**仅当** grad mode disabled 且 `y_slice`、`buffer`、`B` 三者 dtype 完全相同。
  - 强制：grad mode enabled 或任一上述 dtype 不同，必须保留 functional `y_slice[:] = y_slice + buffer @ B.t()`，以维持 autograd 和 output dtype 语义；最终返回的 shape 必须恢复为 base output 的原 shape。
  - 验收：CPU regression 覆盖 packed multi-slice 的数值结果与每个 active slice 的 in-place `addmm`、inactive/empty slice 后的 offset、fully-sharded+TP rejection、autograd backward 时不调用 `out=`，以及 mixed output/LoRA dtype 的 functional fallback。性能证据仅可用固定 shape/dtype/rank、warmup 与 iteration 的 CUDA microbenchmark；
    - PR evidence 是 H100 上 BF16 packed synthetic expand 的 latency/extra-allocation 和 numerical-parity 测量，不替代上述 correctness cases。^[PR #6268]
- [DIFF-2x] legacy dynamic manager 的模型专用 loader 与 activation 必须 fail-closed 且事务化
  - 触发：修改 `DiffusionLoRAManager` 的 request-time adapter load/bind、模型专用 loader hook、packed/stacked target，或 DLO 下 dynamic sidecar 的 device placement/reallocation。
  - 强制：先让 pipeline 的可选 loader 识别并返回其模型拥有的 `(LoRAModel, PEFTHelper)`，仅在其返回 `None` 时走既有 generic PEFT fallback；专用 loader 的 artifact、target 和全局 A/B shape 必须在 wrapper mutation 前完成校验。manager 必须记录实际绑定的 logical weights，模型 validator 证明完整覆盖；packed QKV/FFN 等布局由模型明确声明或转换，不由共享 manager 猜测。
  - 强制：activation fast path 只可在 active ID 与 scale 都匹配时跳过。首次 mutation 前清除 active ID；任一 `set_lora()` 或 binding validator 异常都 reset 所有 wrapper slot 并保持 inactive，不能保留混合权重或陈旧 fast-path 状态。
  - 强制：DLO owns base-weight streaming only。DLO-enabled manager 在 wrapper replacement 时必须要求可用的 resident-buffer protocol、将 request-switchable A/B sidecars 放在 compute device，且 wrapper 因更大 rank 重新分配后必须重放该 device placement；缺 protocol fail closed。非 DLO path 不得获得此 placement side effect。
  - 验收：CPU regressions 覆盖 model hook/fallback、binding completeness、mid-loop failure 后 reset 与旧 adapter retry；DLO mock 覆盖 replacement 的 compute-device placement、缺 resident protocol 的 fail-closed 以及 rank-driven reallocation 后 A/B buffer 仍在该 device。
    - 模型 integration 另覆盖 artifact identity、target/shape rejection、packed QKV/FFN binding 和实际 request sampling contract。^[PR #6476] ^[PR #6550]
- [DIFF-2ae] PEFT 去激活必须 suspend 切片掩码并保留 uploaded 权重
  - 触发：修改 `DiffusionLoRAManager` 的 deactivate/activate、`DiffusionBaseLinearLayerWithLoRA` 的 active-slice mask，或混合 base/adapted 请求切换路径。
  - 强制：deactivate 只 `suspend_lora()`（保存并清零 `_diffusion_lora_active_slices`），保留 stacked A/B；同一 adapter_id 与同一 rounded scale 再激活时 `resume_lora()` 复原掩码，禁止整层 `reset_lora`+rebind。`_suspended_adapter_id` 在真实 reset、rank 驱动的 `create_lora_weights`、新 bind 开始、以及 remove 被 suspend 的 adapter 时必须清空；
    - 不同 adapter 或不同 scale 仍走完整 rebind。
  - 验收：CPU 覆盖 suspend/resume、同 id+scale 不 re-upload、不同 scale/id 走 rebind、remove suspended 触发 reset、中途失败后 inactive，以及 add_adapter 后新 layer 不被错误 resume。^[PR #7195]
- [DIFF-2ag3] LoRA/ModelOpt 默认只保留通用组件名与通用 fused 映射
  - 触发：修改 `DiffusionLoRAManager` 默认扫描组件、ModelOpt `DEFAULT_PACKED_MODULES_MAPPING`，或 pipeline/model 的 `_lora_components` / `_dit_modules` / `packed_modules_mapping`。
  - 强制：manager 默认只扫描通用 diffusers 名 `transformer`、`transformer_2`、`unet`；模型专用属性（如 Bagel 的 `bagel`）必须由 pipeline 经 `_dit_modules` 或 `_lora_components` 声明。ModelOpt 默认只保留通用 attention 融合（`to_qkv`、`add_kv_proj`）；模型专用融合（如 Z-Image `w13`）必须写在模型 `packed_modules_mapping` 并由 adapter 合并。
  - 验收：Bagel/同类测试 pipeline 必须显式 `_lora_components` 才能发现层；Z-Image 映射在模型侧声明后仍可解析；去掉声明后不得靠框架默认偷跑。^[PR #5907]
- [DIFF-2ag4] 任一未绑定 module 的 diffusion LoRA adapter 必须失败
  - 触发：修改 `DiffusionLoRAManager._bind_adapter_weights` / `_activate_adapter`、fused/packed `lora_b` 切分，或把部分命中当成成功激活。
  - 强制：无论 pipeline 是否提供 binding validator，都必须无条件记录实际命中的 logical module 名；激活前证明 adapter 提供的每个 logical module 都已绑定；`bound_lora_names` 为空、或 `loras` 中仍有未绑定名，一律 `ValueError`，消息含 adapter id、`bound=k/n`、unbound 名和 expected target modules。
    - fused-QKV / packed `output_slices` 对不上 `lora_b` 维度时立即 raise，不得 warning 后 `reset_lora` 并继续。空 adapter（`bound=0/0`）同样失败。稀疏 packed 目标（只供 Q 或 Q/V）在**已提供模块全部绑定**时合法，未提供的 slice 保持 `None`。失败必须走既有 activation cleanup：reset wrapper、清 active/suspended 身份。
  - 验收：CPU 覆盖 unmatched 名、empty adapter、fused shape mismatch，以及从 active/suspended 切失败后的 rollback 与旧 adapter 再激活；packed 路径覆盖 Q、Q/V、Q/K/V 三种 name form。^[PR #8008]

## 决策与踩坑

- [DIFF-2ab] 禁止：用 `out=` 路径绕过 autograd/dtype fallback，漏掉 inactive/empty slice 的 offset，或把目前的 fully-sharded+TP rejection 伪称为支持。不要新增 stride/contiguity predicate 来选择该 fast path，也不要把此处的 synthetic microbenchmark 扩大为任意 strided output、完整 diffusion model 或 server throughput 的性能承诺。
- [DIFF-2x] 禁止：将已识别的专用 artifact 悄悄退回 generic loader；按名称而非真实绑定确认成功；将一个模型的 packed layout/scale 规则泛化给所有 diffusion 模型；失败后继续声明旧 adapter active；把 sidecars 加入 DLO host shards/collective，或靠每 block transfer 伪装为 DLO support。
- [DIFF-2ae] 禁止：把 suspend 当成可丢弃的 upload；resume 覆盖后注册的新 layer 的 inactive mask；在失败 bind 后仍保留旧 suspended 身份。
- [DIFF-2ag3] 禁止：把 `dit`/`bagel`/`w13` 等模型私有名硬编码进共享默认；在未扫描真实 denoiser 时宣称 adapter 已生效（零层绑定、输出等同 base）。
- [DIFF-2ag4] 禁止：只拒绝零绑定却放行部分绑定（例如 `attn.to_out` 命中而 `attn.to_out.0` 被忽略）；把 fused 布局失败写成可跳过 warning；在部分 bind 后仍标 adapter active。

## 历史

- [DIFF-2ag2] 绑定零层的 diffusion LoRA adapter 必须失败而不是静默 no-op
  - 触发：修改 `DiffusionLoRAManager._bind_adapter_weights` / `_activate_adapter`、binding 记账，或 pipeline 可选 `_validate_diffusion_lora_binding` hook。
  - 强制：无论 pipeline 是否提供 binding validator，绑定过程都必须无条件记录实际命中的 module 名；`bound_lora_names` 为空时立即 `ValueError`，错误信息同时列出 expected target modules 与 adapter 收到的 module 名。既有 activate 的 try/except 必须 reset 全部 wrapper 并保持 inactive，不得留下“已激活但等于 base”的状态。
  - 禁止：仅在有 validator 时才记账；让零绑定激活返回成功或只打 DEBUG；把 diffusers 命名 checkpoint 对不上 engine layout 的情况当成有效 adapter。
  - 验收：CPU 回归用故意不匹配的 `target_modules` 断言激活抛错、消息含收到的模块名、active id 仍为 `None` 且无 `set_lora`；有 validator 的模型路径仍覆盖完整 binding completeness。^[PR #7349]
  - 退役记录：kb:rule status=retired retired_at=r2026-10-09 reason=superseded evidence="PR #8008" superseded_by=DIFF-2ag4
