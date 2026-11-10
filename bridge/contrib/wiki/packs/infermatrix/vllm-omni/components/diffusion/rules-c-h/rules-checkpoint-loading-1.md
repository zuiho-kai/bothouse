---
name: rules-checkpoint-loading-1
description: Diffusion checkpoint/加载/量化规则（1/2）DIFF-2a、2b、2c、2d、2e：weight mapper remap 追到真实 consumer、HSDP/FSDP 真实 fully_shard、component quantization namespace 与 AutoRound MXFP、host-weight artifact identity、distributed layerwise offload（DLO）AllGather/no-AllGather 分片合同
metadata:
  scope: 只收 checkpoint-distributed 审查组的 DIFF-2a 至 DIFF-2e 与本页 sources 清单；DIFF-2p 及之后见 rules-checkpoint-loading-2，多 DiT component lifecycle（DIFF-2f 至 2j）归 rules-component-lifecycle，DLO DP wave admission（DIFF-2k）归 rules-output-lifecycle-1
---
# Checkpoint、加载与量化合同（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-checkpoint-loading.md` 的第 1/2 部分；第 2 部分 [[rules-checkpoint-loading-2]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-checkpoint-loading.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-04；updated: 2026-09-08
- 来源（sources）：PR #5087；PR #5088；PR #5136；PR #5544；PR #5677；PR #5737；PR #5764；PR #5802；PR #5836；PR #5839；PR #5848；PR #5872；PR #5910；PR #6070；PR #6162；PR #6234；PR #6279；PR #6445；PR #6486；PR #6591；PR #6651；PR #6573；vllm_omni/diffusion/model_loader/
  - vllm_omni/diffusion/model_loader/diffusers_loader.py；vllm_omni/quantization/；vllm_omni/quantization/component_config.py；vllm_omni/quantization/factory.py；vllm_omni/quantization/svdquant_config.py；vllm_omni/diffusion/distributed/hsdp.py
  - vllm_omni/diffusion/distributed/parallel_state.py；vllm_omni/diffusion/offloader/；tests/diffusion/model_loader/test_diffusers_loader.py；tests/diffusion/offloader/test_distributed_layerwise_backend.py；tests/diffusion/quantization/test_svdquant_config.py
  - tests/diffusion/quantization/test_svdquant_linear.py；tests/diffusion/quantization/test_svdquant_tp_loading.py；tests/diffusion/quantization/test_wan_autoround_mxfp4.py；PR #5531；PR #6722；PR #4061；PR #6925
