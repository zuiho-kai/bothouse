---
name: voxcpm2-overview
description: VoxCPM2（OpenBMB，MiniCPM4 基座单 stage AR TTS，48 kHz，main @ 5d44868e）目录入口：pipeline key 与 model_type voxcpm2、stage latent_generator、自定义调度器 VoxCPM2OmniARAsyncScheduler、LocDiT/AudioVAE 扩散侧路在 talker 步循环内、VoxCPM2Adapter 与 prompt 链、voxcpm2_runtime_config 约 25 个 knob、kv_cache_memory_bytes 6 GiB 定额的显存特例、构建即 import 外部原生包
metadata:
  scope: 只收 VoxCPM2 的名称、registry、pipeline、serving 入口、配置与显存策略速览及规则页路由；模型链与数据流归 voxcpm2-architecture，VOXCPM2-2a 与 3a 归 voxcpm2-rules，VOXCPM2-NPU-1a 归 rules-npu-graphs
---
# VoxCPM2

## 现状

- 以下事实在 `main @ 5d44868e` 复核。

### 名称与范围

- 正式名称 VoxCPM2（OpenBMB;示例/测试用 `openbmb/VoxCPM2`,YAML 不 pin); 无其他官方别名有据。代码标识（非别名）：pipeline key/model_type `voxcpm2`;模块名 `voxcpm2_talker`;架构类 `VoxCPM2TalkerForConditionalGeneration`;stage 键 `latent_generator`。MiniCPM4 基座单 stage AR TTS,文本一趟直出 **48 kHz**（全清单多数 TTS 是 24 kHz,metrics 定义单列）。
- AR registry 单入口 `VoxCPM2TalkerForConditionalGeneration` →（`voxcpm2`, `voxcpm2_talker`）;**无 diffusion registry 入口**—— LocDiT/AudioVAE 扩散计算在 talker 步循环内部（"扩散侧路"）。
- pipeline key `voxcpm2`：单 stage `latent_generator`（LLM_AR, `owns_tokenizer`,`final_output=True`,`engine_output_type="audio"`, 采样约束 `detokenize=False` + stop_token_ids `[1]`）;**声明自定义调度器** `scheduler_cls=…voxcpm2.scheduler.VoxCPM2OmniARAsyncScheduler`（少数换 scheduler 类的家族）。
  - 无 stage input processor（单 stage 无桥）。
- config 管线特判：`arg_utils.py` 把 arch 映射到 model_type `voxcpm2` 并注册 `VoxCPM2Config`;`config_factory.py` 处理其单数 `architecture` 键。
- 依赖共享模块：AR runner 的 `get_runner_assisted_full_attention_metadata_request` 钩子（`gpu_ar_model_runner.py`,NPU runner 有镜像）、`utils/speaker_cache`（`_validate_voxcpm2_profile`）、[[configuration-architecture]]（Config 组件）。
- serving 入口：`entrypoints/openai/tts_adapters/voxcpm2.py`（`VoxCPM2Adapter`,stage key `latent_generator`;声音校验:零样本 + 预计算 profile,拒绝纯 embedding 上传）;prompt 链 `serving_speech._build_voxcpm2_prompt` → talker 模块的 `build_voxcpm2_prompt`。

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| 混合 AR+扩散、统一 decode graph、显存策略 | [[voxcpm2-architecture]]（architecture） | 数据流与 reviewer 陷阱 |

### 配置与 checkpoint 差异

- 单 pipeline key、单 deploy——无拓扑/checkpoint 变体;运行期变化来自 `hf_overrides.voxcpm2_runtime_config` 加上平台能力回退（CUDA graph / torch.compile 可用性检查、`decode_graph_capture_policy`）。
  - runtime_config（~25 个 knob 的冻结 dataclass:LocDiT 融合、CFM/VAE CUDA graph、统一 decode graph、发射节奏、确定性噪声/seed;未知键告警,冲突有 `_normalized()` 消解——batched CFM 赢过 CFM graph）。
- **显存策略特例**：`kv_cache_memory_bytes: 6442450944`（6 GiB 定额）而非 `gpu_memory_utilization`——LocDiT/VAE/graph 池的分配对 KV 记账不可见, 定额让 H20 141 GB 与 L4 24 GB 同配置可跑（YAML 注释详述）。
- **构建即 import 外部原生 VoxCPM2 包**（`import_voxcpm2_core`,连 `load_format=dummy` 也要,文档注明有意为之）;pin 版本不可见于树内。

### 什么时候查这里

- 审查 voxcpm2 的 runtime knob、统一 decode graph/调度器协作或显存策略; 评审"统一改用 gpu_memory_utilization"类清理时本家族是刻意例外。
- 语义验收见 [[model-validation]]（model-validation）。
- [[voxcpm2-rules]]（rules）：VOXCPM2-2a 的请求噪声隔离与 VOXCPM2-3a 的 LocDiT 参数/solver 边界。
- [[rules-npu-graphs]]（NPU estimator exact graphs 与延迟平台注册）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/voxcpm2/_index.md`（InferMatrixCopilot@ecfb84d0）；title: VoxCPM2（单 stage AR + 模型内扩散侧路,48 kHz）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-10-06
- 来源（sources）：vllm_omni/model_executor/models/voxcpm2/；vllm_omni/deploy/voxcpm2.yaml；vllm_omni/worker/gpu_ar_model_runner.py
