---
name: gr00t-architecture
description: GR00T N1.7 架构：Gr00tN1d7Pipeline 读 robot_obs 返回 actions，Gr00tPolicy 完全自加载权重，_Qwen3VLBackbone 截到 select_layer=12 并丢 lm_head，多 embodiment 流匹配动作头（4 步去噪、horizon 40），启动校验与不校验的 supported_embodiments，GR00T_NOISE_SEED 位级回归 e2e
metadata:
  scope: 只收 GR00T N1.7 的模块边界、默认配置与启动校验、观测到动作的流程和验证入口；pipeline key、serving 路由和 deploy 坑位速览归 gr00t-overview
---
# GR00T N1.7 架构

## 现状

- 事实在 `main @ 5d44868e` 复核;入口/坑位速览见 [[gr00t-overview]]（index）。

### 模型专有部分与共享模块的边界

- 目录分工：`model_executor/models/gr00t/` 只有拓扑（pipeline.py）;实现全在 `diffusion/models/gr00t/`;观测由 OpenPI serving 层经共享 diffusion 管线送入,**无 stage 桥、无 pre/post-process 函数**。
- 服务包装 `Gr00tN1d7Pipeline`：读 `robot_obs`（video/images、state、language/prompt 两种键都接受;`_normalize_observation`）, `extra_args["reset"]` 触发 `policy.reset()`;返回 `DiffusionOutput(output={"actions": dict[str, np.float32 ndarray]})`（把动作放进 `output` 以通过引擎空输出守卫——与 DreamZero OpenPI 策略同形）。
- **完全自加载权重**：`weights_sources=()` 且 `load_weights` 喂张量直接 raise——`Gr00tPolicy` 自己 `AutoModel.from_pretrained`（bf16）; 框架 loader 必须置身事外。
- backbone `_Qwen3VLBackbone`：`Qwen3VLForConditionalGeneration` 截到 `select_layer=12` 层并**丢 `lm_head`**（纯特征提取,省 ~0.58 GiB）。
- 动作头 `Gr00tN1d7ActionHead`：流匹配 DiT（默认 `AlternateVLDiT`,每 2 块 attend 一次文本）;**多 embodiment 权重库**——`CategorySpecificMLP`/`MultiEmbodimentActionEncoder` 按 embodiment 索引参数（上限 32）, `EMBODIMENT_TAG_TO_PROJECTOR_INDEX` 定投影槽。
- dataio 层：`StateActionProcessor`（minmax/meanstd 归一化,按 embodiment keyed norm params）、`ActionChunk` 家族（相对/绝对关节/EEF 表示）、`EmbodimentTag` enum（POSTTRAIN/FINETUNE_ONLY 分级）。

### 配置、checkpoint 和兼容范围

- 默认:horizon 40、state/action 维上限 132、**4 步**流匹配去噪、DiT 16 层 32 头。processor 随 checkpoint（`processor/` 子目录,AutoProcessor 兜底）; eval 图像 256×256 letterbox,对客户端宣告 `image_resolution [180,320]`。
- 启动时对 checkpoint 快速失败校验的是 `model_config.embodiment_tag`（`policy_server_config` 的兄弟字段）加 `policy_server_config.action_horizon/action_keys`; `supported_embodiments`（11 tag）**不校验**——改 YAML 时自查。
- 确定性:`GR00T_NOISE_SEED` 种子化采样噪声——位级可复现是 e2e 的断言基础。

### 从输入到输出的主要流程

1. OpenPI 客户端经 websocket 发观测（msgpack-numpy;`needs_session_id`）; serving 层转成引擎请求,观测进 `extra_args["robot_obs"]`。
2. processor 校验/变换观测（只用第一个 language key）→ backbone 提特征 → 动作头 4 步流匹配去噪。
3. `StateActionProcessor` 反归一化到真实单位,`ActionChunk` 转表示;DROID embodiment 输出 `eef_9d`/`gripper_position`/`joint_position`,形状 `[batch, 40, dim]`;warmup/dummy 请求按 norm params 出零动作块。

### 怎样验证功能、精度和性能

- pin 上有**位级回归**（对 Isaac-GR00T ZMQ 参考值 max_diff=0.0)——这是行为正确性 gate;无性能 gate;examples 缺失。
- e2e：`tests/e2e/online_serving/test_gr00t_openpi_expansion.py`（`GR00T_NOISE_SEED=42`,init 1200 s/stage 900 s,缺 `websockets`+ `openpi_client` 即跳过）;测试客户端 `tests/gr00t/openpi_client_helper.py`; 单测 `tests/diffusion/models/gr00t/test_pipeline.py`（stub policy,观测归一化/错误路径）;
  - 语义验收方法见 [[model-validation]]（model-validation）。
- 已知未决：`Gr00tPolicy.get_action` 可能返回 tuple 的第二元素语义; backbone config 是否需网络拉取 `nvidia/Cosmos-Reason2-2B`; `embodiment_configs.py` 只有类型转出、无表格的意图。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/gr00t/architecture.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: vllm-omni, models, diffusion；created: 2026-07-21；updated: 2026-07-21
- 来源（sources）：vllm_omni/diffusion/models/gr00t/pipeline_gr00t.py；vllm_omni/diffusion/models/gr00t/policy.py；vllm_omni/diffusion/models/gr00t/modeling/gr00t_n1d7.py；vllm_omni/deploy/Gr00tN1d7.yaml
