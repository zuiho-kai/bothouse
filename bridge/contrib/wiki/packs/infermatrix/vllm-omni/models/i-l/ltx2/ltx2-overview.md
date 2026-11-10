---
name: ltx2-overview
description: LTX-2 家族（含 LTX-2.3/2.5）目录入口：Lightricks 22B 文本到视频加音频模型的别名、checkpoint dg845/LTX-2.3-Diffusers、registry 的 one-/two-stage、distilled 与 DMD2 pipeline 类名及已删除的旧名、recipe 合并为 LTX-2.md、LTX-2.5 默认 DiffVAE decode
metadata:
  scope: 只收 LTX-2 家族的别名、源码目录、registry 类名与目录路由；模型结构与证据索引归 ltx2-architecture，DiffVAE 与 vocoder 等 LTX-* 规则归 ltx2-rules
---
# LTX-2 家族（含 LTX-2.3/2.5）

## 现状

- 常见别名：`LTX-2`、`LTX-2.3`、`LTX-2.5`、`ltx2`；这些 checkpoint 版本共用同一源码模块，但 LTX-2.5 的视频 decode 默认使用 DiffVAE。
- 厂商/模型：Lightricks；22B 参数文本→视频+音频生成（T2V/I2V，48kHz 同步音频，768x512 可达 20+ 秒）；Diffusers 格式 checkpoint `dg845/LTX-2.3-Diffusers`
- 源码：`vllm_omni/diffusion/models/ltx2/`（纯 diffusion，无 AR stage）
- registry：`LTX2Pipeline`/`LTX2TwoStagePipeline` 分别提供 ordinary one-/two-stage，`LTX2DistilledOneStagePipeline`/`LTX2DistilledTwoStagePipeline` 分别提供 distilled one-/two-stage T2V/I2V；后两个 explicit class 都解析到 canonical `LTX2DistilledPipeline` video metadata，后者同时保留为 distilled two-stage 的 legacy alias。
  - DMD2 仍由 `LTX2T2VDMD2Pipeline`/`LTX2I2VDMD2Pipeline` 提供。旧的 LTX23、ImageToVideo 和 plural `LTX2TwoStagesPipeline` registry names 已删除，没有兼容 alias。
- 官方 recipe 已合并为 `recipes/LTX/LTX-2.md`；已删除的 `recipes/LTX/LTX-2.3.md` 不能继续作为 source 或事实依据。
- 依赖共享 [[diffusion-overview]]（Diffusion 组件）

### 什么时候查这里

- 问题只属于 LTX-2/2.3/2.5（pipeline、decoder、分辨率/帧数语义、graph 模式、性能基线）。

### 不放什么

- 多模型共享的 diffusion 执行机制（放 components/diffusion）。
- 通用 benchmark 方法（放 `general/benchmark/`）。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| 模型结构、serving 方式与已有性能/精度证据 | [[ltx2-architecture]]（architecture） |
| LTX-2.5 DiffVAE 选择、artifact、并行或最小几何约束 | [[ltx2-rules]]（LTX-2.5 decoder rules）   新增核对：LTX-4、LTX25-3。 |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/ltx2/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, models, ltx2；created: 2026-07-16；updated: 2026-09-22
- 来源（sources）：PR #6847；vllm_omni/diffusion/models/ltx2/；vllm_omni/diffusion/registry.py；recipes/LTX/LTX-2.md；recipes/LTX/LTX-2.5.md
