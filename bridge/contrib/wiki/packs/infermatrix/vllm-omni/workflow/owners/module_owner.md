---
name: module_owner
description: 关键模块与 Owner 对照表：Benchmark/metrics/profiler、scheduler、Engine、platforms、api_server、OmniConnector、Quantization 及各 Diffusion 子模块、Tests 共 23 行模块到 owner 与姓名的映射，并说明该表是协作分工而非自动 review 路由权威
metadata:
  scope: 只收模块到 owner 的映射表及其权威边界；模型 owner 归 model_owner，module frontmatter 与 CODEOWNERS 核对归 owners-rules，目录入口归 owners-overview
---
# 关键模块与 Owner

## 关键事实

- 源页：`knowledge/repos/vllm-omni/owners/module_owner.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, components；created: 2026-08-14；updated: 2026-09-22
- 来源（sources）：https://github.com/JiusiServe/InferMatrixCopilot/pull/70
- 记录 vLLM-Omni 中关键共享代码模块对应的 owner（负责人），用于 review、debug 和 benchmark 时快速路由到正确的人。模块清单以 [[components-overview]]（components 目录） 为准，本页只维护“模块 → owner”映射。相关入口：[[owners-overview]]（owners 索引）、[[model_owner]]（关键模型与 Owner）。
- 此表记录维护者提交的协作分工；不是自动 review 路由的权威。源码 reviewer 以目标 revision 的 `.github/CODEOWNERS` 为准，维护本表时按 [[owners-rules]]（ownership 规则） 核对 module frontmatter 与 CODEOWNERS。

### 关键模块与 Owner

| 模块 | Owner | 备注 |
|---|---|---|
| Benchmark/metrics/profiler | ZacheryAU | 区至豪 |
| Config/deploy/pipeline/cli | 外部负责 | - |
| scheduler | BLANKETusers | 张志恒 |
| coordinator | NumberWan | 温梓健 |
| Engine | fake0fan/chickeyton | 郑晨光/吴艺辉 |
| input/output processor | tzhouam | 周太昶/Shi Bo ao |
| stage_input_processor | amy-why-3459 | 吴海燕 |
| platforms | FayeSpica | 廖维明 |
| Weight loading/transformers | NumberWan | 温梓健 |
| worker/modelrunner | tzhouam | 周太昶 |
| api_server | herotai214 | 戴昊曌 |
| OmniConnector | natureofnature/spencerr221 | 刘威志/Liu Bingyu |
| Quantization | david6666666 | 陈炜青 |
| Diffusion-attention | david6666666 | 陈炜青 |
| Diffusion-cache | yangjianjuan | 杨剑娟 |
| Diffusion-distributed | bjf-frz  | 白竞帆 |
| Diffusion-Executor/Scheduler/Worker/ModelRunner | fhfuih | 黄泽宇 |
| Diffusion-hooks/lora/layers/model_loader | congw729 | 王聪 |
| Diffusion-models/registry | congw729 | 王聪 |
| DiffusionEngine/StageDiffusionClient/IO | bjf-frz  | 白竞帆 |
| Diffusion-model_extras | TaffyOfficial | 温智仁 |
| Diffusion-config | TaffyOfficial | 温智仁 |
| Tests | yenuo26/zhumingjue138 | 王语/朱铭觉 |
