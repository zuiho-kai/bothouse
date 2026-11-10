---
name: cosyvoice3-overview
description: "CosyVoice3（FunAudioLLM，main @ f90e992d 复核）目录入口：单 registry 入口 CosyVoice3Model 按 model_stage 分发 talker / code2wav 两个 stage、DiT 估计器不在 diffusion registry、各入口路径、HiFTGenerator 与 Step-Audio2 / MiniCPM-o 共用（PR #5869）、STFT window 为 nonpersistent buffer（PR #6424）、运行模式轴（async_chunk / --no-async-chunk / COSYVOICE3_TRT 默认开）、cosyvoice3.yaml 全局 fp32 与按 H100 调的连续性警告"
metadata:
  scope: 只收 CosyVoice3 的名称、stage 拓扑、入口路径、配置差异和目录路由；数据流、RAS 停止与 TRT 细节归 cosyvoice3-architecture，COSYVOICE3-* 规则归 cosyvoice3-rules，COSY-* 规则归 rules-conditioning-handoff、rules-streaming-graphs、rules-packed-inference、rules-f0-device
---
# CosyVoice3

## 现状

- 以下事实在 `main @ f90e992d` 复核。

### 名称与范围

- CosyVoice3（FunAudioLLM;示例注释默认 `FunAudioLLM/Fun-CosyVoice3-0.5B-2512`,YAML 不 pin）,代码/pipeline 标识 `cosyvoice3`。
- **单 registry 入口服务两个 stage**：`CosyVoice3Model` →（`cosyvoice3`, `cosyvoice3`）,`__init__` 按 `model_stage` 分发（`cosyvoice3_talker` → Qwen2 系 LM;`cosyvoice3_code2wav` → CFM+DiT+HiFT; 其他 raise）——**stage 1 没有独立 `model_arch`**。改 vLLM 模型加载/`model_stage` 管线的 rebase 最先撞上本家族。
- stage 拓扑：stage 0 talker（LLM_AR,`owns_tokenizer`, `engine_output_type="latent"`）→ stage 1 code2wav（LLM_GENERATION, `engine_output_type` 也写 `"latent"`——见 architecture 的未决项, `final_output_type="audio"`）;两 stage 复用同一 pipeline 级架构。
- DiT 估计器住在 `diffusion/models/cosyvoice3_audio/cosyvoice3_dit.py` 但 **不在 diffusion registry**——被 code2wav 直接 import（借 diffusion Attention 优化后端,绕开 registry;pin 上唯一 importer）。
- 入口路径：registry `vllm_omni/model_executor/models/registry.py` 与 `vllm_omni/config/pipeline_registry.py`;拓扑 `model_executor/models/cosyvoice3/pipeline.py`;
  - 桥 `model_executor/stage_input_processors/cosyvoice3.py`;serving 适配 `entrypoints/openai/tts_adapters/cosyvoice3.py`（`CosyVoice3Adapter`,`stage_keys={"cosyvoice3_talker"}`）;TRT `flow_estimator_trt.py`/`speaker_embedding_trt.py`。
- 依赖共享模块：[[diffusion-overview]]（Diffusion 组件）的 Attention 层、SharedMemoryConnector（stage 间码流）、[[configuration-architecture]]（Config 组件）。
- 树内 `code2wav_core/hifigan.py::HiFTGenerator` 也是 Step-Audio2 与 MiniCPM-o graph wrapper 的 shared consumer：pre-iSTFT magnitude/phase 与 eager iSTFT/clamp 必须保持同一 inference 合同，修改时三家一起做 state-dict、音频与 graph/eager parity。^[PR #5869]
- `CausalHiFTGenerator` 的 STFT window 是 nonpersistent buffer；`_stft/_istft` 在输入设备与 buffer 不同时迁移并复用它，因此 dummy loader 未调用 weight-loading hook 时也不会保留 CPU window。该 buffer 不进入 checkpoint；CosyVoice3 causal CPU/CUDA 回归应覆盖 module move 与首次 use-site move。^[PR #6424]

### 目录内容

| 遇到什么 | 查看哪里 | 说明 |
|---|---|---|
| live conditioning、full payload 与 token-only streaming | [[rules-conditioning-handoff]]（rules-conditioning-handoff） | 可执行约束与验收 |
| 有界 HiFT graph、precision signature 与 capability profile | [[rules-streaming-graphs]]（rules-streaming-graphs） | 可执行约束与验收 |
| packed Flow/HiFT、ragged frames、reference cache、RAS/standard | [[rules-packed-inference]]（rules-packed-inference） | 可执行约束与验收 |
| RAS 停止机制、双交接注册、TRT 门 | [[cosyvoice3-architecture]]（architecture） | 数据流与 reviewer 陷阱 |
| CosyVoice3 TensorRT CFM 的 stream handoff、allocator lifetime、context pool、plan 并发发布、tmp 所有权或 cleanup failure | [[cosyvoice3-rules]]（rules） | `COSYVOICE3-1a/1b` 的顺序、发布边界与验收   新增核对：COSYVOICE3-2a、COSYVOICE3-1c。 |

### 配置与 checkpoint 差异

- 单 pipeline key + 单 deploy;变体轴是**运行模式**：async_chunk 流式（默认）/ `--no-async-chunk` 同步全载荷 / `COSYVOICE3_TRT` 开关（**默认开**,`export COSYVOICE3_TRT=0` 关闭）。
- `cosyvoice3.yaml`：全局 `dtype: float32`（本清单唯一全局 fp32 家族）; code2wav `enforce_eager`（动态卷积形状不吃 CUDA graph）;头注给出 **GPU 级调参警告**——默认（seqs 8/chunk 15）按 H100 调（c=4 约 100% 流式连续性）,同配置 H20-3e 约 78%、更小 batch/chunk 约 86%（头注近似数字,按工况波动）;慢卡先降 `max_num_seqs`/`codec_chunk_frames`, `connector_get_sleep_s` 是最后手段。
- pin 上 **无 recipe 文件**（moss/fish/indextts2 都有）。

### 什么时候查这里

- 审查 cosyvoice3 的停止逻辑、流式 chunk 数学或 TRT 引擎构建;跨 GPU 部署性能问题先读 YAML 头注的连续性数据。
- 语义验收见 [[model-validation]]（model-validation）。
- [[rules-f0-device]]（标准FP32 F0、TF32恢复与nativevocoder）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/cosyvoice3/_index.md`（InferMatrixCopilot@ecfb84d0）；title: CosyVoice3（单架构双 stage,RAS 合并停止,TRT 加速）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-09-22
- 来源（sources）：PR #5673；PR #5869；PR #6424；PR #6955；vllm_omni/data_entry_keys.py；vllm_omni/model_executor/models/cosyvoice3/；vllm_omni/deploy/cosyvoice3.yaml；vllm_omni/model_executor/stage_input_processors/cosyvoice3.py；vllm_omni/transformers_utils/configs/cosyvoice3.py
