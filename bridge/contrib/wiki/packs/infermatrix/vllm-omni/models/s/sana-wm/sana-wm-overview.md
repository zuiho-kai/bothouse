---
name: sana-wm-overview
description: SANA-WM 目录入口：知识树 owner models/sana-wm、registry architecture SanaWmPipeline、源码目录 sana_wm 共 7 个文件、依赖的八个共享 diffusion 模块、上游无 deploy 预设、规则尚未沉淀
metadata:
  scope: 只收 SANA-WM 的名称、registry、源码路径、依赖的共享模块与目录路由；共享 diffusion 模块的合同归 diffusion-overview，本目录尚无规则页
---
# SANA-WM

## 现状

### 正式名称与别名

- 知识树 owner：`models/sana-wm`；上游目录 `sana_wm`。
- registry 登记的 architecture / stage key：`SanaWmPipeline`。

### 源码路径

- 共 7 个文件：
  - `vllm_omni/diffusion/models/sana_wm/`

### 依赖的共享代码模块

- `vllm_omni/diffusion/models/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/layers/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/distributed/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/attention/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/data/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/model_loader/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/offloader/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/profiler/` → [[diffusion-overview]]（diffusion）

### checkpoint、尺寸与量化

- 上游没有 deploy 预设。pipeline 模块自述：Sana-WM pipeline integration. This module wires the registry-visible surface, release-layout validation, and the Stage-1 sampling loop.

### 什么时候查这里

- 只查 SANA-WM 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 该模型的硬门禁规则 | 尚未沉淀；由逐 commit 同步命中该 owner 时在 `rules.md` 建立 |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/sana-wm/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-09-04
- 来源（sources）：vllm_omni/diffusion/models/sana_wm/
- 置信度（confidence）：high
