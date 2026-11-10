---
name: glm-tts-overview
description: "GLM-TTS 入口：pipeline key glm_tts（Llama 基座 AR → glm_tts_dit），按 bucket 捕获 DiT CUDA graph 的 wrapper，glm_tts.yaml 的渐进分块 [25, 50, 200]、stage 1 float32 与 RAS 采样，以及 PR #5769 在两张 48 GB RTX 4090 上的社区双 GPU recipe 证据（wall time 降 8.2% / 11.4% / 1.6%）"
metadata:
  scope: 只收 GLM-TTS 的命名、关键文件、deploy 配置和社区双 GPU 部署观测；该模型没有单独的架构页或规则页，TTS 语义验收方法归 model-validation
---
# GLM-TTS

## 现状

- 以下源码与 recipe 在 `main @ 926e7fbf` 复核。部署观测是社区 recipe 的有界证据，不是通用硬件支持或性能保证。

### 名称与范围

- 正式名称 GLM-TTS,无别名、无变体有据。AR registry: `GLMTTSForConditionalGeneration` →（`glm_tts`, `glm_tts`, `GLMTTSForConditionalGeneration`）; 家族目录 `vllm_omni/model_executor/models/glm_tts/`（8 个文件）。
- pipeline key `glm_tts`：stage 0 AR（Llama 基座,LLM_AR,latent;stop token 为 "👂" id 59253,代码注释称按 tokenizer 动态解析校验）→ stage 1 `glm_tts_dit`（LLM_GENERATION,音频）。
- 依赖共享模块：[[configuration-architecture]]（Config 组件）; vocoder 为家族内 `HiFTWrapper`/`Vocos2DWrapper` + `ConvRNNF0Predictor`。

### 结构与 serving

- 关键文件：`glm_tts.py`（61 KB,AR + MM processor）、`glm_tts_dit_wrapper.py`（57 KB,`CUDAGraphGLMTTSDiTWrapper`——**按 bucket 捕获 DiT CUDA graph, eager 兜底**）、`glm_tts_dit.py`（ConvNeXtV2/AdaLayerNormZero blocks）、`text_frontend.py`（文本归一化）、`voice_clone.py`。
- stage 交接：`stage_input_processors/glm_tts.py` 的 `ar_to_dit` 与 `ar_to_dit_async_chunk`。
- deploy `glm_tts.yaml` 未 pin checkpoint;`async_chunk: true`, SharedMemoryConnector 渐进分块 `codec_chunk_frames: [25, 50, 200]` + 0.1 s crossfade;stage 0 bf16、stage 1 **float32**（注释：Euler ODE 10×2 趟会累积半精度嘶声）且 `use_dit_cuda_graphs: true`;RAS 采样 `hf_overrides`（`sample_method: ras` + top-k/p 窗口）;
  - 标注 1×A40 验证（~16.6 GiB）。

### 社区双 GPU 部署证据（非默认合同）

- PR #5769 的作者在两张各报告 49,140 MiB 的**非标准 48 GB RTX 4090**上验证过该 recipe；它不适用于或证明 stock 24 GB RTX 4090。该次环境为 Ubuntu 22.04.1、driver 580.76.05、Python 3.12.13、PyTorch 2.11.0+cu130、CUDA 13.0、vLLM 0.26.0、vLLM-Omni `0.26.0rc2.dev5+g66a9b0c84` 与 FlashInfer 0.6.14。
  - 宿主 `nvcc` 为 11.8 时，作者将 `CUDA_HOME` 指向虚拟环境内的 CUDA 13 toolkit；这是该环境的启动前提，不是 deploy YAML 的可移植默认值。
- 该 recipe 保持 bundled `glm_tts.yaml` 为配置真源：默认 async-chunk，将可见 GPU 设为 `0,1` 后以 `--stage-overrides '{"1":{"devices":"1"}}'` 把 stage 1 放到 GPU 1，stage 0 留在 GPU 0；需要同步变体时只加 `--no-async-chunk`。`--omni`、`--trust-remote-code`、`--deploy-config vllm_omni/deploy/glm_tts.yaml` 与受限本地 media path 都是该已报告命令的一部分。
- 作者以同一中文 prompt/reference、并发 1、一次 warm-up 后三次测量，报告双卡相对单卡的 async 非流式、async 流式和同步 wall time 分别降低 8.2%、11.4% 和 1.6%；async 流式 TTFA 报告降低 6.0%。这些是单次受控运行的作者观测，不能外推到其他 GPU、driver、workload 或当前 head。中英文 voice-cloning smoke 均报告为 24 kHz 单声道 PCM WAV；复现时应先以 `ffprobe` 验证输出格式，再报告延迟或 RTF。^[PR #5769]

### 什么时候查这里

- 审查 GLM-TTS 的 DiT CUDA-graph bucket、渐进分块流式或精度（fp32 stage 1）改动;想改 stage 1 精度先看 YAML 注释的 hiss 依据。
- 语义验收见 [[model-validation]]（model-validation）。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/glm-tts/_index.md`（InferMatrixCopilot@ecfb84d0）；title: GLM-TTS（AR + flow-matching DiT 流式 TTS）；type: index；tags: vllm-omni, models；created: 2026-07-21；updated: 2026-09-04
- 来源（sources）：vllm_omni/model_executor/models/glm_tts/；vllm_omni/deploy/glm_tts.yaml；vllm_omni/config/pipeline_registry.py；recipes/zai-org/GLM-TTS.md；PR #5769
