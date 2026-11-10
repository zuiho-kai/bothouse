---
name: dreamzero-overview
description: DreamZero（DreamZero-DROID VLA 世界模型，main @ 5d44868e）目录入口：DreamZeroPipeline 单 stage DIFFUSION 每步联合预测 video 与 action、dreamzero.yaml 显式选 ARDiffusionEngine、hf_utils.py::_looks_like_dreamzero 的 VLA checkpoint 自动探测、OpenPI 观测合同、checkpoint 权重前缀布局、两份 deploy 的差异（dreamzero_tp1_cfg2.yaml 缺 engine_backend 行）、关键默认（16 步、CFG 5.0、seed 1140）
metadata:
  scope: 只收 DreamZero 的名称、拓扑、引擎选择、自动探测、deploy 与 checkpoint 差异；双 scheduler、会话 / KV 语义和 step-cache 跳步的数据流归 dreamzero-architecture，另一 OpenPI VLA 家族归 gr00t-overview
---
# DreamZero

## 现状

- 以下事实在 `main @ 5d44868e` 复核。

### 名称与范围

- 名称:分析所据的模型形态是 DreamZero-DROID VLA 世界模型（树内多以简称 DreamZero 指代;代码标识:pipeline key `dreamzero`,registry 架构键 `DreamZeroPipeline`）：一个 DiT 每步联合预测 `(video_pred, action_pred)`, 视频逐块自回归、动作按 horizon 输出。
  - diffusion registry: `DreamZeroPipeline` →（`dreamzero`, `pipeline_dreamzero`, `DreamZeroPipeline`）;**无 post/pre-process 绑定、无 AR registry 入口、无 stage input processor**。
- 拓扑（`model_executor/models/dreamzero/pipeline.py`）：单 stage 0, `execution_type=DIFFUSION`,`final_output=True`,名义 `final_output_type="image"`（实际输出 actions+video latents,见 architecture）;stage 名 `model_stage="diffusion"`（本清单其余视频家族用 `"dit"`）。
  - **单一 registry 架构,无 T2V/I2V/DMD2 分支**——变体只有 deploy 两份与数据侧 embodiment 变换（droid/roboarena,都映射 OXE_DROID,按请求 `robot_obs["embodiment"]` 回退 `default_robot_embodiment` 选择）。
- **换引擎**：`dreamzero.yaml` 显式选择 `engine_backend: …experimental.ar_diffusion.engine.ARDiffusionEngine`（引擎级分页 KV;pipeline 自述 "engine-only"——所有自注意力 KV 由 AR-Diffusion runner 注入）。
- **VLA checkpoint 自动探测**：`hf_utils.py::_looks_like_dreamzero`—— config.json `model_type=="vla"` **且** `action_head_cfg._target_` 指向 `…wan_flow_matching_action_tf.WANPolicyHead` **且** `diffusion_model_cfg._target_` 指向 `…wan_video_dit_action_casual_chunk.CausalWanModel` → 自动解析到
  - `dreamzero.yaml`（有专测钉住）。
- 自身观测合同：OpenPI 客户端,`extra_args["robot_obs"]`、`needs_session_id`、`extra_args["reset"]`;相关页: [[gr00t-overview]]（gr00t）（另一 OpenPI 服务的 VLA 家族,独立实现）。
- 依赖共享模块：`experimental/ar_diffusion/`（引擎/runner/paged KV）、[[diffusion-overview]]（Diffusion 组件）（CFGParallelMixin、DistributedAutoencoderKLWan）、step_cache 后端。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 双 scheduler、KV 会话语义、step-cache 跳步 | [[dreamzero-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异

- checkpoint 布局特殊：全部权重在 `model-*.safetensors` 的 `action_head.{model,text_encoder,image_encoder,vae}.*` 前缀下（加载时 remap）;`experiment_cfg/metadata.json` 存各 embodiment 动作归一化统计; `vae/` 指向 Wan2.1 diffusers VAE。
- 两份 deploy：`dreamzero.yaml`（单卡,step_cache 开, `velocity_sim_thresholds [0.95, 0.93]`）与 `dreamzero_tp1_cfg2.yaml`（双卡,`tensor_parallel_size: 1` + `cfg_parallel_size: 2`,两卡分跑正/负 CFG 分支;**此文件缺 `engine_backend:` 行**,与默认 YAML 不一致—— 引擎是否经其他路径仍被选中 pin 上未追清,评审改这两份 YAML 时先澄清）。
- 关键默认（`utils.py`）：16 步、CFG 5.0、sigma_shift 5.0、seed 1140、内置长负向 prompt、embodiment 名→id 表。

### 什么时候查这里

- 审查 dreamzero 的引擎交互、会话/KV 语义或 step-cache 阈值;它显式选用 AR-Diffusion 引擎,引擎改动拿它做回归。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/dreamzero/_index.md`（InferMatrixCopilot@ecfb84d0）；title: DreamZero（VLA 世界模型,视频+动作联合流匹配,AR-Diffusion 引擎）；type: index；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/dreamzero/；vllm_omni/deploy/dreamzero.yaml；vllm_omni/diffusion/utils/hf_utils.py
