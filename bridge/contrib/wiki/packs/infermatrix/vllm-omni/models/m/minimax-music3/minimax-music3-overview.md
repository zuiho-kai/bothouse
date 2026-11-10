---
name: minimax-music3-overview
description: MiniMax Music3 目录入口：知识树 owner models/minimax-music3 与 pipeline registry key minimax_music3、15 个源码文件的路径（model_executor、deploy、tts_adapters、stage_input_processors、configs）、单卡与双卡两份 deploy yaml（AR talker + acoustic decoder，async_chunk）、什么时候查与不放什么
metadata:
  scope: 只收名称、源码路径、依赖的共享模块、deploy 配置速览和目录路由；composite checkpoint 完整性与 float32 声学注意力的规则正文归 minimax-music3-rules，registry 快照与别名清单归 models-catalog
---
# MiniMax Music3

## 现状

### 正式名称与别名

- 知识树 owner：`models/minimax-music3`；上游目录 `minimax_music3`。
- pipeline registry key：`minimax_music3`（`vllm_omni/config/pipeline_registry.py`）。

### 源码路径

- 共 15 个文件：
  - `vllm_omni/model_executor/models/minimax_music3/`
  - `vllm_omni/deploy/minimax_music3.yaml`
  - `vllm_omni/deploy/minimax_music3_2gpu.yaml`
  - `vllm_omni/entrypoints/openai/tts_adapters/minimax_music3.py`
  - `vllm_omni/model_executor/stage_input_processors/minimax_music3.py`
  - `vllm_omni/transformers_utils/configs/minimax_music3.py`

### 依赖的共享代码模块

- `vllm_omni/model_executor/models/` → [[model-executor-overview]]（model-executor）
- `vllm_omni/config/stage_config/` → [[configuration-overview]]（configuration）

### checkpoint、尺寸与量化

- `minimax_music3.yaml`：MiniMax-Music3 deploy: Stage 0 (AR talker) -> Stage 1 (acoustic decoder), both on one 140 GB card, streaming 200-frame windows over shared memory. 配置：`pipeline: minimax_music3`；`async_chunk: true`。
- `minimax_music3_2gpu.yaml`：MiniMax-Music3 two-GPU layout: AR talker on device 0, acoustic decoder on device 1. Splitting the stages removes the memory-budget compromise of the single-card 配置：`pipeline: minimax_music3`；`async_chunk: true`。

### 什么时候查这里

- 只查 MiniMax Music3 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| composite checkpoint、stage subdir、snapshot revision/root | [[minimax-music3-rules]]（rules）   新增核对：MM3-1b。 |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/minimax-music3/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, serving；created: 2026-09-04；updated: 2026-09-22
- 来源（sources）：PR #6640；vllm_omni/model_executor/models/minimax_music3/；vllm_omni/deploy/minimax_music3.yaml；vllm_omni/deploy/minimax_music3_2gpu.yaml；vllm_omni/entrypoints/openai/tts_adapters/minimax_music3.py；vllm_omni/model_executor/stage_input_processors/minimax_music3.py
  - vllm_omni/transformers_utils/configs/minimax_music3.py
- 置信度（confidence）：high
