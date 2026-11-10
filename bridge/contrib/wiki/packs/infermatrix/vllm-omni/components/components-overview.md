---
name: components-overview
description: vLLM-Omni 组件 owner 对照表：Configuration、Serving、Model Executor、Diffusion、Host Weight Runtime、Distributed、Scheduler、comfyui 各自负责范围与 rules 直接入口
metadata:
  scope: 只收 components 目录的 owner 选择表和何时查它的说明；各 owner 的规则与架构归其自己的页面（如 configuration-overview、comfyui-overview）
---
# 组件 owner

## 现状

- 仅在 PR 描述和 Direct 路由都不能确定 owner 时查本页。选中一个主要 owner 后直接进入其 `rules.md`；只有真实调用链跨边界时才打开第二个 owner。

| Owner | 负责范围 | 直接入口 |
|---|---|---|
| [[configuration-overview]]（Configuration） | deploy YAML、PipelineConfig、registry、字段归属、default 和 endpoint policy | [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（rules） |
| [[serving-overview]]（Serving） | 用户请求、OpenAI API、响应、AsyncOmni engine 生命周期 | [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（rules） |
| [[model-executor-overview]]（Model Executor） | stage config/input、模型加载、worker、跨 stage 数据桥 | [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（rules） |
| [[diffusion-overview]]（Diffusion） | diffusion pipeline、denoise、VAE/DiT、并行和 cache | [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（rules） |
| [[host-weight-runtime-overview]]（Host Weight Runtime） | immutable host artifact、lease、filesystem store、typed outcome 与 restore transaction | [[host-weight-runtime-rules]]（rules） |
| Distributed | connector、KV 迁移、collective、跨 stage 通信 | [[distributed-overview]]（index） |
| [[scheduler-overview]]（Scheduler） | 请求队列、token budget、KV transfer、prefix cache | [[scheduler-rules-1]]、[[scheduler-rules-2]]（rules） |

- 需要解释稳定数据流时再进入对应 owner 的 `architecture.md`，不要把 architecture 当成 review 的默认前置阅读。
- [[comfyui-overview]]（comfyui）：comfyui owner 规则。

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/_index.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-Omni 组件 owner；type: index；tags: vllm-omni, components；created: 2026-07-10；updated: 2026-08-23
