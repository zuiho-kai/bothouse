---
name: nemotron-voicechat-overview
description: NVIDIA Nemotron-Labs VoiceChat 目录入口：知识树 owner models/nemotron-voicechat、pipeline registry key nemotron_labs_voicechat 与 nemotron_voicechat、thinker/talker/code2wav 三个 architecture key、32 个源码文件路径与三份 deploy yaml（offline、duplex、streaming）、依赖的 serving/scheduler/distributed 共享模块
metadata:
  scope: 只收名称、源码路径、共享模块依赖、deploy 配置速览和目录路由；duplex 数据面、工具调用、codec suffix 状态、native talker 与 mel window 的规则正文归 nemotron-voicechat-rules，registry 快照与别名清单归 models-catalog
---
# NVIDIA Nemotron-Labs VoiceChat

## 现状

### 正式名称与别名

- 知识树 owner：`models/nemotron-voicechat`；上游目录 `nemotron_voicechat`。
- pipeline registry key：`nemotron_labs_voicechat`；`nemotron_voicechat`（`vllm_omni/config/pipeline_registry.py`）。
- registry 登记的 architecture / stage key：`nemotron_voicechat_code2wav`；`nemotron_voicechat_talker`；`nemotron_voicechat_thinker`。

### 源码路径

- 共 32 个文件：
  - `vllm_omni/deploy/nemotron_labs_voicechat.yaml`
  - `vllm_omni/deploy/nemotron_labs_voicechat_duplex.yaml`
  - `vllm_omni/deploy/nemotron_labs_voicechat_streaming.yaml`
  - `vllm_omni/model_executor/models/nemotron_voicechat/duplex/`
  - `vllm_omni/model_executor/models/nemotron_voicechat/`
  - `vllm_omni/model_executor/models/nemotron_voicechat/nemo_vendored/`
  - `vllm_omni/model_executor/models/nemotron_voicechat/nemo_vendored/asr/`
  - `vllm_omni/model_executor/models/nemotron_voicechat/talker_graph.py`
  - `vllm_omni/model_executor/models/nemotron_voicechat/talker_native.py`
  - `vllm_omni/model_executor/stage_input_processors/nemotron_voicechat.py`

### 依赖的共享代码模块

- `vllm_omni/entrypoints/duplex/` → [[serving-overview]]（serving）
- `vllm_omni/core/sched/` → [[scheduler-overview]]（scheduler）
- `vllm_omni/distributed/omni_connectors/` → [[distributed-overview]]（distributed）
- `vllm_omni/model_executor/models/` → [[model-executor-overview]]（model-executor）
- `vllm_omni/config/stage_config/` → [[configuration-overview]]（configuration）

### checkpoint、尺寸与量化

- `nemotron_labs_voicechat.yaml`：NemotronVoiceChat-11B offline speech-to-speech deployment. 3 stages on one GPU: thinker (NemotronH AR) -> talker (EAR-TTS AR) -> code2wav (RVQ-VAE decode).

### 什么时候查这里

- 只查 NVIDIA Nemotron-Labs VoiceChat 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 原生 duplex、帧/工具合同与验证边界；native talker geometry/replay/batch output；有界 perception window | [[nemotron-voicechat-rules]]（Nemotron VoiceChat rules） |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/nemotron-voicechat/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, serving；created: 2026-09-04；updated: 2026-09-06
- 来源（sources）：PR #6089；PR #6354；vllm_omni/deploy/nemotron_labs_voicechat.yaml；vllm_omni/deploy/nemotron_labs_voicechat_duplex.yaml；vllm_omni/deploy/nemotron_labs_voicechat_streaming.yaml；vllm_omni/model_executor/models/nemotron_voicechat/duplex/
  - vllm_omni/model_executor/models/nemotron_voicechat/；vllm_omni/model_executor/models/nemotron_voicechat/nemo_vendored/；vllm_omni/model_executor/models/nemotron_voicechat/nemo_vendored/asr/；vllm_omni/model_executor/stage_input_processors/nemotron_voicechat.py
- 置信度（confidence）：high
