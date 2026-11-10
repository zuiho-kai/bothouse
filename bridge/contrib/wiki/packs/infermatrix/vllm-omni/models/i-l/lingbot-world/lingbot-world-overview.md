---
name: lingbot-world-overview
description: LingBot World 目录入口：registry key LingBotWorldCausalDMDPipeline、上游 lingbot_world 目录的 7 个源码文件、依赖的共享 diffusion 模块、checkpoint robbyant/lingbot-world-v2-14b-causal-fast-diffusers 与 stepwise deploy YAML、共享合同的路由表（DIFF-4o、DIFF-15a–15c、EXEC-1l）
metadata:
  scope: 只收 LingBot World 的名称别名、源码文件、共享模块依赖、checkpoint 与目录路由；数据流与边界归 lingbot-world-architecture，运行与验证归 execution-validation，硬门禁规则 LBW-* 归 lingbot-world-rules
---
# LingBot World

## 现状

### 正式名称与别名

- 知识树 owner：`models/lingbot-world`；上游目录 `lingbot_world`。
- registry 登记的 architecture / stage key：`LingBotWorldCausalDMDPipeline`。

### 源码路径

- 固定源码版本的模型目录有 7 个文件：`__init__.py`、`pipeline.py`、`transformer.py`、`dmd_block.py`、`camera.py`、`actions.py` 与 `utils.py`。分别从 pipeline 的请求/stepwise 入口、DMD block runner 和 camera/action 解析开始核对。

### 依赖的共享代码模块

- `vllm_omni/experimental/ar_diffusion/` → [[rules-ar-paging-geometry]]（AR 分页几何）、[[rules-system-runtime-1]]、[[rules-system-runtime-2]]（系统运行时） 与 [[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（tick/事件提交）
- `vllm_omni/diffusion/models/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/distributed/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/model_loader/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/layers/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/data/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/forward_context/` → [[diffusion-overview]]（diffusion）
- `vllm_omni/diffusion/profiler/` → [[diffusion-overview]]（diffusion）

### checkpoint、尺寸与量化

- checkpoint：`robbyant/lingbot-world-v2-14b-causal-fast-diffusers`；registry key 为 `LingBotWorldCausalDMDPipeline`。
- stepwise serving 显式选择 `vllm_omni/deploy/lingbot_world_v2_stepwise.yaml`；模型没有自动选用的默认 deploy config。
- 新补内容按 [固定源码版本 9cf443a7bb24d6b8007981311466d769ec13b3d8](https://github.com/vllm-project/vllm-omni/tree/9cf443a7bb24d6b8007981311466d769ec13b3d8/vllm_omni/diffusion/models/lingbot_world) 核对；不改变仓库级 release baseline。

### 什么时候查这里

- 只查 LingBot World 专有的行为、常量、注册入口和验证合同。

### 不放什么

- 上面列出的共享模块的执行、调度、加载或 serving 合同属于 [[components-overview]]（components），这里只链接不复制；registry 快照和别名清单见 [[models-catalog]]（模型 catalog）；一次性历史默认不落盘。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| checkpoint 固定形状、首图/文本/camera 数据流、DMD 与模型/共享 owner 边界 | [[lingbot-world-architecture]]（架构） |
| offline、stepwise/WebSocket、SE3 controls、配置、FP8 与 realtime 验证口径 | [[execution-validation]]（运行与验证） |
| 该模型的硬门禁规则 | [[lingbot-world-rules]]（模型规则）：session VAE decode、condition history 与模型专有合同 |
| paged KV 容量、K/V 独立存储、单 request stepwise rollout 与 warmup | [[rules-system-runtime-1]]、[[rules-system-runtime-2]]（系统运行时）：`DIFF-4o`、`DIFF-4aa`、`DIFF-4ab`、`DIFF-4ad` |
| kernel 合法 page、ragged sink/recent window、scratch 与固定 block-table width | [[rules-ar-paging-geometry]]（AR 分页几何）：`DIFF-15a`–`DIFF-15c` |
| deprecated tick 的 session/event/request identity、失败与提交 | [[rules-bridge-batch-1]]、[[rules-bridge-batch-2]]（跨 stage bridge）：`EXEC-1l` |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/lingbot-world/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, diffusion；created: 2026-09-04；updated: 2026-10-09
- 来源（sources）：vllm_omni/diffusion/models/lingbot_world/
- 置信度（confidence）：high
