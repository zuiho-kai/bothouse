---
name: model-executor-overview
description: Model Executor 组件入口：源码入口（vllm_omni/model_executor/、model_extras/、worker/、inputs/、platforms/<cuda|musa|npu|rocm|xpu>/，main @ 44d3ae10 校验）、测试入口 tests/worker/ 与 tests/model_executor/、主要职责、何时查这里、不放什么，以及指向各 EXEC-* 与 VLLM-OMNI-PR* 规则页的目录对照表和链接列表
metadata:
  scope: 只收 model-executor 目录的入口说明、职责边界和“遇到什么查哪里”对照；共享职责与阶段边界归 model-executor-architecture，规则代码地图归 model-executor-rules-1，bridge/batch、loader、平台后端规则分别归 rules-bridge-batch-1、rules-loader-contract、rules-platform-backends-1
---
# Model Executor

## 现状

- [[rules-mrv2-optional-codec]]（MRv2 optional codec） — missing attribute 与 eager-MTP replay eligibility。
- 源码入口：`vllm_omni/model_executor/`（layers、model_loader、models、stage_input_processors）、`vllm_omni/model_extras/`（模型专有请求/prompt 转换）、`vllm_omni/worker/`（gpu_*_worker、gpu_*_model_runner、mixins）、`vllm_omni/inputs/`（runner 输入预处理）和设备平台层 `vllm_omni/platforms/<cuda|musa|npu|rocm|xpu>/`
- 源码校验：以上路径均已在 `main @ 44d3ae10`（upstream `main` 快照）验证存在；stage 配置已经迁移到 `vllm_omni/deploy/`，NPU/XPU 等平台可继续拥有自己的 worker 覆盖
- 测试入口：共享 runner 行为看 `tests/worker/`，具体模型 consumer 看 `tests/model_executor/`
- 主要职责：AR/LLM stage、stage 配置、并行与设备启动、runner 到模型的输入预处理合同和跨阶段数据桥接
- NPU trace 的 profiler metric、handler 和证据边界见 [[rules-npu-profiler]]（NPU profiler rules）。

### 什么时候查这里

- 调查模型执行 stage、stage config、并行度、设备映射或 worker 启动。
- 修改 runner `preprocess`、`_omni_*` 逐行 metadata、`talker_mtp`、chunked-prefill phase 或共享输入处理合同。
- 调查 AR 到 diffusion 的共享桥接。

### 不放什么

- diffusion denoise loop 的共享实现。
- 某个模型独有的 prompt、checkpoint 或 attention 逻辑。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| Breeze ROCm RNG fallback、CUDA generator registration或depth-layer Triton autotune | [[rules-breeze-rocm]]（Breeze平台合同） |
| 理解共享职责和阶段边界 | [[model-executor-architecture]]（architecture） |
| 根据 PR 描述直达 stage config、runner preprocess、stage runtime、bridge/batch 或 loader 的规则组与第一批源码 | [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（rules 与代码地图） |
| runtime info、跨 stage payload、batch 与 request RNG 合同 | [[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（跨 stage bridge 与 batch 合同） |
| loader 的 dtype/config 获取、fused shard 与多模块 checkpoint 载入 | [[rules-loader-contract]]（loader 合同） |
| shared image example envelope 与 model_extras 参数声明 | [[rules-image-task-envelope]]（image task envelope 合同） |
| Omni 输出类型、字段/复制合同与V2 native routed-expert auxiliary output | [[rules-output-contract]]（输出类型合同）   新增核对：EXEC-7c、EXEC-7d。 |
| 采样循环不变量、热路径缓存、AR 音频侧路、preprocess phase/one-token prefill | [[rules-runtime-hot-paths]]（运行时热路径合同） |

- （以下为原表格，按行改写为条目）
- 遇到什么：NPU runner、ROCm 分页注意力、NPU 模型补丁
  - 查看哪里：[[rules-platform-backends-1]]、[[rules-platform-backends-2]]（平台后端合同）   新增核对：EXEC-10f、EXEC-10f2。
- [[rules-attention-capture]]（MRv2 attention capture 边界） — mixed FULL、separate decode 与当前请求 boundary。
- [[rules-release-contracts]]（release processor/dummy、profiling、state selection 与 auxiliary output：EXEC-RELEASE-1a–1d）。
- [[rules-request-rng]]（显式seed、whole-MTPgraph与NVIDIA/ROCm抽样边界）。
- [[rules-output-snapshots]]（异步output slab、producer事件与storage所有权）。
- [[rules-mrv2-output-contracts]]（MRv2 aux tree、narrow sampler、sampled embedding 与 generation输出）。
- [[rules-settled-preprocess]]（settled row predicate与preemption replay fallback）。
- [[rules-autoround-dispatch]]（AutoRound NVFP4 method dispatch 合同）。
- [[rules-numeric-exactness]]（数值精确性与平台可移植性规则）
- [[rules-npu-kv-layout]]（Model Executor — NPU KV cache 布局规则）
- [[rules-compile-guard]]（Model Executor — Dynamo/cudagraph compile guard rules）
- [[rules-inc-autoround]]（Model Executor — INC/AutoRound 量化配置规则）
- [[rules-orchestration-loop]]（Model Executor — Orchestration Loop Rules）
- [[rules-minicpm-vision-units]]（MiniCPM duplex vision-only unit rules）
- [[rules-npu-base-image]]（Model Executor — NPU 基础镜像与 Ascend 升级规则）
- [[rules-minicpmo-turn-end-drain]]（MiniCPM-o duplex turn-end drain 规则）
- [[rules-mimo-audio-device]]（MiMo-Audio 设备与平台支持）
- [[rules-npu-model-adapters]]（NPU model adapter rules）
- [[rules-warmup-ids]]（vLLM-Omni model executor — upstream warmup request identification rules）
- [[rules-host-weight-runtime]]（Host Weight Runtime 测试评审规则）
- [[rules-qwen25-talker-eos]]（模型执行器 — Qwen2.5-Omni talker 终止 conditioning 规则）
- [[rules-drama3-quant]]（Drama 3 量化配置规则）
- [[rules-gpu-memory-budget]]（模型执行器 — GPU 显存预算规则）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, components, model-executor；created: 2026-07-10；updated: 2026-10-06
