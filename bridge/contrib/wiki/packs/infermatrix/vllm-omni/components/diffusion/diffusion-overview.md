---
name: diffusion-overview
description: Diffusion 组件导航：vllm_omni/diffusion/ 17 个子模块（main @ 44d3ae10 校验）、何时查共享 diffusion 代码、不放什么，以及按症状到各规则页的路由表（Wan fastpath、FlashInfer 量化、TRTLLM、AR paging、Ray executor、attention、LoRA、SP padding、output lifecycle、paged KV、checkpoint 加载等）
metadata:
  scope: 只收 Diffusion 组件目录的职责边界与页面路由；共享职责与数据流归 diffusion-architecture，按 PR 描述直达规则组的代码地图归 diffusion-rules-1，HunyuanImage3 独有问题归模型目录
---
# Diffusion

## 现状

- [[rules-ipc-errors]]（IPC 与客户端错误） — dead-peer send、abort no-op 与单 GPU status 保留。
- 源码入口：`vllm_omni/diffusion/` 全树，含 17 个子模块：attention、cache、diffusion_kv、distributed、executor、hooks、layers、lora、model_loader、models、offloader、postprocess、profiler、quantization、sched、utils、worker
- 源码校验：以上子模块均已在 `main @ 44d3ae10`（upstream `main` 快照）验证存在；MiniMax-H3 的 VAE eager ops 仍由模型 owner 维护，其他 shared/模型机制按各自规则审查
- 主要职责：多个 diffusion 模型共用的 pipeline、执行循环、scheduler 接入和运行机制

### 什么时候查这里

- 根因位于共享 diffusion 代码，可能影响多个模型。
- 调查 denoise loop、diffusion runner、scheduler 或共享 attention 执行机制。

### 不放什么

