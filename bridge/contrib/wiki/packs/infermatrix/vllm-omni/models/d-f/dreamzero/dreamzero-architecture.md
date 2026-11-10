---
name: dreamzero-architecture
description: DreamZero 架构（main @ 5d44868e）：CausalWanModel（按块 AR、滑窗注意力、分页 KV、fused_qk_rms_norm）、条件侧编码器与 DreamZeroState 的三级 reset、双 scheduler 合同（CFG 只作用视频，动作永远取正分支）、逐块 AR 主流程与 step_cache 跳步、输出是 actions 加视频 latent 而非帧、torch.compile 路径、验证入口（DZ_PHASE_TIMING 计时插桩 benchmark 时关闭）与已知未决
metadata:
  scope: 只收 DreamZero 的模块边界、scheduler / CFG 合同、数据流和验证现状；入口、自动探测条件与 deploy 速览归 dreamzero-overview
---
# DreamZero 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;入口/deploy 速览见 [[dreamzero-overview]]（index）。

### 模型专有部分与共享模块的边界

- `CausalWanModel`：因果 Wan 风格 DiT——按块 AR（`num_frame_per_block`）、滑窗注意力（`local_attn_size`）、动作 token RoPE、**分页 KV 集成**（`ARDiffusionPagedLayerInputs`,"Inference only: kv_cache is required"）; 融合内核:`fused_qk_rms_norm`（q/k RMSNorm 的 TP all-reduce 合一）+ 单发 QKV GEMM。
- 条件侧：UMT5 文本（显式 UMT5Config,tokenizer 默认 `google/umt5-xxl`）、树内 CLIP 风格 `DreamZeroImageEncoder`、`MultiEmbodimentActionEncoder`（`CategorySpecificLinear/MLP` 按 embodiment 索引参数）。
- 会话态 `DreamZeroState`：拼帧缓冲（首调 1 帧,之后每次 4 帧）、视频 latent 累积、语言/prompt-embed 缓存;reset 分级——显式 `extra_args["reset"]` / prompt 变更的 session reset / 滑窗越界的 inference reset（保留累积 latent）。
- 共享：`DistributedAutoencoderKLWan`（增量/流式 VAE encode,feat-cache 跨块携带;`wan_vae_feat_cache_patch` 把 "Rep" 字符串哨兵换成 int8 张量以兼容 `torch.compile(fullgraph=True)`）、CFGParallelMixin。

### 配置、checkpoint 和兼容范围

- checkpoint 布局：根 `config.json`（含 `action_head_cfg`）;全部学习权重在 `model-*.safetensors` 的 `action_head.{model,text_encoder,image_encoder, vae}.*` 前缀下（加载时 remap）;`experiment_cfg/metadata.json`（按 embodiment 的动作归一化统计）;`vae/` 指向 Wan2.1 diffusers VAE。自动探测条件见 [[dreamzero-overview]]（index）。
- 两份 deploy 差异：`dreamzero.yaml`（单卡,显式 engine_backend）vs `dreamzero_tp1_cfg2.yaml`（双卡 `cfg_parallel_size: 2`,**缺 engine_backend 行**——引擎是否仍被选中是未决边界）;其余(step_cache、policy config、bf16)一致。
- **双 scheduler 合同**：视频与动作各一个 `FlowUniPCMultistepScheduler`, 由 `VideoActionScheduler` 统一 `.step()`;CFG 只作用视频,**动作永远取正分支**（类 docstring 与 `combine_cfg_noise` override 明示）——给动作 "补上 CFG"的 PR 违反设计。
- CFG-parallel 时 `_synchronize_cfg_parallel_step_output` 保证两 rank 步间位级一致。
- 动作输出按 embodiment 统计反归一化;`relative_action=True` 且 `relative_action_dim=7`（DROID:关节相对、gripper 绝对）。

### 从输入到输出的主要流程

1. OpenPI 观测经 `robot_obs` → 注册的 `RobotPolicyTransform`（droid:2×2 拼图,腕视顶部双宽;roboarena 仅相机键 0 基差异）; `"dummy run"`+1 步+无 robot_obs = warmup,返回零动作。
2. 逐块 AR:VAE 流式 encode 新帧 → DiT 按块前传（KV 由引擎注入,跨注意力 K/V 每会话每 CFG 半支缓存一次）→ 16 步去噪,**step_cache 跳步**（前后 flow 预测速度相似度超阈值即复用缓存预测）。
3. 输出 `{"actions": (horizon, max_action_dim), "video": 归一化 VAE latent}`——**视频是 latent 不是帧**,解码走 `decode_video_latents()` worker RPC;stage 的 `final_output_type="image"` 是名义值。
4. torch.compile 路径（`enforce_eager: false`）编译文本/图像编码器、VAE decode、逐块 DiT;增量 VAE encode 保持 eager;`warmup_compile()` 预热。

### 怎样验证功能、精度和性能

- pin 上有 `tests/e2e/accuracy/test_dreamzero.py` 与较全的 `tests/diffusion/models/dreamzero/` 单测;本次调查未发现性能 gate——但有 `DZ_PHASE_TIMING=1` 分相计时插桩（逐 mark 同步 CUDA,**benchmark 时应关闭**,源注释明示）。共享设施见 [[diffusion-overview]]（Diffusion 组件）。
- 单测：`tests/diffusion/models/dreamzero/`（crossattn cache、fused_qk_rms_norm、QKV 融合、pipeline state、utils、OpenPI helper）;e2e `tests/e2e/online_serving/test_dreamzero_expansion.py`;配置解析 `tests/entrypoints/test_resolve_dreamzero_config.py`;
  - 示例 `examples/{offline_inference,online_serving}/dreamzero/`（含预测视频导出与 DROID 仿真评测客户端）。
- 已知未决：`dreamzero_tp1_cfg2.yaml` 缺 engine_backend 行的实际效果; actions-dict 输出在 serving 层的类型化;`MAX_DREAMZERO_SESSIONS` 取值与每会话 KV 显存开销。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/dreamzero/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/dreamzero/pipeline_dreamzero.py；vllm_omni/diffusion/models/dreamzero/causal_wan_model.py；vllm_omni/diffusion/models/dreamzero/state_dreamzero.py；vllm_omni/deploy/dreamzero.yaml
