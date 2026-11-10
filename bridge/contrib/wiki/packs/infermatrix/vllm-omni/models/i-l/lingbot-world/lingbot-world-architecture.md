---
name: lingbot-world-architecture
description: LingBot World 2.0 架构：图像条件的 causal world generation、模型与共享 owner 的边界表、14B causal-fast 固定配置（40 层、hidden 5120、每 block 3 latent frames、固定四步 DMD）、输入到输出五步流程、offline/stepwise/deprecated tick 三种入口、流式 VAE、纯 Ulysses 与 KV reuse 的取舍
metadata:
  scope: 只收模型数据流、固定配置与实现边界；执行硬约束 LBW-* 归 lingbot-world-rules，请求字段、运行命令与验证口径归 execution-validation，入口与路由归 lingbot-world-overview
---
# LingBot World 2.0 架构与模型边界

## 现状

- 本页解释 image-conditioned causal world generation；执行硬约束见 [[lingbot-world-rules]]（模型规则），入口、配置与验证方法见 [[execution-validation]]（运行与验证）。内容核对到固定源码 `9cf443a7bb24d6b8007981311466d769ec13b3d8`；该模型页的补充不推进仓库级 release baseline，也不代表已运行真实权重验证。

### 模型专有部分与共享模块的边界

- registry key 为 `LingBotWorldCausalDMDPipeline`，实现目录是 `diffusion/models/lingbot_world/`。pipeline 拥有首图条件、camera/action 解释、四步 DMD block、流式 VAE state 和模型自有状态显存声明；transformer 拥有 causal video attention、camera injection 与 C2WS 投影。

| 边界 | 模型侧职责 | 共享 owner |
|---|---|---|
| 请求与控制 | materialize image/trajectory，解释 camera script 和 SE3 interaction，校验模型几何 | HTTP/WebSocket transport、事件排队和输出生命周期属于 serving/diffusion |
| AR 执行 | block 数学、条件编码、模型状态 bind/reset/close | runner 的 paged KV、容量、scratch/commit 和 stepwise 调度见 [[rules-system-runtime-1]]、[[rules-system-runtime-2]]（系统运行时） |
| attention | 模型 Q/K/V、sink/recent window 与 camera token | page 选择、ragged block 与固定 table 宽度见 [[rules-ar-paging-geometry]]（AR 分页几何） |
| 旧 tick 协议 | 解释 LingBot camera controls | typed tick 身份、快照和失败提交见 [[rules-bridge-batch-2]]（EXEC-1l；源锚点 #exec-1l-typed-ar-diffusion-tick-必须隔离协议身份并以完整-metadata-提交） |

- 这些共享合同只保留一份正文；具体模型规则不能替代共享 runner/transport 的验收。

### 配置、checkpoint 和兼容范围

- 当前实现按 `robbyant/lingbot-world-v2-14b-causal-fast-diffusers` 的固定结构构建。`from_config` 校验配置值，不能把该入口当作任意 Wan 或其他 LingBot 尺寸的通用加载器。

| 配置 | 固定合同 |
|---|---|
| transformer | 40 层，40 attention heads，head dim 128，hidden size 5120，FFN 13824 |
| 输入/输出 | 36 input channels，16 output channels；patch `(1, 2, 2)` |
| 文本/时间 | UMT5 text dim 4096，freq dim 256，文本长度 512 |
| AR 几何 | 每 block 3 latent frames；sink 9，完整滑窗 18 latent frames |
| 时间压缩 | Wan VAE temporal factor 4；合法像素帧数 `9 + 12k` |
| 采样 | causal-fast 固定四步 DMD；flow shift 默认来自 scheduler，配置/请求可显式指定正有限值 |
| RoPE | 预计算长度 1024；temporal 绝对位置越界时即时计算，不能据此断言所有运行时状态都无限长 |

