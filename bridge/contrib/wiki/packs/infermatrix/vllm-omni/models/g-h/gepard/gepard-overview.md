---
name: gepard-overview
description: Gepard 入口：pipeline registry key gepard、stage key gepard_talker，源码 vllm_omni/model_executor/models/gepard/ 与 deploy/gepard.yaml（Gepard-1.0 单 stage native-AR FSQ/NanoCodec TTS 约 0.5B，目标 1×L4 24GB，async_chunk false、bfloat16），依赖的共享模块与本目录不放什么
metadata:
  scope: 只收 Gepard 的名称、源码路径、共享模块依赖和 gepard.yaml 配置摘要；该模型尚无规则页
---
# Gepard

## 现状

### 正式名称与别名

- 知识树 owner：`models/gepard`；上游目录 `gepard`。
- pipeline registry key：`gepard`（`vllm_omni/config/pipeline_registry.py`）。
- registry 登记的 architecture / stage key：`gepard_talker`。

### 源码路径

- 共 6 个文件：
  - `vllm_omni/model_executor/models/gepard/`
  - `vllm_omni/deploy/gepard.yaml`

### 依赖的共享代码模块

- `vllm_omni/model_executor/models/` → [[model-executor-overview]]（model-executor）
- `vllm_omni/platforms/` → 无对应 component owner
- `vllm_omni/config/stage_config/` → [[configuration-overview]]（configuration）

### checkpoint、尺寸与量化

- `gepard.yaml`：Gepard-1.0: single-stage native-AR FSQ/NanoCodec TTS (~0.5B). Target 1x L4 24GB. Zero-shot only; enforce_eager until the perf PR. 配置：`pipeline: gepard`；`async_chunk: false`；`dtype: bfloat16`。

### 什么时候查这里

- 只查 Gepard 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 该模型的硬门禁规则 | 尚未沉淀；由逐 commit 同步命中该 owner 时在 `rules.md` 建立 |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/gepard/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, serving；created: 2026-09-04；updated: 2026-09-04
- 来源（sources）：vllm_omni/model_executor/models/gepard/；vllm_omni/deploy/gepard.yaml
- 置信度（confidence）：high
