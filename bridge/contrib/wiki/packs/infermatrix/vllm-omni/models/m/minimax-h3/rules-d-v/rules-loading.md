---
name: rules-loading
description: MiniMax H3 加载规则：MMH3-1a component namespace 与 FP8/INT8 loader 顺序、MMH3-1f text encoder eager load 的 source shard 完整性、MMH3-1k global FP8 覆盖文本解码器、MMH3-1l 直接 mmap 的 loader adapter 证明、MMH3-1n final-layout restore 的 dtype-neutral contract、VLLM-OMNI-PR8801-H3-NATIVE-PARTITION 本地 native 分区优先于 modular 标记
metadata:
  scope: 只收 checkpoint 加载、量化 prefix 与 host-weight/mmap 合同；decoded video 与媒体输入归 rules-media-1、rules-media-2，DLO 部署与容量证据归 rules-deployment-1、rules-deployment-2，encoder cuDNN 状态归 rules-encoder-state
---
# MiniMax H3 加载规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-loading.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-10-23
- 来源（sources）：PR #5706；PR #5737；PR #5824；vllm_omni/diffusion/models/minimax_h3/encoder.py；vllm_omni/diffusion/models/minimax_h3/minimax_h3_transformer.py；vllm_omni/diffusion/models/minimax_h3/pipeline_minimax_h3.py；tests/diffusion/models/minimax_h3/test_minimax_h3_contract.py；PR #5910；PR #6213
  - PR #6445；PR #6486；PR #8801