- HunyuanImage3 独有 pipeline、配置和 checkpoint 问题；这些放模型目录。
- 通用 benchmark 方法；这些放 `general/benchmark/`。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| Wan exact/fused BF16预算、channels_last首帧Conv2d与cache/fallback | [[rules-wan-fastpath]]（Wan fastpath规则） |
| FlashInfer FP32 per-tensor scale、TRTLLM SAGE ragged/Smooth-K 与量化环境变量 precedence | [[rules-flashinfer-quantization]]（FlashInfer quantization rules） |
| TRTLLM opaque custom-op workspace/fake dtype 与实际 verified execution scope | [[rules-trtllm-execution]]（TRTLLM execution rules） |
| AR-Diffusion kernel legal page、ragged sink/recent KV、scratch offset 与固定 block-table width | [[rules-ar-paging-geometry]]（AR paging geometry rules） |
| Ray cluster placement、env/RPC transport、bounded teardown 与 idle failure | [[rules-ray-executor]]（Ray executor rules） |
| 理解共享职责和数据流 | [[diffusion-architecture]]（architecture） |
| 根据 PR 描述直达 execution parity、checkpoint/artifact identity、quality evidence 或 system-runtime 异常清理规则组与第一批源码、custom-op mutable schema | [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（rules 与代码地图） |
| image/diffusion timing、step normalization、missing-versus-zero 与 benchmark 解释边界 | [[diffusion-rules-metrics]]（metrics evidence rules） |
| vLLM/torch rebase、MoE/quant helper 漂移、kernel backend capability 与 matched accuracy | [[diffusion-rules-upstream-compat]]（upstream 兼容规则） |
| worker process title、拓扑局部 rank、日志前缀与offload worker-local allocator峰值 | [[rules-worker-observability]]（worker observability rules） |
| 平台 IR-op priority、Inductor/eager 默认顺序、pipeline compile 准入与模型 hook 合并 | [[rules-platform-runtime]]（platform runtime rules） |
| CustomOp XPU platform dispatch、PyTorch-native fallback、CUDA contract 与非同义 override 边界 | [[rules-custom-op-dispatch]]（CustomOp dispatch rules） |
| runtime temporary 与 loader-scoped parameter dtype、shared RMSNorm accuracy | [[rules-tensor-dtype]]（tensor dtype rules） |
| Wan VAE height/width spatial reshard、empty tail、attention extent | [[rules-wan-spatial-shard]]（Wan spatial-shard rules） |
| 完整图像 batch VAE decode、native tiling、uneven/idle rank 与 gather 顺序 | [[rules-vae-batch]]（Batch VAE decode rules） |
| multi-DiT、dotted `_dit_modules`、loader-to-offloader handoff 与跨 Cache-DiT/compile/LoRA/offload lifecycle、batch sampling-key 的 provided 标志 | [[rules-component-lifecycle]]（component lifecycle rules）   新增核对：DIFF-2ag。 |

- （以下为原表格，按行改写为条目）
- 遇到什么：PEFT 与 distilled LoRA、startup fusion、delta/key/alpha、Qwen/Wan transformer mapping、PEFT suspend/resume、零绑定与部分绑定拒绝
  - 查看哪里：[[rules-lora-1]]、[[rules-lora-2]]（LoRA rules） — DIFF-2ag4 合并并继承 DIFF-2ag2；DIFF-2ag3。
- （以下为原表格，按行改写为条目）
- 遇到什么：Blackwell FA4、显式/auto CUDA backend、per-role mask/SP pad；local FlashAttention deterministic opt-in、role-aware masked cross-attention、NPU packed mask-free/laser fallback、TRTLLM packed-padding 与 config propagation、equal-rank SP auto-pad fast path、等长 batch padding mask 省略
  - 查看哪里：[[rules-attention-1]]、[[rules-attention-2]]、[[rules-attention-3]]（attention rules）   新增核对：DIFF-1ai3、DIFF-1aj2、DIFF-1ai4、DIFF-1d2。
- （以下为原表格，按行改写为条目）
- 遇到什么：SP auto-padding、`mask_sp_padding`、dense/varlen 与 advanced UAA 边界
  - 查看哪里：[[rules-sp-padding]]（SP padding rules）
- 遇到什么：video/audio mux、DLO DP wave、RPC reply ownership/result release、result queue、async pump、SHM ownership、async-output wait 与 shutdown、mid-stream interaction handler
  - 查看哪里：[[rules-output-lifecycle-1]]、[[rules-output-lifecycle-2]]（output/runtime rules）   新增核对：DIFF-1ai、DIFF-1aj、DIFF-1ai2。
- （以下为原表格，按行改写为条目）
- 遇到什么：distilled continuous sigma schedule、boundary/step 语义与 modality shift
  - 查看哪里：[[sigma-schedules]]（sigma schedule rules）
- 遇到什么：HunyuanImage3 Distil CFG、MeanFlow special-token / scheduler-r 合同
  - 查看哪里：[[hunyuan-image3-rules-1]]、[[hunyuan-image3-rules-2]]（HunyuanImage3 HY3-8d）
- 遇到什么：diffusion step 与 request/continuous batching；DIFF-1af BAGEL image step wave、packed state、geometry/CFG admission 与 fallback cleanup
  - 查看哪里：[[step-and-batching]]（step and batching）
- 遇到什么：request-wave admission coalescing、stable window、deadline 与 finite config
  - 查看哪里：[[rules-admission-wait]]（admission wait rules）
- 遇到什么：paged KV/cache 预算、native/backend/platform 闭环、GQA/Ring/Ulysses layout、FlashInfer plan、能力 metadata、cache_backend None 规范化
  - 查看哪里：[[rules-system-runtime-1]]、[[rules-system-runtime-2]]（paged cache 与系统运行时规则）   新增核对：DIFF-4ad。
- （以下为原表格，按行改写为条目）
- 遇到什么：Scheduler-managed diffusion KV 的请求控制面、Hunyuan layout 与未实现边界
  - 查看哪里：[[paged-kv-control-plane]]（paged KV control plane）
- 遇到什么：Cache-DiT、TeaCache 和 prefix cache
  - 查看哪里：[[cache-acceleration]]（cache acceleration）
- 遇到什么：TP/PP/SP/CFG/VAE/HSDP 等并行策略
  - 查看哪里：[[parallelism]]（parallelism）
- 遇到什么：实验性 world-model session 生命周期、LRU 与内存统计边界
  - 查看哪里：[[session-state]]（session state）
- 遇到什么：checkpoint remap、HSDP/FSDP、final-layout HWR、registered HWR mmap DLO transport、component quantization、在线量化加载与 TorchAO `.bin` index fallback
  - 查看哪里：[[rules-checkpoint-loading-1]]、[[rules-checkpoint-loading-2]]（checkpoint 与加载合同）
- [[rules-platform-kernels]]（Diffusion 平台 kernel 与设备合同） 新增核对：DIFF-1ai5。
- [[rules-test-contracts]]（测试替身与类型契约） — streaming executor、payload 收窄与实际 CPU/type 门禁。
- [[rules-hsdp-weight-loading]]（HSDP pre-sharded 权重加载） — meta-first binding、rank-local I/O 与真实双卡 parity。
- [[rules-attention-contracts]]（Attention execution-path 能力） — 有效 metadata、FA4 编译边界与未迁移平台。
- shared RMSNorm 的empty-input与fused精度边界沿 tensor dtype rules 的DIFF-NORM-1a核对。
- [[rules-video-transport]]（registered video SHM 与 borrowed mapping ownership）。
- [[rules-sage-attention]]（SageAttention3 FP4 dispatch 合同）。
- [[rules-request-batch]]（Diffusion request batch 的 pipeline 合同）。
- [[rules-jit-cuda-includes]]（Diffusion JIT CUDA 构建 include 顺序规则）
- [[rules-ar-realtime-integration]]（AR-Diffusion 实时模型集成规则）
- [[rules-4d-mask-routing]]（Diffusion attention dense 4D mask routing）
- [[rules-wan-sdpa-math]]（vllm-omni · Diffusion — Wan SDPA 对齐测试规则）
- [[rules-master-port-tests]]（Diffusion master-port 测试规则）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/diffusion/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, components, diffusion；created: 2026-07-10；updated: 2026-10-09
- 来源（sources）：PR #5543；vllm_omni/platforms/cuda/platform.py；vllm_omni/diffusion/attention/backends/flashinfer_attn.py
