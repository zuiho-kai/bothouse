---
name: rules-checkpoint-loading-2
description: Diffusion checkpoint/加载/量化规则（2/2）DIFF-2p、2q、2s、2t、2u、2v、2y、2z、2aa、2af：HSDP 识别 online FP8、LTX revision 与 transformer_full、在线量化 + layerwise offload 物理布局、DLO AllGather online quant allowlist、parallel_state FS/RP 清理、SANA-WM Stage-1 布局、safetensors index shard manifest、final-layout HWR、SVDQuant NVFP4、TorchAO .bin index
metadata:
  scope: 只收 DIFF-2p、2q、2s、2t、2u、2v、2y、2z、2aa、2af；DIFF-2a 至 2e 见 rules-checkpoint-loading-1，LoRA 相关的 DIFF-2l 至 2o 归 rules-lora-1，HSDP pre-sharded 加载（DIFF-HSDP-LOAD-1a）归 rules-hsdp-weight-loading，FLUX.2-klein 的 HWR validator（FLUXK-1a）归 flux2-klein-rules
---
# Checkpoint、加载与量化合同（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-checkpoint-loading.md` 的第 2/2 部分；第 1 部分 [[rules-checkpoint-loading-1]]
- 源页：`knowledge/repos/vllm-omni/components/diffusion/rules-checkpoint-loading.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, diffusion；created: 2026-09-04；updated: 2026-09-08
- [DIFF-2p] HSDP/FSDP2 必须同时识别 legacy 与 online FP8 linear method
  - 触发：修改 diffusion HSDP/FSDP2 参数准备、online FP8 quantization method 或非连续权重布局处理。
  - 强制：同时识别 `Fp8LinearMethod` 与 `Fp8PerTensorOnlineLinearMethod`；当 FP8 权重是转置形成的非连续 view 时，先将底层 `(out, in)` row-major storage 替换为 contiguous weight 供 FSDP2 接受，再让 kernel 的 `_get_layer_params` 返回对应转置 view，且同一 kernel 只 patch 一次。
  - 验收：legacy 与 `Fp8PerTensorOnlineLinearMethod` 都覆盖 regression test，断言重写层数、weight contiguous、`(out, in)` shape，以及 kernel 返回的转置 view shape/stride；另按 HSDP/FSDP 规则执行真实 `fully_shard` 验证。^[PR #5677]
- [DIFF-2q] LTX checkpoint profile 必须贯穿 revision 与 transformer 子目录
  - 触发：新增 LTX checkpoint/version profile、Hub `revision`、Full/Distilled transformer 配置或组件加载路径。
  - 强制：显式 `model_version` 优先于结构启发式；`revision` 必须贯穿 metadata detection、prefetch、tokenizer、全部组件、transformer config/weight source、scheduler 和 post-process sample-rate；LTX-2.5 Full/SFT 使用 `transformer_full`，distilled 与旧版本使用 `transformer`，并在缺少 Gemma4 时提示 `transformers>=5.10.1,<5.15`。
  - 验收：固定 revision 的 converted/official split 链路逐项断言所有 loader 调用和输出 metadata；用两个 transformer config marker 验证 Full 子目录选择，覆盖 local/HF、legacy/distilled/Full profile 及缺失 encoder 版本错误。^[PR #6070]
- [DIFF-2s] 在线量化加载与 layerwise offload 必须保留物理权重布局
  - 触发：修改在线/runtime quantization 与 layerwise offload、DLO 权重加载、非连续 FP8 权重 flatten/repoint 或加载后处理流程。
  - 强制：在线量化层必须在消费完对应 checkpoint weight 后才可流式移回 CPU，并跳过已完成层的重复 `process_weights_after_loading`；继续加载其他模型权重前释放可复用的量化缓存。对非连续权重按物理 storage 顺序打包，记录 `shape`、`stride` 和实际 storage span，并在普通 layerwise、DLO prefetch 与 resident replay 中用 `torch.as_strided` 重建；runtime-created FP8 与 DLO 组合必须使用 no-AllGather 路径。
  - 验收：CPU/mock 测试验证普通 layerwise、DLO prefetch 和 resident replay 的值与 stride 均保持，覆盖不同 storage span、streaming 顺序、已处理层跳过与缓存释放；online FP8 + DLO AllGather 必须 fail fast，no-AllGather 路径须完成加载并通过对应输出/资源 smoke。^[PR #5910]
- 相关执行流见 [[diffusion-architecture]]（Diffusion architecture）；component lifecycle 见 [[rules-component-lifecycle]]（component lifecycle 规则）。
- [DIFF-2t] DLO AllGather 只允许已验证的 online quant 布局
  - 触发：修改 DLO+AllGather 与在线量化的兼容门禁、普通 loader fallback，或 FP8/INT8/MXFP8 权重与 scale 的分片重建。
  - 强制：真实 DLO weight collective（effective group size > 1）只允许 `Fp8PerTensorOnlineLinearMethod`、`Int8OnlineLinearMethod`、`NPUInt8OnlineLinearMethod`，以及模块可导入时的 `NPUMxfp8OnlineLinearMethod`/`VllmMxfp8OnlineLinearMethod`；
    - 必须先由普通 loader 完成 runtime weight/scale finalization，再按物理 storage 顺序分 dtype 打包，并按记录的 shape、stride 重建。effective group size=1 不执行 collective，因此不应用该 allowlist；direct checkpoint mmap/HWR 不生成这些 runtime layout，其他 online method 在真实 AllGather 下全部 fail closed。
  - 验收：loader 测试必须证明 allowlist 分支确实执行、普通 loader 在 DLO 前完成权重与 scale 处理、group=1 跳过门禁，并对未验证 method fail fast；DLO 测试逐类验证 weight/scale 的 dtype、值、shape 与 contiguous/转置 stride 重建。PR #6573 只有 mock collective/unit layout 覆盖，没有真实 multi-rank online-quant DLO E2E；
    - 补齐该 smoke 以及固定模型、硬件、checkpoint、workload 的输出质量/性能对照前，不得升级为端到端 parity 声明。PR 中 B300 H3 默认测试也未启用 DLO/online quant，不能充当该组合证据。^[PR #6279] ^[PR #6573]
- [DIFF-2u] diffusion 并行状态必须保持单一拓扑所有权并原子清理
  - 触发：修改 diffusion `parallel_state`、HSDP/FSDP2 `DeviceMesh`、SP/CFG/PP group、VAE patch parallel 或并行状态初始化与销毁。
  - 强制：`RankGenerator` 只表达真实正交的 TP/SP/PP/CFG/DP 轴；HSDP 不得作为额外轴。仅当 `use_hsdp` 时，在 post-#5531 atomic initializer 中建立 fully-sharded FS（连续 rank run）与 replica RP（同 shard position）group，并公开其 local rank；先验证 shard degree 为正且整除 WORLD，再创建任一 group。VAE tile parallel 直接从 WORLD 选 rank；
    - 初始化失败必须清理本次 diffusion 与 vLLM 组，销毁时清空 FS/RP 及 vLLM `_PP` 等引用。
  - 验收：覆盖 HSDP standalone、HSDP+SP/CFG、非法 zero/non-divisible shard size 在任何 group 创建前失败、FS/RP construction 与 teardown、重复初始化和销毁后重初始化；断言失败后无残留组，vLLM `_PP` 被置空，并以真实 multi-rank CPU/Gloo smoke 验证 collective topology。^[PR #5531] ^[PR #6722]
- [DIFF-2v] SANA-WM Stage-1 checkpoint 必须保持标准 Diffusers 布局
  - 触发：新增或修改 SANA-WM Stage-1 的 checkpoint resolution、Diffusers component source、HF download allow-pattern、transformer config/weight loading，或尝试直接接入 NVLabs 原始发布布局。
  - 强制：运行时只消费离线转换的标准 Diffusers 树：`model_index.json` 必须解析为 `SanaWmPipeline`，并同时提供 `transformer/config.json`、`transformer/diffusion_pytorch_model.safetensors`、`vae/config.json` 和 `vae/diffusion_pytorch_model.safetensors`；
    - 从 transformer config 构造 `SanaWmConfig`，Stage-1 download pattern 只包含这组必要文件，refiner 不进入该路径。
  - 验收：local path 与 HF snapshot 都验证上述文件、`model_index.json` class 和 transformer config 读取；weight loader 对 unknown/duplicate/shape mismatch fail fast 并由 strict coverage 检查 expected keys；Stage-1 smoke 证明不下载/初始化 refiner，旧 layout 只能在显式且兼容的 class override 下运行。^[PR #4061]
- [DIFF-2y] Diffusers component index 必须是唯一的 shard manifest
  - 触发：修改 Diffusers component 的 safetensors index resolution、Hub/cache download、subfolder path、`allow_patterns` 或本地 checkpoint discovery。
  - 强制：没有显式 `allow_patterns_overrides` 时，先在 local path 或配置的 Hub cache/remote 解析 component-local index；保留 `subfolder`、`revision`、`cache_dir` 和 offline `local_files_only` 语义。唯一 index 的非空 `weight_map` 是唯一权威 shard manifest：只下载并加载去重、稳定排序后的其中文件，且任何缺失 shard 都失败。
    - 没有 index 时，必须拒绝同一 shard family 出现冲突的 `of-N` totals。
  - 验收：覆盖 local、online 与 offline-cache index resolution，断言 revision/cache/subfolder 透传、只选择 manifest files 且缺文件失败；再覆盖显式 override、无 index 的冲突 shard totals 拒绝，以及顺序无关的 manifest selection。^[PR #6234]
- [DIFF-2z] final-layout HWR 只能接入 eligible no-AllGather DLO
  - 触发：修改 Diffusers loader 的 host-weight runtime selection、final-layout producer/restorer、`HostWeightPlan`，或 DLO loader/backend handoff。
  - 强制：在 import、source preparation、identity/store construction 和 observer event 之前完成 mode/DLO/no-AllGather eligibility gate；disabled、DLO-disabled 和 AllGather 保持既有 checkpoint-mmap 或 ordinary-loader 路径且零 HWR interaction。
    - eligible warm hit 必须跳过 ordinary DiT materialization，plan/commit 后把 exact final-layout tensors 作为 rank-local DLO source；preferred miss 才 canonical load 并 post-load publish，required 对 miss 或 incompatible artifact fail startup，不能借 producer bootstrap。
  - 强制：eligible warm HWR hit 的 registered transport 只在 `pin_cpu_memory` 开启时尝试，先对完整 page-aligned mapped ranges 做 read-only capability 与可选 per-worker budget preflight；成功后直接从 immutable final-layout mmap copy 到既有 HBM buffers，且不分配 private staging。
    - unsupported、budget exceeded 或已完整 rollback 的 registration failure 必须回到既有两槽 bounded staging；AllGather、checkpoint mmap 和全部 zero-interaction gates 不得尝试 registration。该路径不减少 H2D payload，也不是 GPU 直接访问 host memory。
  - 验收：覆盖所有 zero-interaction gates、preferred hit/miss、required miss、mixed/dedicated source rejection、warm path zero ordinary DiT materialization，以及 shared finalization 前后 restored tensor byte/backing-pointer equality；验证 checkpoint mmap control path 不变。
    - 另覆盖 registration capability/budget/pin-memory gates、partial registration rollback、direct/staged transfer parity、没有 staging allocation 的成功路径，以及 teardown 前 unregister。
    - FLUX.2-klein 的 consumer-owned validator 与范围边界见 [[flux2-klein-rules]]（FLUXK-1a；源锚点 #fluxk-1a-final-layout-hwr-必须恢复可立即使用的-bf16-klein-transformer）；该接入复用共享 HWR/DLO 协议，不扩大协议本身。^[PR #6486] ^[PR #6591] ^[PR #6651]
- [DIFF-2aa] serialized SVDQuant 只能按 NVFP4 checkpoint ABI 加载
  - 触发：修改 `quant_method="svdquant"` 的 diffusion checkpoint 解析、NVFP4 kernel 选择、SVDQuant parameter 创建/加载、TP shard，或尝试扩展其 dtype、GPU 或 component 范围。
  - 强制：factory 必须从 transformer 的 serialized `quantization_config` 构造 SVDQuant config；Phase 1 只接受 positive `rank`、`precision="nvfp4"` 和 signed BF16 activation。每个 TP-local input width 必须能被 16 整除；
    - 加载 `qweight`、`wscales`、`proj_down`、`proj_up`、`smooth_factor`、`wcscales` 和 `wtscale` 时保持其 input/output shard axis。base GEMM 只能复用 ABI-compatible FlashInfer、CUTLASS 或 FBGEMM NVFP4 kernel；原 activation 走 BF16 low-rank correction，只有 base GEMM 使用 smoothed activation；
    - 可选 per-output `wcscales` 在 base output 上逐 channel 应用后再加 correction，以保留 fused Q/K/V 的独立 outer scale。`get_quant_method()` 对非 `LinearBase` 必须返回 `None` 让 embedding/LM-head 等使用 upstream fallback，只有被 skip 的 eligible linear 返回 `UnquantizedLinearMethod`。
    - 没有 serialized scale 或 correction tensors 的 encoder/audio component 必须保持 BF16，不能从 transformer config 隐式继承 SVDQuant。
  - 验收：mock/config tests 覆盖 config rejection、skip list、canonical tensor shape/dtype、compatible-kernel rejection、BF16 base-plus-correction numerical path，以及 Column/Row/QKV TP sharding；GPU 证据还必须在 exact checkpoint、backend、device、seed 和 quality workload 上比较真实 kernel 输出。
    - 当前合入测试未执行真实 kernel 或 released checkpoint E2E，故仅证明 loader contract；PR review 所要求的 frozen-head BF16-vs-SVDQuant quality/performance comparison 没有随本提交提供。^[PR #6162]
- [DIFF-2af] Diffusers loader 在无 safetensors index 时才解析 `.bin` TorchAO 清单
  - 触发：修改 `diffusers_loader` 的 index discovery、`pt_weights_iterator`、TorchAO serialized checkpoint 路径，或 `allow_patterns_overrides` 与 load-format 选择。
  - 强制：无显式 override 时先解析 safetensors index（`diffusion_pytorch_model.safetensors.index.json` / `model.safetensors.index.json`），仅当二者都缺失才解析 `diffusion_pytorch_model.bin.index.json`。
    - 命中序列化 TorchAO（`quant_config.get_name()=="torchao"` 且 `is_checkpoint_torchao_serialized`）且非 safetensors 时，用自然序排序的 `pt_weights_iterator` 加载；safetensors 路径保持原 multithread/safetensors 合同。
  - 验收：覆盖 safetensors 优先、bin index fallback、自然序 shard、TorchAO iterator 选择与非 TorchAO 负向对照。^[PR #6925]

## 决策与踩坑

- [DIFF-2p] 禁止：只检查 legacy `Fp8LinearMethod`、把非连续 transpose view 直接交给 `fully_shard`，或因新版 online method 已被识别就宣称所有 FP8 method 和布局均兼容。
- [DIFF-2q] 禁止：按路径名识别版本；只给 config lookup 传 revision 而让权重加载回到 HEAD；用 `transformer/config.json` 解释 Full checkpoint；把 transient metadata/Hub 异常静默降级为 LTX-2 并宣称 profile 已确定。
- [DIFF-2s] 禁止：对转置 Cutlass FP8 weight 使用逻辑 `.flatten()` 后再 `.view(shape)`，丢失物理布局；为调用幂等处理而把已量化 CPU 层重新搬回 accelerator；把 runtime-created FP8 宣称支持 sharded DLO AllGather。
- [DIFF-2t] 禁止：把该 allowlist 扩展到未经验证的在线量化方法；绕过普通 loader 直接 mmap 在线量化权重；丢失非连续权重的物理 stride；将 transient 完整模型 host memory 峰值描述为运行时常驻开销。此前 DIFF-2s 对所有 runtime-created FP8 的 AllGather 禁止由本规则收窄覆盖。
- [DIFF-2u] 禁止：把 HSDP shard 当作 `RankGenerator` 的乘法维度；在非 HSDP 路径创建或查询 FS/RP；用 global rank 取代 group-local rank；在校验失败前分配 communicator，或清理后保留已销毁的 pipeline/FS/RP state。
- [DIFF-2v] 禁止：用运行时 YAML parser、原始 NVLabs key remap、layout sniff 或宽泛下载模式弥补不兼容的 checkpoint；把命名为 `SanaWmTwoStagesPipeline` 的旧两阶段 repo 当作当前 Stage-1 registry 自动发现成功，或静默跳过缺文件、未知/重复/shape 不符权重。
- [DIFF-2y] 禁止：因离线模式跳过已缓存 index、重复拼接 subfolder、用宽泛 glob 混入 snapshot 的陈旧 shard，或让目录枚举顺序决定 loader 行为。显式 override 是最高优先级选择，不能被 index 悄然改写。
- [DIFF-2z] 禁止：把 preferred 当成对 identity/configuration/compatibility error 的宽泛 fallback；让 HWR warm restore 重走 ordinary DiT loader、checkpoint mmap 或 byte-changing finalization；把 no-AllGather 的 rank-local staging 扩展成跨 rank collective 或 generic HWR support。
- [DIFF-2aa] 禁止：在 model load 时 calibration/conversion；接受 FP16、unsigned activation、非-NVFP4 precision 或不兼容 forced kernel 后延迟到首个 forward 才失败；把 compatibility path 描述为 fused GEMM+correction，或把 SM103 之外的 GPU、其他 checkpoint layout、质量/性能结果写成已验证支持。
- [DIFF-2af] 禁止：让 `.bin` index 抢在 safetensors 之前；对序列化 TorchAO `.bin` 开 multithread；或把该路径当成任意 PyTorch bin checkpoint 的通用 loader。
