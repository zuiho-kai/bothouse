---
name: wan2-2-architecture
description: "Wan 2.2 架构（main @ b98b7c85）：WanTransformer3DModel 的 TP 与 _sp_plan、S2V 栈（wav2vec2、AudioInjector_WAN、motion-frame AR 链）、双专家 boundary 合同与 guidance_high / guidance_low、DMD2 mixin 与 _sanitize_dmd2_request、FastVideo WanDMD 三步 flow path（PR #4820）、distilled LoRA 按位置绑定双 transformer、各变体 pre/post 流程与帧插值、unit / e2e / accuracy / dfx 验证面（PR #6343、PR #5969）"
metadata:
  scope: 只收 Wan 2.2 的模型专有部分、配置与兼容范围、主要流程、验证面与已知未决；registry 映射与入口速览归 wan2-2-overview，共享 diffusion 设施归 diffusion-overview
---
# Wan 2.2 架构

## 现状

- 事实在 `main @ b98b7c85` 复核;变体/入口速览见 [[wan2-2-overview]]（index）;共享 diffusion 设施见 [[diffusion-overview]]（Diffusion 组件）。

### 模型专有部分与共享模块的边界

- `WanTransformer3DModel`：TP 化层 + `DistributedRMSNorm` + `_sp_plan`（rope 分/proj_out 收/逐块边界;为让 SP 能挂钩,专门造了 `TimestepProjPrepare`/`OutputScaleShiftPrepare` 包装模块）;VACE 变体 **重锚分片点**到 VACE context 汇入前的 Identity（不是 blocks.0）。
- S2V 栈（57 KB pipeline + 75 KB transformer）：wav2vec2 音频编码（捆绑 `wav2vec2-large-xlsr-53-english/`,缺了回退 facebook 仓）、`AudioInjector_WAN`、motion-frame AR 链（默认 73 motion/80 infer 帧, fps 16）、可选 pose 视频;支持 diffusers 与原始格式 checkpoint（T5→UMT5 state-dict 转换）;输出 `(video, audio, sr)` 三元组。
- 共享:UMT5 文本编码、`DistributedAutoencoderKLWan`（decode 前按 `latents_mean/std` 归一化）、CFG-parallel（wan 用 `cfg_normalize=False`）、`PipelineParallelMixin`（非末 PP stage 返回 `IntermediateTensors`）。

### 配置、checkpoint 和兼容范围

- **双专家 boundary 合同**：去噪时 `t < boundary_timestep` 用 `transformer_2`+`guidance_high`,否则 `transformer`+`guidance_low`;缺失专家回退到已加载者;`boundary_ratio` 同时是部分加载开关（见 index）。
- scheduler 分变体：T2V/I2V/VACE 按请求可重建——`sample_solver` unipc（默认,flow_shift 5.0）/ euler（自研 `WanEulerScheduler`）;S2V 固定 FlowUniPC、flow_shift 3.0;DMD2 换 `DMD2EulerScheduler`（见下,且禁止被换回）。TI2V 的 `expand_timesteps` 做首帧掩码混合 + 按 patch 展开时间步。
- **DMD2 合同**（`dmd2/mixin.py`,mixin 必须在 MRO 前面）：`__init_dmd2__` 把 scheduler 换成 `DMD2EulerScheduler`（config 来自 `model_index.json["dmd2_config"]`,默认 4 步）; `_sanitize_dmd2_request` 强制步数/guidance、清负向 prompt、**并从 extra_args 里剥掉 `sample_solver`/`flow_shift`**——防止基类把 scheduler 换回去。
  - 给 DMD2 变体"加回 CFG/负向"的 PR 违反此合同。
