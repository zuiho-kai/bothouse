---
name: rules-deployment-2
description: MiniMax H3 部署与证据规则（下）：MMH3-3f RTX PRO 6000 的 2/4/8 卡 T2VA scaling、MMH3-3g Ascend mask-free 的 HBM 与 E2E 数字、MMH3-3h RTX PRO 5000 recipe、MMH3-3i online FP8 与 layerwise/DLO 组合及 stride、MMH3-3j DLO host-weight plan 的 TP=1 direct mmap、MMH3-3k VAE decoder tile 不足 rank 时 rank-local decode、MMH3-3l 直接 VAE 调用的 residency window、MMH3-3m H100_2 merge lane
metadata:
  scope: 只收 MMH3-3f 至 MMH3-3m；DLO stage 配对、consumer GPU、H100 DFX、ROCm 与 GB10 证据归 rules-deployment-1；VAE eager ops 与 keyframe encode 归 rules-vae-ops
---
# MiniMax H3 部署与证据规则（2/2）

## 关键事实

- 拆分说明：本页是源页 `rules-deployment.md` 的第 2/2 部分；第 1 部分 [[rules-deployment-1]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-deployment.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-09-05
- [MMH3-3f] RTX PRO 6000 scaling 只绑定单机 T2VA 协议
  - 触发：引用 2/4/8×RTX PRO 6000 latency、96 GiB capacity、TP/Ulysses scaling 或 device order。
  - 强制：证据只绑定 YLX Y762、8×96 GiB、driver 580.105.08/CUDA 13.0、BF16/CUDNN_ATTN、1344×768、5 s、50 steps、seed 1101、两次 warmup、单请求、默认 device order/no NUMA binding。2/4/8 GPU 分别 TP2×USP1/2/4，E2E 284.76/172.32/90.48 s，1 Hz `nvidia-smi` peak 77.49/66.44/61.07 GiB/GPU；这些不是 allocator high-water。^[PR #5863]
  - 验收：新 topology 记录实际 rank groups、device order、warmup、stage/E2E、per-rank peak 与 joint output/quality；每个 topology 当前仅两次 warmup 后测一个请求，无 repeats/variance。recipe-only diff 无自动回归，4/8 GPU scaling 和首次请求 19% 慢均为单机观察。SM120 显式 CUDNN 合理，因为 target TRTLLM auto-default 只覆盖 compute major 10；
    - 这不构成其他 SM120 backend 的比较证据。
- [MMH3-3g] Ascend mask-free 数字只绑定报告的 H3 packed workload
  - 触发：引用 NPU quadratic mask churn、packed varlen/Laser latency、A3 HBM 或 H3 mask-free E2E。
  - 强制：memory snapshot 只绑定报告的 T2VA packed S=63232、约 100 attention/step×50 steps：旧 `full_qk` 行产生 3.72/14.90 GiB transient mask、累计 45.6 TiB allocation churn，并使 57 GiB reserved 中约 33.7 GiB 成为 idle segments；这是 profiler observation，不是所有 shape 的 allocator 定律。
    - single-kernel 20-iteration average 只覆盖 USP8 per-rank 的四个 T/N/D shape，最大一行 63232/7/128 为 170.8→90.6 ms；per-call peak 18.86→0.44 GiB。^[PR #5891]
  - 强制：E2E 数字只绑定 8×Ascend 910、batch1/BF16/50 steps/flow shift12/24 FPS、USP8/Ring1/HSDP8/TE-TP8/VAE tile-patch8、768p、每格两次均值。varlen→Laser 分别是 T2VA 10 s 450→337 s、FL2VA 8 s keyframe 316→244 s、Ref2VA 5 s video+audio 642→473 s；Laser+Cache-DiT 的 226/143/249 s 是叠加另一机制，不归因本 PR。
    - recipe 另报 DLO 下 Ref2VA 13.88 s input→15 s 1344×768 output 约 45 GB/device；不能与 HSDP E2E topology 合并成同一 capacity/perf case。
  - 验收：复现必须补 exact source commit、immutable environment/image、Atlas/Ascend SKU、输入 artifact/prompt/seed、warmup、逐 run raw headers/logs、all-rank memory 与 same-seed output metric。PR body 引用的 `server_test/{fl2va,ref2va}` scripts 不在 commit，raw profiler/benchmark artifact 也未提交；
    - 其 output video 只覆盖 Ref2VA Laser case，不是数值 quality gate。后续仍需 same-seed E2E comparison 和重抓 snapshot 证明 churn/reserved 实际下降。^[PR #5891]
- [MMH3-3h] RTX PRO 5000 recipe 的 topology 与证据必须逐 workload 绑定
  - 触发：引用 2/4/8×72 GiB RTX PRO 5000 的 H3 capacity、latency、device order 或 DLO/resident 推荐。
  - 强制：2 卡只绑定 TP1×Ulysses2、rank-local no-AllGather DLO、20 resident layers、TE-TP2、VAE patch2、CUDNN/eager；4 卡绑定 TP2×Ulysses2/TE-TP4/VAE4，8 卡 production 推荐绑定 TP4×Ulysses2/TE-TP8/VAE8，后二者 resident 且不加 eager。物理 GPU ID 只是已测双 NUMA/PCIe host 的映射示例，复现必须先按 `nvidia-smi topo -m` 重建同等 group locality。
  - 验收：只把最终 recipe 表内 T2VA 与 first-frame FL2VA 的单 host、单请求、固定 shape/frames/steps observation 作为有界证据：PyTorch 2.11+cu130、CUDA 13、driver 580.95.05、1344×768、124 frames、50 requested→49 denoise updates。
    - 2/4/8 卡推荐路线的 T2VA E2E/denoise/per-update/external peak 分别为 515.57/504.69 s/10,300 ms/36.38 GiB、284.01/278.73 s/5,688 ms/67.58 GiB、163.20/159.40 s/3,253 ms/45.83 GiB；first-frame FL2VA 分别为 553.45/541.90 s/11,059 ms/36.38 GiB、305.72/299.85 s/6,119 ms/67.58 GiB、171.62/167.25 s/3,413 ms/45.83 GiB。
    - final recipe 写两次 warmup，但 PR body 只明确绑定 4/8 卡，因而 2 卡 warmup 范围不能视为已澄清；没有 repeat/variance、immutable image/source/checkpoint pin 或可复核 quality artifact，且 PR 只有 markdown/pre-commit。review 明确 Ref2VA 未测试，因此 `MODEL=Ref2VA` 重启说明只是配置建议。
    - 重测仍须记录 exact image/SHA、rank groups、NUMA policy、all-rank peak 与 artifact/quality。^[PR #5857]
- [MMH3-3i] H3 online FP8 的 layerwise/DLO 组合必须限界并保持 stride
  - 触发：MiniMax-H3 同时启用 online FP8 与普通 layerwise offload、distributed layerwise offload、resident layers 或 transposed Cutlass weight replay。
  - 强制：online FP8 可以与 resident/no-offload、普通 layerwise offload 以及 DLO full-weight per-rank no-AllGather 路径组合；DLO 启动必须使用 `--dlo-no-use-allgather`，保留 standard loader 生成的物理布局，并在 streaming、prefetch、resident replay 中保存和恢复真实 stride。
  - 验收：H3 contract 覆盖 resident、普通 layerwise、DLO no-AllGather 与 no-offload 的启动/输出路径；online FP8 + DLO AllGather 在 loader 边界明确报错；转置权重回放逐值核对 stride，并分别记录 exact GPU、shape、steps、checkpoint 和 all-rank 资源结果。^[PR #5910]
- [MMH3-3j] H3 DLO host-weight plan 必须限界在 TP=1 direct mmap
  - 触发：MiniMax H3 启用 DLO、`dlo_use_allgather`、direct checkpoint mmap、resident layers，或调整 DiT 与 text encoder 等 component 的 host storage。
  - 强制：loader 只把 dedicated DiT sources 纳入 `HostWeightPlan`，其他 text encoder 等 source 继续由 ordinary component loader 加载并参与 strict coverage；AllGather 且有效 DLO group 大于一时仅复制 rank-local persistent shard 后释放 mmap handle；
    - rank-local/no-AllGather 保留 file-backed checkpoint views，并以两个按最大 block 限定的 pinned host staging slots 逐块打包；有效 group size 为一时即使 `dlo_use_allgather=True` 也不得执行 collective。direct mmap 只适用于 TP=1、非 HSDP、非 online quantization 的已证明布局。
  - 验收：覆盖 dedicated/mixed source、strict non-DiT loading、AllGather shard 与 handle release、rank-local source retention、双 staging slot 上界、group size one 无 collective、TP>1 ordinary-loader fallback 及 unsupported-platform 不能静默丢弃 plan。
    - PR 的 DP=2/TP=1 no-AllGather 与四 GPU topology smoke 只证明报告的 H3 配置和输出/资源观察；TP=2 行证明的是 ordinary-loader fallback，不是 shared-mmap memory guarantee。^[PR #6213]
    - PR #6555 adds a separate ready smoke for TP=1/DP=2 DLO with two concurrent T2VA requests, but its server arguments do not include `--dlo-no-use-allgather`; do not use it to widen this rule's no-AllGather/direct-mmap claim.
      - Its reported local B300 pass is limited runtime evidence for that exact request workload, while the H100_2 YAML entry remains collection/configuration intent until the lane result is available. ^[PR #6555]
- [MMH3-3k] H3 VAE decoder 的 tile 不足 rank 时必须进入 rank-local decode
  - 触发：MiniMax-H3 修改 decoder tile 切分、`vae_patch_parallel_size`、parallel state，或低分辨率 preview/smoke 测试可能产生少于 tile group rank 数的 decoder tile。
  - 强制：`decode_latent` 必须按 latent shape 乘 `vae_ratio` 转为 pixel-space，并使用 checkpoint 的 decoder `split_tiles(..., True)` 计算 tile 数。
    - 当 `parallel_size > 1` 且 tile 数更少时，所有 rank 必须一致进入 `_rank_local_tiling`，将 checkpoint parallel state 设为 rank-local（`group_size`/`sp_size=1`、rank 为 0、process group 清空、parallel disabled）并将 `parallel_tiling=False`，使每个 rank 解码全部 tile；tile 数足够时保留并行路径，退出时完整恢复原状态。
  - 验收：CPU 回归必须实际调用 `decode_latent`，覆盖 decoder tile count 1、2、4、28、112 及 2/4、4/4、2/2、`parallel_size=1` 边界，断言 decode 观察到的 rank-local state，并验证正常与异常退出恢复完整 group state；4-rank 硬件复现中 2 tiles 必须正常退出，4 tiles 与 shipped `48x84` latent（28 tiles）必须保持并行路径。^[PR #6345]
- [MMH3-3l] H3 直接 VAE 调用必须共享请求级 residency window
  - 触发：MiniMax H3 在 model-level CPU offload 下处理 image/video reference 或 embedded/standalone audio reference，且 pipeline 直接调用 Video-VAE 或 Audio-VAE。
  - 强制：`_encode_visual_conditions` 必须在同一个 `video_vae` residency window 内完成该请求的全部 image 与 video encode；`_encode_reference_audio_conditions` 必须在同一个 `audio_vae` residency window 内完成 embedded 与 standalone audio encode。resident helper 只能在对应 scope 内调用，scope 退出时必须释放 component，异常也必须清理。
  - 验收：contract tests 覆盖单/多 image、image+video、embedded+standalone audio 以及 encode exception，精确断言每个 VAE 只有一次 activate/offload；另验证 H3 model-level offload 注册所有实际 DiT 与 VAE stage，并以固定硬件和 workload 单独复核真实性能与输出质量。^[PR #6072]
- [MMH3-3m] H100_2 merge lane 只覆盖精确 H3 CI matrix
  - 触发：H3 CUDA merge CI、DLO/DP/TP/USP/HSDP/TE/VAE-PP e2e fixture。
  - 强制：一个 `h100_2` 150m job 以四个独立 35m pytest spawn processes 运行：FL2VA TP1/DP2 两并发、Ref2VA image-only 同配置、Turbo FL2VA TP2+DLO/no-AllGather（五 sigma/四 eval）、FastH3 1024×576 四步 HSDP2/USP2/TE TP2/VAE PP2。断言仅同步 MP4 geometry/FPS/audio positive sample。
  - 验收：核对四 process timeout/request 600s/spawn isolation 与上述 exact cases。^[PR #6556]

## 决策与踩坑

- [MMH3-3f] 禁止：把 PCIe/NUMA 重排或 TP4 headroom variant 当已测；权重 residency 由 TP、activation 由 USP 主导，但三点拟合的约 55 GiB floor 不是跨 shape/concurrency 定律。两 server 布局未测，且会把 host RAM/storage 需求翻倍。Ref2VA latency/memory 明确未测；review 回复的成功附件无协议/峰值，不能把 T2VA 数字外推。
  - recipe 只给可变 `vllm/vllm-omni:minimax-h3` tag，没有 vLLM SHA、image digest 或 PyTorch version；复现前必须补齐，不能把 linked issue #5901 的关闭归因于 docs-only diff。
- [MMH3-3g] 禁止：把这些值写成 Ascend/NPU 通用收益，或声称 PR 已证实整请求从旧 mask path 的 speedup；E2E 表比较的是新 varlen、Laser 和可选 Cache-DiT，没有 old-mask E2E control。rank0 reserved 40–44 GB 与 recipe DLO 45 GB 也不是所有 rank/任务峰值上界。
- [MMH3-3h] 禁止：把 4/8 卡 latency winner 表中其他 topology 写成最终 recipe 推荐；从 20 resident layers 推导 host master 减少；把 FL2VA first-frame 或相同 encoder/decoder/DiT shape 外推成 Ref2VA 已测。
- [MMH3-3i] 禁止：继续把 online FP8 与所有 layerwise offload一概标记为不兼容；runtime-created FP8 进入 sharded DLO AllGather；用 `.view()` 把物理转置权重恢复成 contiguous 逻辑布局；把单次 B300 的显存或速度观察写成 H3 通用容量/性能保证。
- [MMH3-3j] 禁止：让 backend 自行决定 checkpoint compatibility 或混合 DiT/非 DiT source 后只跳过部分 materialization；把 TP>1 ordinary-loader fallback、HSDP、online quantization 或其他 fail-closed 路径宣称具有 node-shared mmap 节省；把 resident layers 增加描述成减少 rank-local pinned host master。
- [MMH3-3k] 禁止：让无 tile 的 rank 抛错退出 collective、让其他 rank 留在 `all_gather`；不得使用 encoder grid 代替 decoder grid、让各 rank 依据不同条件分支，或把 rank-local fallback 描述成无性能代价或通用 VAE 并行支持。
- [MMH3-3l] 禁止：按 image、video 或 audio 条目分别建立重复的 H2D/D2H lifecycle；在前一个 scope 结束后直接调用 CPU-bound VAE；把单次 image 的行为外推为混合 reference，或把 transfer-level A/B 结果写成完整模型峰值显存与通用性能保证。
- [MMH3-3m] 禁止：把 CI collection 写成 runtime support/performance/general topology proof；final target 的 runtime changes已 reverted，不得以它宣称 generic support。
