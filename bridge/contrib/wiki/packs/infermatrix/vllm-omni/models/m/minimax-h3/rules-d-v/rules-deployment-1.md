---
name: rules-deployment-1
description: MiniMax H3 部署与证据规则（上）：MMH3-3a DLO 的 loader layout 与 component stage 配对、MMH3-3b 2×RTX 5090/4090 consumer profile 容量证据边界、MMH3-3c 4×H100 DFX nightly fixture 与 Ref2VA H.264 payload、MMH3-3d ROCm gfx942/gfx950 按 SKU 与镜像限界、MMH3-3e DGX Spark/GB10 unified memory 容量证据
metadata:
  scope: 只收 MMH3-3a 至 MMH3-3e 及页首说明；RTX PRO 6000/5000、Ascend、online FP8 与 DLO、host-weight plan、VAE tile、residency window、H100_2 merge lane 归 rules-deployment-2；模型输入、执行与加载合同归 minimax-h3-rules-1 的路由表所指各页
---
# MiniMax H3 部署与证据规则（1/2）

## 关键事实

- 拆分说明：本页是源页 `rules-deployment.md` 的第 1/2 部分；第 2 部分 [[rules-deployment-2]]
- 源页：`knowledge/repos/vllm-omni/models/minimax-h3/rules-deployment.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models, diffusion；created: 2026-09-02；updated: 2026-09-05
- 来源（sources）：PR #5723；PR #5764；PR #5836；PR #5850；PR #5857；PR #5863；recipes/MiniMaxAI/MiniMax-H3-RTX-PRO-5000.md；PR #5891；PR #5896；PR #5946；PR #5969；PR #5972；PR #6555；PR #6556；docs/models/supported_models.md；recipes/MiniMaxAI/MiniMax-H3.md；recipes/MiniMaxAI/MiniMax-H3-4090.md
  - recipes/MiniMaxAI/MiniMax-H3-5090.md；recipes/MiniMaxAI/MiniMax-H3-Spark-GB10.md；recipes/MiniMaxAI/MiniMax-H3-RTX-PRO-6000.md；vllm_omni/diffusion/attention/backends/flash_attn.py；vllm_omni/diffusion/attention/backends/utils/fa.py；vllm_omni/diffusion/models/minimax_h3/encoder.py
  - vllm_omni/diffusion/models/minimax_h3/minimax_h3_transformer.py；vllm_omni/diffusion/models/minimax_h3/pipeline_minimax_h3.py；vllm_omni/diffusion/models/minimax_h3/vae.py；vllm_omni/diffusion/offloader/；vllm_omni/entrypoints/openai/api_server.py
  - vllm_omni/entrypoints/openai/serving_video.py；vllm_omni/platforms/npu/platform.py；.buildkite/cuda/test-merge.yml；tests/dfx/perf/scripts/run_diffusion_benchmark.py；tests/dfx/perf/tests/test_minimax_h3_vllm_omni.json；tests/e2e/online_serving/minimax_h3/
  - tests/e2e/online_serving/test_minimax_h3_dlo_dp2_t2va.py；tests/entrypoints/openai_api/test_video_server.py；PR #5910；PR #6213；PR #6345；tests/diffusion/models/minimax_h3/test_minimax_h3_vae_tiling.py；PR #6072；PR #6526；tests/diffusion/models/minimax_h3/test_minimax_h3_dlo_lifecycle.py
  - tests/diffusion/offloader/test_module_residency.py
- 置信度（confidence）：high
- 只有 MMH3-数字字母 是可审计规则 ID。本页承载 deployment、capacity 与 hardware measurement；模型输入、执行与加载合同返回 [[minimax-h3-rules-1]]（MiniMax H3 rules；源锚点 #direct-代码快速入口）。
- [MMH3-3a] H3 DLO 必须保持 loader layout 与 component stage 配对
  - 触发：H3 `OffloadPlan`、`dlo_no_use_allgather`、resident layer、text encoder/VAE staging 或 DLO 与 CPU/layerwise offload 组合。
  - 强制：H3 先走 regular loader 形成 TP-local grouped-QKV/fused-MLP layout，再以 no-AllGather H2D streaming 使用它；`_supports_mmap_loading=False` 是安全门，不能绕过。
    - plan 将 `token_refiner.blocks` 独立 stream，text encoder 的 vision/text block rank-local stream，video/audio VAE 按 encode/decode stage on-demand，leading `transformer` blocks 只在 denoise stage resident 并在 decode 前释放。`dlo_resident_layers>0` 必须与 no-AllGather 配对。
    - MiniMax-H3 的 staged encoder→DiT→VAE 边界可共用一个 component-local `BoundedAllocatorCache`：仅当 cached-but-unallocated 不超过设备容量 25% 且物理 free 不低于 5% 时保留；遥测缺失、任何 component/stager failure 或 OOM retry 都保守释放。
    - encoder 的非 block children 必须作为一个 immutable pinned-CPU snapshot group，以一条 copy stream/event stage，保持 parameter/buffer storage alias、shape、stride、offset 与 dtype；DiT prefetch 和两个 shared device buffer 不变。
  - 验收：分别覆盖 text、image、video、embedded audio、standalone audio 与 decode 的 load→use→finally-offload 次序，异常也释放；regular-loader transform sentinel 到 TP-local stream 后仍正确；resident layers 只围住 denoise。
    - 还须覆盖正常保留与两条 memory bound、遥测 fallback、OOM 一次 flush/retry、load/offload/component failure 的 host-master restore/forced release，以及 alias-preserving non-block group 的 idempotent transitions。补齐上述 standalone-audio gap 前，不能用其他 component staging 单测宣称所有 Ref2VA 输入已覆盖。
    - PR #6526 的 L20X matched single-request no-AllGather CUDA A/B 是有界 latency observation，B300 仅独立 functional smoke；二者均非持续 benchmark 或跨 topology/platform performance proof。^[PR #5764] ^[PR #6526]
- [MMH3-3b] consumer-GPU profile 是有边界的容量证据
  - 触发：引用 H3 2×RTX 5090/4090 可运行性、延迟、峰值或 resident-layer 默认值。
  - 强制：5090 证据只绑定 vLLM-Omni `ae6577ea` 的一次 2×32 GiB、T2VA、1344×768、124 frames、50 steps run：8m38s，约 22.6 GiB/GPU 是 sampled `nvidia-smi`，不是 allocator high-water。早期 4090 容量依据只是 2×B300 的 5-step proxy；
    - PR #5850 后新增的目标硬件证据绑定 vLLM-Omni `81b48e83`（不是 merge target）、vLLM 0.26.0、PyTorch 2.11+cu130、driver 580.126.09、BF16/CUDNN/eager、TP2、no-AllGather DLO、12 resident layers、单 partition、1024×576、124 frames@24 FPS、60 steps、seed 1101、video/audio shift 12/3。
  - 强制：2×4090 使用 USP1、text-encoder TP2、VAE PP2；T2VA 两次约 435/429 s、rank-0 allocator reserved high-water 15.3 GiB，Ref2VA 两次约 892/892 s、14.6 GiB，两者均报告完整 ffmpeg decode。4×4090 使用 USP2、text-encoder TP4、VAE PP4；T2VA 两次约 274/270 s、rank-0 15.2 GiB并完整 decode；
    - Ref2VA 只有一次 HTTP 200，约 545 s、rank-0 16.1 GiB，未声明完整 decode。后续 Ref2VA 虽完成 diffusion，却在 D2H 阶段触发 engine hardcoded 30 s async-output wait，因此 4 卡 Ref2VA repeatability 不成立。header peak 只表示 rank 0 `torch.cuda.max_memory_reserved`，不是所有 rank 最大值；
    - USP 不进一步 shard DiT weight，只能按该 workload 描述 per-GPU observation。
  - 验收：新硬件/拓扑用单一 partition 与 exact config，记录 immutable model/environment、all-rank allocator/整机峰值、warmup/repeats、stage/E2E latency 和 joint video/audio quality。recipe 的 “after #5720 lands” 已过期，因为 modular H3 在该 target 已存在；partition-path 命令本身仍保持单 partition，无需据此推断 combined route。
    - 目标 pin 引用的 `examples/offline_inference/minimax_h3/run_h3_2gpu_all_tasks.sh` 实际不存在，因此不能把其 four-task/MP4 validation 描述成可执行入口；补文件或改文档后再验收。^[PR #5764] ^[PR #5850]
- [MMH3-3c] H100 DFX fixture 只证明 exact nightly workload 与 payload path
  - 触发：引用 H3 4×H100 latency、throughput、peak memory、DLO 节省，或修改 X2V perf lane、random video reference 与 model-path resolution。
  - 强制：H100 测量只绑定 PR 中较早的 partition-path commit `e8c343d5`：4×H100 80 GiB、USP4+HSDP4+encoder TP4+VAE PP4 tile、FLASH_ATTN、1344×768、209 frames、24 fps、8 steps、seed 42、1 warmup、3 measured prompts、concurrency 1。后续 `4767c524` 才将 final cases 改成 repo-root modular model + `--task-type`，PR 没展示 switch 后复测；
    - final nightly 只是预期采集。target config 中 T2V/TI2V/V2V/DLO baseline 分别是 latency mean 38.3252/38.1385/105.7508/38.2089 s，peak-memory mean 54219.6/54622.8/55180.8/36218.4 MB；它们是 result metadata，当前 completed-count gate 不消费这些阈值，不能称为 regression guard。
    - predecessor partition-path 实测值为 42.5836/42.3761/117.5009/42.4543 s、60244/60692/61312/40242.67 MB、0.0235/0.0236/0.0085/0.0236 qps，且 profiler 开启；不得外推为 no-profiler/production 数字。config 对三类 metric 都存 0.9×实测；对越小越好的 latency/memory，这不是“允许 +10%”的正确 upper bound，即使未来恢复断言也必须先修 directionality/threshold。
  - 强制：Ref2VA synthetic clip 先用 OpenCV 生成，再尽力用 ffmpeg/libx264 转 H.264；H3 request 必须走 `video_reference` data URL，使 server 持久化 `source_path` 给 ffprobe/ffmpeg consumer。缺 ffmpeg 时 fallback `mp4v`，但 H3 要求 H.264/H.265，因此该 fallback 不是有效 H3 兼容路径。
  - 验收：nightly 必须证明四个 pytest case 均实际 collected、3/3 completed、artifact/log 上传，并在 materialized root、offline snapshot 与 repo-id 三种 model resolution 下断言 Ref2VA 都走 `video_reference` 且 ffprobe 为 H.264/H.265；
    - final diff 没有为新增 re-encode/model-routing helper 增加单测，PR 所报 77 个 video-server tests 只是既有 server/API suite。性能 gate 若启用需另定义 metric directionality。^[PR #5836]
- [MMH3-3d] ROCm support 必须按 SKU、镜像、拓扑和测量协议限界
  - 触发：声明 H3 AMD/ROCm 支持，引用 gfx942/gfx950 latency，或推荐 `FLASH_ATTN`、ROCm image、单卡 CPU offload/四卡并行配置。
  - 强制：`FLASH_ATTN` 只在 ROCm platform 检测 gfx942/gfx950 且 AITER 可用时解析到 AITER packed varlen，否则回退 SDPA。
    - gfx942 证据绑定 4×MI300X、BF16、USP4、text-encoder TP4、VAE PP4 tile、1344×768/209 frames/50 steps：一次 excluded warmup 后三次均值，T2VA encode/denoise/decode/client E2E 为 0.09/244.04/4.15/267.42 s，FL2VA 为 13.98/257.58/4.11/287.07 s；输出仅验证 H.264 24 FPS + 32 kHz stereo AAC。^[PR #5723]
  - 强制：gfx950 只绑定单张 MI350、vLLM `0.26.0+rocm723`/HIP 7.2、BF16、CPU offload、832×480、约 4 s/40 steps 的 functional run；约 0.73 s/step、55 s client E2E 包含首次 lazy compile，不是 tuned throughput。text-encoder TP 未在 gfx950 该证据中执行。
  - 验收：support table 的 AMD cell、footnote 与 recipe 必须一致；当前 H3 行已标记 AMD 并链接 published recipe，但这只修复 recipe-evidence 展示，不能扩大既有 SKU/task/topology 证据。新增组合须逐项记录 immutable image/commit、软件栈、warmup/repeats、输入、各阶段时间、输出/质量检查；
    - recipe-only diff 没有 CI 或可执行测试，外部 gfx942 数据与 gfx950 functional observation 不能冒充持续回归 gate。^[PR #5969]
- [MMH3-3e] GB10 unified memory 容量证据不等于离散 GPU offload 合同
  - 触发：引用 DGX Spark/GB10 可运行性、97.7/102.8 GiB allocator peak、T2VA/Ref2VA latency，或推荐 offload/FP8。
  - 强制：只启动一个约 135 GiB FL2VA/Ref2VA partition；约 121 GiB 可用 unified memory 下必须用 online FP8（仅 DiT 约 62→31 GiB，encoder/VAE 仍 BF16），禁用 CPU/DLO offload，因为 host/device 共用物理池，DLO 观察到启动后 exit -9。用 eager、CUDNN_ATTN，并保持 TP/USP/ring/VAE patch parallel degree 全为 1，同时显式配置长 timeout。
  - 强制：Ref2VA 新证据只绑定同一单机 GB10/aarch64、单 Ref2VA partition、online FP8/eager/CUDNN_ATTN/tiled VAE、parallel degrees 全 1、单请求、单 reference image、960×576、24 FPS、8 s、flow shift 12、seed 1101。三次 10-step E2E 为 770.3–861.1 s，单次 50-step 为 4157.0 s；
    - 50-step denoise/per-step/decode 为 4039.6/80.79/69.4 s，allocator peak 102.8 GiB。与相同 shape/steps 的 T2VA 2169.4 s 比值 1.92×只是这两个单次 observation，不是 mode 固有倍率。10-step per-step 66.55–74.88 s、长请求 80.79 s 的热态差异要求容量规划用较慢端，不能承诺 cold-run 66 s。^[PR #5972]
  - 验收：probe 确认 HTTP 200、H.264 960×576/24 FPS、32 kHz stereo AAC 和约 8.032 s artifact，并记录 exact commit、partition、reference count/type、shape/steps、stage-header、server-log mux、allocator 与整机内存。FL2VA 仍无独立完成证据。PR #5972 只有 recipe diff、无可执行回归；
    - 其 driver 仍是 placeholder，且版本说明同时写 vLLM 0.26.0、vLLM-Omni `main @ e1aa6eae` 与“newer than v0.26.0”，复现时必须分别锁定两项目版本。recipe 又称 sync timeout 默认 1800 s，但 target `api_server.py` 默认是 600 s；T2VA/Ref2VA full run 都必须显式设置更大值。
    - raw log/header、reference image、输出 artifact 与 quality metric 均未提交或链接，所以 HTTP/codec 描述不能替代可复核质量证据。当前文件还多出未配对的末尾 code fence，且版本句含 malformed `.suggestion is v0.26.1`，发布前需修复。^[PR #5972]

## 决策与踩坑

- [MMH3-3a] 禁止：让 encoder TP shard 进入 DiT AllGather；把 DLO+CPU offload 的早期分支优先级交给 generic CPU-offload hook；只因 component 有 `offload_to_cpu` 就推断每个 caller 都正确 staging。
  - 目标 pin 的 `_encode_audio_conditions(standalone_audios)` 没有进入 `_component_on_device`，会在前一个 embedded-audio context 已关闭后直接使用 CPU-bound audio VAE；没有外层 stage context 或专属测试证明 image+standalone-audio Ref2VA 的 DLO device/performance 合同。
  - 不得把此 component-local retention 变成 global `empty_cache` override，或删除 executor 的 unconditional shutdown cleanup；不得由 CUDA/no-AllGather 的有界 A/B 外推 AllGather、其他平台、其他 DLO 模型或吞吐/并发收益。
- [MMH3-3b] 禁止：把单次未 warmed 的 5090 run 写成 benchmark，把 B300 proxy 写成 target hardware，或从 HBM fit 推断 host fit。每个 FL2VA/Ref2VA partition 约 135 GiB、至少 200 GiB available RAM与推荐 384 GiB 只是 recipe 声明，未给 checkpoint revision/checksum 或 host high-water；
  - no-AllGather worker 的 pinned CPU master 不因 resident layers 增加而消失。两次输出大小相差不超过 115 bytes 不证明数值、感知或 A/V 质量一致；这些是 single-request latency，不是 concurrent throughput。单卡 4090 未测；5090 的 26.5 GiB 单卡 profile 超过 24 GiB，而降低 resident layers 的替代方案也未测。
- [MMH3-3c] 禁止：把上述 predecessor 数字当成 final repo-root modular route 的实测，或泛化到 50-step、并发及其他 topology；PR #5836 final diff 本身没有其 body 所述 RoPE 修复，后续 PR #5896 才补 MindIE 3D→4D adapter。特殊 payload 当前靠 resolved model 字符串包含大小写敏感的 `MiniMax-H3` 判断；
  - materialized env/cache path 若不含该 token 会退回 multipart `input_reference`，所以 lane 接入本身不证明 V2V 稳定执行。
- [MMH3-3d] 禁止：从 architecture gate 外推到 MI325X/其他 MI355X SKU；从 PR body 的“single + 4 GPU”或 “约 2× SDPA”外推，因为 final evidence table 没有 gfx950 四卡协议/结果或 A/B；也不能用可变 `minimax-h3` tag 代替 image digest。评论中的旧 digest 缺后续 soundfile/TorchCodec/ffmpeg 状态，更新镜像的回复没有给新 digest。
- [MMH3-3e] GB10 unified memory 容量证据不等于离散 GPU offload 合同
  - 禁止：把 97.7 GiB allocator reserved header 当整机 pool peak（不含 context/非 PyTorch），或把单次 50-step T2VA 写成 throughput。960×576、8 s、50 steps 的 text/denoise/decode/mux/E2E 约 0.25/2088/70/4.84/2169.4 s，部分 stage 来自另一次 10-step run；相同 10-step denoise 波动 397–490 s，只能绑定该机器/配置。^[PR #5946]
  - 禁止：把 `X-Peak-Memory-MB: 105318.000` 当 GB10 整池峰值；它是 `torch.cuda.max_memory_reserved`。recipe 的 1 Hz `/proc/meminfo` 交叉检查只对该 50-step 单图请求成立：121.7 GiB 总池、`MemAvailable` 最低 7.4 GiB，推算约 114.3 GiB 已占用。因此不能外推到更多图片、reference video、更大输出、并发或第二进程；这些均未测。
    - 6883-token presentation 和 1.90× per-step 是该单图 prompt/log observation；“这些 attention tokens 导致 denoise 变慢”没有受控对照，只是 recipe 的合理推断，不是任意 Ref2VA 输入定律。两次后续热态 run 接近也没有温度/功耗 sensor 证据，不能据此证明稳定 thermal state。