- 标准组件分别从 `tokenizer/`、`text_encoder/`、`vae/` 加载；custom transformer 经 `DiffusersPipelineLoader` 的 `transformer.` 权重前缀装载。在线 FP8 只接入 transformer 内已有 vLLM parallel linears；普通 `nn.Linear`、VAE、text encoder 与 AR KV 不因此量化。
  - 来源：[配置校验](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/transformer.py#L992)、
  - [组件加载](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/pipeline.py#L623)。

### 从输入到输出的主要流程

1. preprocess materialize 首图与 camera 输入；`_parse_request` 校验单请求、单输出、runner 提供的 generator、分辨率与完整 block 数。
2. tokenizer/UMT5 生成文本条件；首图填入条件视频首帧，其余帧为零，经 Wan VAE encode 后取确定性 latent。16 个条件 latent channels 与 4 个 mask channels 组成 20-channel condition；再与 16-channel noisy latent 拼成 transformer 的 36-channel 输入。
3. camera 模块把 pose/intrinsics 转成逐像素 ray embedding。当前六个通道实际为 **origin xyz + direction xyz**；不要根据 `build_plucker_embedding` 的名字误写为 moment/direction。像素 unshuffle 把 `6 × 8²` 折成 384 channels，再与视频 patch 网格对齐。
4. 同一 `LingBotDMDBlockRunner` 推进四个 denoising probes，默认额外执行 clean-x0 KV writeback；每 block 提交 3 latent frames。可选最后一步 KV reuse 改变写回语义，详见 [[lingbot-world-rules]]（模型规则）。
5. stepwise `post_decode` 按 session 复用 causal VAE temporal cache，产出像素 chunk 与 AR metadata；完成、reset、close 和失败边界释放模型状态。
- 来源：[条件编码](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/pipeline.py#L1106)、
  - [camera embedding](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/camera.py#L425)、
  - [DMD block](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/dmd_block.py)。

### 三种执行入口

| 入口 | 请求边界与输出 | 适用问题 |
|---|---|---|
| offline trajectory replay | 一个 request 重放预定 pose/intrinsics 路径，输出完整视频 | 已知 camera trajectory、整片比较 |
| stepwise streaming | 一次 `generate()` 是整个 rollout；prepare 一次，每 AR block 输出一个 chunk | `WS /v1/realtime/video`、request-scoped script 与 mid-session interaction |
| deprecated in-process tick | 每 request 只生成一个 block，session state 跨 request 保留 | 旧内部控制面与兼容性调查；不能套用 stepwise 的 request identity |

- stepwise 配置显式启用 `ARDiffusionEngine`、`step_execution` 与 `streaming_output`，固定 `max_num_seqs=1`；多副本 session affinity 尚未实现。模型不自动选择默认 deploy YAML，需由调用方选择执行模式。

### 设计取舍与实现边界

- **滑窗与持久状态**：sink/recent window 约束 attention residency；condition encoder、streaming decoder、cross attention 与 in-flight scratch 仍各有状态。滑窗不能单独证明显存上界。
- **流式 VAE**：带 session 且 shape 不走 tiled decode 时复用 temporal cache，首 chunk 9 像素帧、后续每 chunk 12 帧。decoder 不支持流式或当前 shape 需 tiling 时走独立 decode，会损失跨 block 连续性；不能把 fallback 的输出当作同一时间线。
- **纯 Ulysses 与 VAE 宽度分片**：当前代码支持 strict Ulysses，默认在多 rank 上复用同一 group 做 VAE width sharding；每 rank 通过 all-gather 得到完整输出。可用 `lingbot_vae_spatial_sharding=False` 保留 DiT SP 而关闭 VAE 分片。边界卷积的累加顺序不同，不能承诺 bitwise 等价。
- **KV reuse 与精度**：`lingbot_reuse_last_step_kv=True` 省去 clean-latent writeback，但存储的是最后 noisy probe 的 KV；它与 online FP8 都需要 scene/seed/trajectory/长 session 的独立质量对照。
- **文档漂移**：该 pin 的 recipe 尾部仍有“无 stateful streaming VAE / SP 未支持”的旧说明；能力边界按 pinned pipeline、deploy 与测试核对，不合并相互矛盾的声明。
- 来源：[decode 与 fallback](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/pipeline.py#L1762)、
  - [parallel validator](https://github.com/vllm-project/vllm-omni/blob/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world/pipeline.py#L249)。

### 怎样验证功能、精度和性能

- 按 [[execution-validation]]（运行与验证） 的分层入口验证 request/control、DMD math、session cleanup、真实 checkpoint parity 和持续输出 cadence。结构 fixture 与 CPU mock 只验证对应合同；本页的源码核对不替代 GPU、真实权重、长 session 或端到端性能验证。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/lingbot-world/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:vllm_omni/diffusion/models/lingbot_world/pipeline.py；vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:vllm_omni/diffusion/models/lingbot_world/transformer.py
  - vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:vllm_omni/diffusion/models/lingbot_world/camera.py；vllm-project/vllm-omni@9cf443a7bb24d6b8007981311466d769ec13b3d8:vllm_omni/diffusion/models/lingbot_world/dmd_block.py
- 置信度（confidence）：high