- 置信度（confidence）：high
- `checkpoint-distributed` 审查组的 `DIFF-2a`–`DIFF-2s`：checkpoint remap、HSDP/FSDP 分片、component quantization、artifact identity、distributed layerwise offload，以及在线量化加载与权重布局。触发条件与其余审查组见 [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（Diffusion 共享规则） 的 Direct 代码快速入口。
- [DIFF-2a] checkpoint remap 必须追到已注册且真实消费的目标
  - 触发：增加或修改 weight mapper、scale 名称、quantization adapter 或 key resolution。
  - 强制：从序列化 key 追到目标 layer 注册的 parameter/buffer 和 forward consumer；多条 resolution path 必须返回对称、由合同解释的目标名。模型专属 grouped-QKV reorder、fused gate/up split 等布局变换必须在调用 active weight loader 前完成，让 quantization wrapper 与 TP shard 接收最终语义布局。
  - 验收：测试覆盖已消费 key、未知 key、当前版本不支持的 scale 以及两条 resolution path 的输出名；fused mixed-FP8 还须覆盖 weight/scale/shard、gate/up 顺序、nested serialized FP8 和 combined projection，缺 shard 不得默认 0。 ^[PR #5087] ^[PR #5737] ^[PR #5848]
  - 强制：读取 transformer-local `config.json` 时，disk method 与 active method 归一化后不一致必须失败；disk 声明 serialized、`data_type=mx_fp` 或不同 `ignored_layers` 时应按该 component 重建 config，不能用 online/default 配置解释 serialized 权重。目标 pin 的 `resolve_quant_config_from_disk` 只有 Wan2.2 一个 live caller，且无 helper 直测；
    - 在补齐多模型 caller 与 mismatch/serialized/ignored-layers 测试前，这只是局部 loading guard，不是全局自动 checkpoint reconciliation 支持。^[PR #5839]
- [DIFF-2b] HSDP/FSDP 修复必须执行真实 fully_shard
  - 触发：改动 diffusion HSDP/FSDP 参数过滤、packed/scalar parameter 或 DeviceMesh。
  - 强制：至少用单 rank Gloo + CPU DeviceMesh 执行一次真实 `fully_shard`。
  - 验收：普通 float parameter 变为 DTensor；packed uint8/scalar parameter 保持本地 identity，并覆盖 loader 的真实调用边界；replicate size 非正值拒绝，1 用 1D、>1 用 2D DeviceMesh，测试 world size 与参数一致。 ^[PR #5088] ^[PR #5872]
- [DIFF-2c] component quantization 独立解析且 namespace 端到端一致
  - 触发：diffusion pipeline 为 text encoder、transformer、VAE 等组件增加独立量化配置。
  - 强制：每个组件独立解析量化配置，并选择一个端到端一致的 namespace：要么 selector 保留 `text_encoder` 等完整 component owner prefix 到持权 layer，要么 pipeline 先 resolve 单一 component，再让内部 layer 使用 component-relative prefix。只量化明确支持的 linear，embedding、LM head、patch/final projection 等排除项必须显式保持未量化。
  - 强制：`ComponentQuantizationConfig.resolve()` 只对 `get_quant_method` 收到的 runtime prefix 做 longest-prefix match，未命中才落到 default；它不会自动感知 checkpoint `WeightsMapper`。因此 mapper、pipeline 与 layer 必须显式维持同一 namespace，并测试重叠 prefix 的最长匹配。
  - 强制：离线 AutoRound checkpoint 若 `config.json` 以 `data_type="mx_fp"` 声明 MXFP，`resolve_quant_config_from_disk()` 必须用 checkpoint 的 `bits`（或现有 config 的 `weight_bits` fallback）重建量化 config，使 4-bit 与 8-bit 路径都由真实位宽选择；不能把这种 metadata 当作只有 serialized flag 才会触发的 online/default config。
    - Wan runtime prefix 的 `block_name_to_quantize=["blocks"]` 必须只命中 `blocks.*` 的 linear，并保留 `condition_embedder.*` 等范围外层未量化。
  - 验收：至少覆盖“只量化一个组件、其他组件保持 BF16”的真实构造与加载，逐层断言命中/排除集合，并验证 meta-device parameter 不会被提前 move。FLUX.2 的具体边界见 [[flux2-rules]]（FLUX.2 规则），component-relative 变体见 [[minimax-h3-rules-1]]、[[minimax-h3-rules-2]]、[[minimax-h3-rules-3]]（MiniMax H3 规则）；
    - 新增 quantization×offload 组合需给兼容矩阵，未验证 quantizer fail-closed，并核对 dtype/shape/stride。 ^[PR #5136] ^[PR #5737] ^[PR #6279] 对 AutoRound MXFP4，构造 Wan config 后用 runtime `WanTransformer3DModel` 配置量化层，断言 packed mapping identity、`blocks.*` 的 MXFP4 method dispatch 与范围外 non-quantized control；
    - 再以 XPU B60 的 Wan2.1 离线 T2V smoke 验证成功响应、5×256×256 帧形状和非零帧方差。这只证明 PR #5544 的离线 Wan2.1/XPU case；PR body 提到的 FLUX.1-dev 示例及任何 online/serving/backend 兼容性均未由合入 diff 的测试覆盖，不得扩展为支持声明。^[PR #5544]
- [DIFF-2d] Artifact identity 只信任已验证的不可变来源
  - 触发：新增或修改 host-weight artifact、warm restore、source identity、layout/dtype policy。
  - 强制：共享 identity、restore 和 model ABI 保持 representation-neutral，dtype/layout 只属于具体 policy/producer；只有同时验证 source kind、snapshot revision、repo topology 和 blob 位置的内容寻址仓库，才可用 blob 名代替内容哈希，其他本地文件和 symlink 必须按内容定身份。
  - 强制：node-local canonical-source digest cache 只能是 metadata-validated 的哈希工作复用；路径、inode、size、timestamp、symlink target 或 cache-record checksum 任一不符即重算，cache I/O/coordination 失败也必须直接哈希 canonical source。它不改变 identity 内容、artifact selection 或 fallback policy。
  - 验收：第二种 synthetic representation 复用共享 identity/restorer；任意本地十六进制命名 symlink 在同大小内容被替换后产生不同 identity；合法 Hub snapshot→blob 拓扑仍走受控快捷路径。^[PR #6445]
- [DIFF-2e] distributed layerwise offload 只能选择一个一致的权重分片合同
  - 触发：新增 `enable_distributed_layerwise_offload`、`dlo_use_allgather`、模型 `OffloadPlan` 或 block discovery。
  - 强制：明确 rank 本地 CPU shard、固定双 GPU buffer、H2D/AllGather stream 和模型 block list 的 owner；`dlo_use_allgather=false` 保留 standard loader 已生成的每-rank ready-to-run layout（没有其他分片维度时才是 full weight，TP 下则是 TP-local shard），开启 AllGather 时不得再叠加已 DTensor-sharded 的 HSDP 参数。
    - 共享 output buffer 可按所有 hook 的最大 block 分配，但每个 hook 调 collective 前必须按 dtype 截成自己的 `_ag_output_sizes[dtype] == dp_size * local_shard.numel()` 前缀；block-flat-relative repoint offset 只能在这段实际 block buffer 内解释。
  - 强制：AllGather 权重组复用既有 topology：DP>1 优先 DP group；DP=1 且 SP>1 才用 SP group。TP 不作为 DLO AllGather group；进入 mmap path 时 TP>1 必须因绕过 TP-aware weight-loader callback 而拒绝。no-AllGather 只关闭 DLO 新增的权重 collective，不关闭 standard loader 已建立的 TP/HSDP/SP 语义，也不提供跨 rank host-weight 节省。
    - DP=SP=1 不能从“无 process group”推断为可用的 rank-local AllGather 模式：目标 pin 的 loader 在 DLO+AllGather、支持 mmap 时会跳过 `load_weights()`，但 backend 只有 `dp_size>1` 才执行 mmap load，两个 gate 不一致；修复并回归前单 rank 应使用 no-AllGather 或普通 layerwise offload。
  - 强制：非 DiT component 的 staging 必须由 `OffloadPlan` 显式声明：encoder block group rank-local streaming 不借用 DiT AllGather group，on-demand component 由 pipeline 在真实 encode/decode stage 成对 load/offload，resident layer 只对声明的 DiT path 生效。no-AllGather 路径保留 standard loader 产生的 TP-local layout；
    - 若模型 loader 还做 QKV/MLP transform，mmap 必须显式 opt out，直到 transform-before-shard 等价性有测试。
  - 验收：CPU/Gloo 单 rank 覆盖 DTensor wrapper、shard padding、双 buffer 和 disable cleanup；配置测试覆盖 AllGather+HSDP 的明确失败及 no-AllGather 的允许路径。另以至少两个不同 block size 验证 small/large hook 都满足 collective size equality、重建权重和 repoint。当前回归用 mocked collective 检查 8/32-element、dp=2 合同；
    - 没有真实 multi-rank collective 覆盖，PR 的 8×NPU H3 E2E 说明也缺少已填写的 commit 证据，不能升级为验证结论。 ^[PR #5802] DLO DP collective-wave admission 见 [[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（DIFF-2k）；no-AllGather 的 TP-local request 不得误走 fused batch。
    - 文档 compatibility matrix 中 “accepted” 默认只代表配置/源码 guard；
    - PR #5836 的 predecessor partition-path commit 为 H3 USP4+HSDP4+no-AllGather+8 resident layers 提供一次 4×H100、3/3 completion/perf run，故该 exact 组合不再是纯 config evidence，但没有 ordinary-offload 数值/输出质量对照，且 profiler 开启、final repo-root modular route 未复测，仍不得升级为 production support。
    - TP+no-AllGather、一般 DP+SP 等其他组合仍缺完整 model×hardware E2E。^[PR #5764] ^[PR #5839] ^[PR #5836]
- 多 DiT component discovery 与 dotted-path lifecycle 合同见 [[rules-component-lifecycle]]（DIFF-2f–2j 专页）。

## 决策与踩坑

- [DIFF-2a] 禁止：把 producer 有而当前 consumer 不支持的 tensor 静默过滤；必须 fold/map 或 fail fast，并在错误中标明依赖的 upstream 版本边界。
- [DIFF-2b] 禁止：只断言传给 mock 的 kwargs 后声称分布式语义已覆盖。
- [DIFF-2c] 禁止：半途裁掉 owner prefix；resolve component 后又要求 ignored layer 带 owner；用一个组件配置隐式覆盖其他组件；因为同属一个模型就量化全部 linear。
- [DIFF-2d] 禁止：因 symlink 目标名看似 40/64 位十六进制就假设不可变；把 `bf16`、具体 layout 或首个 producer 名写进共享 identity/restorer API；用进程内 inode/mtime guard 代替跨启动身份校验。
- [DIFF-2e] 禁止：用 heuristic 找不到 block 时静默假装 offload 已启用；对 HSDP 参数二次分片；把 CPU 内存、AllGather 同步和设备显存开销隐藏在一个泛化的 `enable_cpu_offload` 开关；把 max-sized shared buffer 原样交给较小 block 的 `all_gather_into_tensor`。