- 置信度（confidence）：high
- [MMH3-1a] component namespace 与 checkpoint transform 必须在 active loader 前闭合
  - 触发：修改 H3 online FP8 覆盖范围、`ignored_layers`、linear prefix、QKV/MLP checkpoint 变换或 TP loader。
  - 强制：pipeline 先把 structured quantization config 解析到 `transformer` component，再构造 DiT；因此内部 prefix 是 `blocks.*`、`token_refiner.*` 等 component-relative 名称，不带 `transformer.`。每个 eligible linear 显式传 prefix/quant config，patch、timestep、final projection 显式保持非量化。
    - grouped-QKV reorder 与 fused `fc1` gate/up split 在 `MiniMaxH3DiTModel.load_weights()` 先完成，再调用当前 parameter 的 active weight loader，让 TP shard 与 FP8 `online_process_loader` 看到最终布局。
  - 验收：枚举默认 quantized/full-precision prefix 集合，逐个验证 exact ignored leaf；QKV 与 gate/up sentinel 断言传给 active loader 的顺序和 shard id，至少覆盖 TP 与 online FP8。^[PR #5737]
  - NPU INT8 online 同样复用 component-relative prefix 与 active loader：BF16 checkpoint 在逐层 load 完成时 dynamic quantize，text encoder、VAE 和非 eligible projection 保持未量化；`ignored_layers` 必须能用 fused owner 名（如 `blocks.0.attn.qkv_proj`）精确跳过。
    - NPU `QuantBatchMatmulV3` 的 65535 output 限制只按 per-partition width 判断，超限 layer 回退 `UnquantizedLinearMethod`，更高 TP 可能让同一层重新满足 INT8。^[PR #5706]
- [MMH3-1f] text encoder eager load 必须证明每个 source shard 完整
  - 触发：修改 H3 Qwen3-VL text encoder 的 checkpoint 映射、QKV/gate-up fused loader、保留层集合，或 pipeline 对 eager component 的 loaded-name 上报。
  - 强制：按实际 fused module 预置 expected source 集合，并按 shard id 分别记录 q/k/v 与 gate/up；缺单个 source、整组零 source 或任何 plain retained parameter 都在启动时 `RuntimeError`。pipeline 只有在 encoder 自身完成此验证后，才可把其全部 parameter 上报给 runner strict check；额外 unknown checkpoint key 可告警跳过，因为不会留下 model parameter 未初始化。
  - 验收：distinct sentinel 数值逐段核对 q/k/v（含 GQA 非等宽）与 gate/up 行布局；分别覆盖每个 source 缺失、整组缺失和 plain parameter 缺失。真实 checkpoint 的 index/name coverage 可证明映射覆盖，但未执行真实完整加载时，不能声称 shape/dtype/full-load 已回归；本改动本身未改变 shape/dtype handling。
    - 共享 fused-loader 门禁见 [[rules-loader-contract]]（EXEC-2b；源锚点 #exec-2b-fused-shard-必须按-source-完整性与布局数值闭环）。^[PR #5824]
- [MMH3-1k] H3 global FP8 必须覆盖可量化文本解码器并拒绝预量化 encoder 配置
  - 触发：修改 MiniMax-H3 的 `quantization="fp8"`、`diffusion-quantization-config`、Qwen3-VL text encoder linear 构造或其 checkpoint quantization safety filter。
  - 强制：H3 的 plain/global FP8 配置同时提供给 DiT 与已暴露为 `LinearBase` 的 Qwen3-VL text decoder；显式 `transformer`/`text_encoder` component map 只量化指定组件。eligible attention/MLP linears 使用 online FP8，vision tower、embedding、norm、RoPE、VAE 及模型指定 FP32 projection 保持 checkpoint precision；
    - text encoder 仅允许 online FP8，BF16 encoder 必须剥离不兼容的 serialized ModelOpt/pre-quantized 配置。
  - 验收：覆盖 global、DiT-only、text-encoder-only 与组合配置，断言各组件实际 quant method、未量化边界和 runtime prefix；serialized FP8 必须拒绝，ModelOpt config 必须从 BF16 text encoder 移除而保留 online FP8；text encoder fused shard/load contract 继续通过。^[PR #5910]
- [MMH3-1l] H3 直接 mmap 必须由 loader adapter 证明布局等价
  - 触发：修改 MiniMax H3 的直接 checkpoint mmap、grouped-QKV 布局转换、custom `weight_loader`、TP 边界或 DLO loader/backend 交接。
  - 强制：由 `DiffusersPipelineLoader` 预检完整的 DiT source coverage、runtime/checkpoint key、shape、dtype、TP topology 与 loader compatibility，并把唯一的 `HostWeightPlan` 交给 DLO；H3 grouped-QKV 的直接 mmap 变换由 loader-side adapter 声明，在 bounded block packing 时执行，普通 loader 路径仍须在 active weight loader 前完成原有 reorder/split。
    - TP=1 才允许该 direct-mmap plan，TP>1、HSDP、online quantization、缺失/未知 custom loader 或 metadata 不匹配必须在模型 mutation 前回退 ordinary loader。
  - 验收：adapter sentinel 验证 grouped-QKV 输出顺序且目标 parameter 不携带 mmap transform；preflight 覆盖 TP/HSDP/online quantization、缺 key、shape/dtype mismatch 与未适配 custom loader，并断言回退发生在 mutation 前；exact plan transfer 与 direct-mmap/ordinary-loader 两条路径分别完成 H3 权重完整性检查。^[PR #6213]
- [MMH3-1n] H3 final-layout restore 必须由 dtype-neutral model contract 校验混合精度
  - 触发：MiniMax H3 参与 final-layout host-weight artifact 的 identity/restore，或修改 `MiniMaxH3DiTModel` 构造后的 dtype invariants。
  - 强制：`MiniMaxH3DiTModel` 必须声明 dtype-neutral 的 `FinalLayoutModelContract`，固定 schema、`implementation_id` 与 version，并提供 `validate_restored_host_weights()` 在 exact tensor restore 提交后重新执行 H3 的混合精度不变量校验；BF16 只属于具体 artifact policy/producer，模型 contract 不得绑定 BF16 表示。
  - 验收：contract test 断言 `vllm-omni.diffusion.final-layout-tensors-v1`、`minimax-h3-dit`、版本与 validator；reduced MiniMax H3 真实 ownership 同时覆盖 BF16 tensor、模型要求的 FP32 tensor 和 persistent buffer，并在 one-shot restore commit 后执行 validator；
    - 另以 exact identity、tensor coverage 与 source-change guard 覆盖失败时不变更模型。^[PR #6445]
  - H3 的该 contract 当前只为 BF16 no-AllGather DLO final-layout consumer 接通：artifact identity 区分 TP rank/size 与 SP layout，等价 DP replicas 才共享；TP/SP/layout/model revision 改变时必须以 `preferred` 重新产生 artifact，`required` 只消费 exact hit。它不扩大 direct checkpoint mmap、online quantization 或 AllGather 的支持范围。^[PR #6486]
- [VLLM-OMNI-PR8801-H3-NATIVE-PARTITION] 本地 MiniMax-H3 判定必须让 native 分区布局优先于 modular 标记文件
  - 触发：修改 `vllm_omni/model_executor/models/minimax_h3/checkpoint.py` 的 `is_minimax_h3_modular`、`_NATIVE_PARTITIONS`、`resolve_minimax_h3_model_root`/`resolve_minimax_h3_diffusion_model_path`，或本地 checkpoint 的 native/FastH3 modular 判定顺序。
  - 强制：本地目录必须先按 native 分区判定——`FL2VA/model_index.json` 或 `Ref2VA/model_index.json` 存在即判 native（返回 `False`），之后才检查 `modular_model_index.json`/`fastvideo_inference.json` 标记。依据是官方 `MiniMaxAI/MiniMax-H3` 仓库会在根目录同时携带 `modular_model_index.json` 与 `FL2VA/`/`Ref2VA/` 分区，而 FastH3 modular release 没有分区；
    - 误判会让 pipeline init 因找不到 `fastvideo_inference.json` 抛 `FileNotFoundError`。native root 下 encoder resolver 必须返回 `FL2VA/text_encoder`，diffusion resolver 返回 `FL2VA`。Hub ID 走独立分支，不受该本地目录判定影响。
  - 验收：`tests/diffusion/models/minimax_h3/test_fasth3_checkpoint.py` 必须同时覆盖混合根 case（`FL2VA/`+`Ref2VA/`+`modular_model_index.json` 判为 native，且两个 resolver 返回分区路径）与对照 case（仅空分区目录加 modular 标记仍判为 modular），并保持既有 FastH3 本地与 Hub 检测测试全部通过。^[PR #8801]

## 决策与踩坑

- [MMH3-1a] 禁止：用 parent prefix 代替 exact leaf `ignored_layers`；一边已 resolve component、一边仍要求 `transformer.`；在 linear 构造后包掉 active loader，或把 reorder/split 放到 FP8 wrapper 之后。
- [MMH3-1f] 禁止：任一 source 命中后用 fused target name 宣称完整；只 warning 后保留 `torch.empty` 行继续执行；把 encoder 的完整性保证外推给同样 eager 构造、但尚无等价验证的 video/audio VAE。
- [MMH3-1k] 禁止：把 H3 global FP8 描述成 DiT-only，或据此自动量化任意普通 `torch.nn` encoder；把 serialized FP8/ModelOpt scale 配置直接交给没有对应 checkpoint 参数的 BF16 text encoder；为 H3 另造一套绕过 vLLM factory 的 FP8 method。
- [MMH3-1l] 禁止：用 `_supports_mmap_loading` 等 pipeline capability flag 或 parameter-attached transform 代替 adapter proof；让 backend 重扫 checkpoint、重建 runtime name 或绕过 H3 active loader；把 TP>1 ordinary-loader fallback 描述成 shared-mmap host-memory optimization。
- [MMH3-1n] 禁止：用 dtype 字符串代替版本化 model ABI；遗漏 persistent buffer 或模型要求保留的 FP32 parameter/buffer；把 contract 声明或 validator 存在误认为 loader 已启用、DLO 已接入或 artifact 已具备跨拓扑性能保证。
- [VLLM-OMNI-PR8801-H3-NATIVE-PARTITION] 禁止：仅凭 modular 标记文件存在就把含分区的本地快照判成 FastH3 modular；把没有 `model_index.json` 的空分区目录当作 native 证据；改动判定顺序时影响 Hub ID 分支或破坏既有 FastH3 本地/Hub 检测语义。
