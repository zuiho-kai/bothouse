---
name: pi0-overview
description: "Pi0（π0 VLA）目录入口：知识树 owner models/pi0、pipeline registry key 与 architecture key 均为 Pi0Pipeline / pi0、源码路径 vllm_omni/diffusion/models/pi0/ 与 pi0.yaml（单 diffusion stage、async_chunk: false、dtype: float32）、依赖的共享 diffusion 模块、不放什么"
metadata:
  scope: 只收 Pi0 的名称、注册入口、源码路径、依赖的共享模块与目录路由；观测预处理、flow-matching、attention 与动作输出的 PI0-1a 归 pi0-rules，共享 diffusion 模块的执行与加载合同归 diffusion-overview
---
# Pi0

## 现状

### 正式名称与别名

- 知识树 owner：`models/pi0`；上游目录 `pi0`。
- pipeline registry key：`pi0`（`vllm_omni/config/pipeline_registry.py`）。
- registry 登记的 architecture / stage key：`Pi0Pipeline`。

### 源码路径

- 共 5 个文件：
  - `vllm_omni/diffusion/models/pi0/`
  - `vllm_omni/deploy/pi0.yaml`

### 依赖的共享代码模块

- `vllm_omni/diffusion/data/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/request/` → [[diffusion-overview]]（diffusion）

### checkpoint、尺寸与量化

- `pi0.yaml`：π0 (Pi-Zero) VLA deploy: single diffusion stage. Topology (PI0_PIPELINE) is declared in vllm_omni/diffusion/models/pi0/pipeline_pi0.py. 配置：`pipeline: pi0`；`async_chunk: false`；`dtype: float32`。

### 什么时候查这里

- 只查 Pi0 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 该模型的硬门禁规则 | 尚未沉淀；由逐 commit 同步命中该 owner 时在 `rules.md` 建立 |

- （以下为原表格，按行改写为条目）
- 遇到什么：遇到 Pi0 专有的观测预处理、flow-matching、attention、动作输出或 OpenPI parity 问题
  - 查看哪里：[[pi0-rules]]（Pi0 硬门禁规则）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/pi0/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-09-04
- 来源（sources）：vllm_omni/diffusion/models/pi0/；vllm_omni/deploy/pi0.yaml
- 置信度（confidence）：high
