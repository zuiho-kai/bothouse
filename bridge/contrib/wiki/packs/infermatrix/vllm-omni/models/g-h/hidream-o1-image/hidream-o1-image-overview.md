---
name: hidream-o1-image-overview
description: HiDream-O1 Image 入口：registry architecture key HiDreamO1ImagePipeline，源码 vllm_omni/diffusion/models/hidream_o1_image/（3 个文件），依赖的 diffusion 共享模块清单，上游无 deploy 预设故 checkpoint / 尺寸 / 量化差异未声明
metadata:
  scope: 只收 HiDream-O1 Image 的名称、源码路径、共享模块依赖和目录指引；请求限制、TP、Cache-DiT 与输出合同 HIDREAMO1-1a 归 hidream-o1-image-rules，HiDream-I1 归 hidream-image-overview
---
# HiDream-O1 Image

## 现状

### 正式名称与别名

- 知识树 owner：`models/hidream-o1-image`；上游目录 `hidream_o1_image`。
- registry 登记的 architecture / stage key：`HiDreamO1ImagePipeline`。

### 源码路径

- 共 3 个文件：
  - `vllm_omni/diffusion/models/hidream_o1_image/`

### 依赖的共享代码模块

- `vllm_omni/diffusion/cache/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/attention/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/models/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/data/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/distributed/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/model_loader/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/profiler/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/worker/` → [[diffusion-overview]]（diffusion）

### checkpoint、尺寸与量化

- 上游没有 deploy 预设。模块也没有 docstring，因此 checkpoint、尺寸和量化差异在上游尚无声明，不在此处臆测；命中该 owner 的同步单元应补齐。

### 什么时候查这里

- 只查 HiDream-O1 Image 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 该模型的硬门禁规则 | 尚未沉淀；由逐 commit 同步命中该 owner 时在 `rules.md` 建立 |

- （以下为原表格，按行改写为条目）
- 遇到什么：HiDream-O1 的请求限制、分辨率、TP、Cache-DiT、mixed attention 与输出验收
  - 查看哪里：[[hidream-o1-image-rules]]（模型规则）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/hidream-o1-image/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-09-04
- 来源（sources）：vllm_omni/diffusion/models/hidream_o1_image/
- 置信度（confidence）：high