- **FastVideo WanDMD 合同**：checkpoint 的 `_class_name="WanDMDPipeline"` 以 `diffusers_class_aliases` 发现后仍复用 `Wan22Pipeline`，但固定 Euler、shift `8.0`、timesteps `(1000, 757, 522)`，并把 guidance 缺省值改为 `1.0`；
  - 它忽略 request 的步数（包括 engine warmup）和 solver/shift override，并在每一步按 `predict_clean → add_noise(next timestep)` 推进。这与 DMD2 mixin 是两套调度契约，不能合并或相互覆盖。所有 Wan T2V/I2V/S2V/VACE loader 都通过 shared helper：checkpoint 缺少 `to_gate_compress` 时删除零初始化 projection，有权重时保留 learned gate；这项 loader 清理不代表这些变体都受 VSA 正式支持。
  - 当前正式范围仅是 `FastVideo/FastWan2.2-TI2V-5B-Diffusers` 通过 `Wan22Pipeline` 提供的 T2V/I2V 模式，独立 I2V-14B、S2V 与 VACE pipeline 均在范围外。^[PR #4820]
- 量化:每 transformer 独立解析 `quantization_config`,双专家可各自量化。
- distilled LoRA 同样按 architecture-declared transformer ownership 分开：T2V/I2V 及其 DMD2 子类的 mixin 读取 `has_transformer_2`，要求位置 0/1 分别对应 `transformer`/`transformer_2`，并通过具名 getter 避免两个 delta 都落到第一 transformer。boundary 即使少加载一个 target 也不减少 path cardinality；
  - 该 startup fusion 是 server-lifetime 状态，不改变请求协议，VACE/S2V 未接入。

### 从输入到输出的主要流程

1. pre-process 按变体:T2V/TI2V 可选图像（720×1280 面积,16 对齐）;I2V 必须图像（首帧 latent 通道拼接 + 可选 Wan2.1 式 CLIP image embeds）;VACE 接 `image`/`reference_images`、`video`、`mask` 映进 additional_information;S2V 需图像+音频,另接可选 `pose_video` 与 `init_first_frame`。
2. 去噪:适用变体在 `transformer_2` 存在时按 boundary 切换专家（**S2V 单 transformer,无 boundary**;VACE 两种形态都接受）;CFG 双分支跨 rank;RNG per-request generator。
3. `empty_cache()` → VAE decode（源注释:Wan2.2 易 OOM）→ post-process; 可选**帧插值**（`interpolate_video_tensor`,报告 `video_fps_multiplier`）在 `get_wan22_post_process_func` 上有据——它绑定 T2V/TI2V 与 DMD2 T2V;其余变体的 post 函数未逐一追,不断言其有无。

### 怎样验证功能、精度和性能

- 可用验证面：unit 七个测试模块 + conftest（`tests/diffusion/models/wan2_2/`,含 diffuse/quant/各变体 pipeline）、e2e（t2v 离线/在线、W4A16）、**accuracy**（`tests/e2e/accuracy/wan22_i2v/` 视频相似度对 diffusers CP 基线）、dfx（perf/reliability/stability）。上列家族测试中未见 DMD2 专属测试（未做穷举核对）。
- stability JSON 将 A14B I2V 的两卡 CUDA case 标记为 `H800`，并单列两卡 NPU `A3` case（`usp=2`、VAE patch parallel=2、HSDP、VAE slicing）；nightly 必须以对应硬件 pytest marker 选择，不能从同一文件的模型或 `diffusion` family marker 推断可在另一后端运行。这些配置只声明收集和启动参数，不构成任何 24-hour 稳定性运行已通过的证据。^[PR #6343]
- 树内已无原 Wan2.2 ModelOpt FP8 exporter，也没有该模型专用的 quantization export example；审查与验证不得继续引用已删除的 example 路径。副本数据并行示例仍为 `examples/online_serving/replica_data_parallel/wan2_2_ti2v_dp.yaml`。^[PR #5969]
- 已知未决：六架构如何按 checkpoint 选择（解析链在家族外）; `wan2_2_ti2v` key 是否用于 A14B 双专家 checkpoint 是配置惯例问题,代码不强制。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/wan2-2/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-09-02
- 来源（sources）：PR #2783；PR #5969；PR #4820；PR #6343；vllm_omni/diffusion/lora/loader.py；vllm_omni/diffusion/models/wan2_2/pipeline_wan2_2.py；vllm_omni/diffusion/models/wan2_2/pipeline_wan2_2_i2v.py；vllm_omni/diffusion/models/wan2_2/wan2_2_transformer.py
  - vllm_omni/diffusion/models/wan2_2/pipeline_wan2_2_s2v.py；vllm_omni/diffusion/models/dmd2/mixin.py；tests/dfx/stability/tests/test_wan22.json
