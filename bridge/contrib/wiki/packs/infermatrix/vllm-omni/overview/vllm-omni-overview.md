---
name: vllm-omni-overview
description: vLLM-Omni 仓库入口（上游 vllm-project/vllm-omni）：Review 最短路径（PR 声明目标到 configuration / serving / model-executor / diffusion / host-weight / CI / scheduler 等 owner 规则的对照表）与工作主题入口（review、CI、docs、debug、git、benchmark、tooling、remote、owners），并链到四个 vllm-omni 级规则页
metadata:
  scope: 只收仓库入口：开工先遵守 vllm-omni-rules-1 至 vllm-omni-rules-3 的硬规则，Review owner 对照表与工作主题表；AMD CI 规则归 rules-amd-ci-1、rules-amd-ci-2，realtime 一致性归 rules-realtime-conformance，DuplexEval 判分归 rules-duplexeval-judge，评审教训记录归 rules-review-lessons
---
# vLLM-Omni

## 现状

- 上游：`vllm-project/vllm-omni`。开始任何任务先遵守 [[vllm-omni-rules-1]]、[[vllm-omni-rules-2]]、[[vllm-omni-rules-3]]（仓库硬规则）。

### Review 最短路径

- PR title/body 先选择 owner；changed files 只校验实际范围。Direct 已返回精确 `quick_map` 时，不再读取本页、组件总表或模型总表。

| PR 声明目标 | 直接 owner |
|---|---|
| PipelineConfig、YAML、registry、default、endpoint policy | [[configuration-rules-1]]、[[configuration-rules-2]]、[[configuration-rules-3]]（configuration rules） |
| HTTP/OpenAI request、response、endpoint、engine lifecycle | [[serving-rules-1]]、[[serving-rules-2]]、[[serving-rules-3]]（serving rules） |
| checkpoint、tokenizer、processor、stage input/handoff | [[model-executor-rules-1]]、[[model-executor-rules-2]]、[[model-executor-rules-3]]（model-executor rules） |
| diffusion pipeline、denoise、VAE/DiT、图像生成 | [[diffusion-rules-1]]、[[diffusion-rules-2]]、[[diffusion-rules-3]]（diffusion rules） |
| host-weight artifact、lease、filesystem store、restore transaction | [[host-weight-runtime-rules]]（host-weight rules） |
| Buildkite、硬件 lane、CI guard、xdist/shared fixture | [[ci-rules-1]]、[[ci-rules-2]]、[[ci-rules-3]]（CI rules） |
| connector、collective、跨 stage 通信 | [[distributed-overview]]（distributed） |
| queue、token budget、prefix cache、调度 | [[scheduler-rules-1]]、[[scheduler-rules-2]]（scheduler rules） |
| 明确模型名或 registry key | 直接查看 [[models-overview]]（models 目录） |

- owner 仍不明确时才看 [[components-overview]]（components 职责表）；模型别名不确定时才查 [[models-catalog]]（`models/catalog.md`）。

### 工作主题

| 任务 | 入口 |
|---|---|
| PR 审查专项 | [[review-overview]]（review） |
| CI 和测试配置 | [[ci-overview-1]]、[[ci-overview-2]]（ci） |
| 文档和 RFC | [[docs-overview]]（docs） |
| bug 和行为异常 | [[debug-overview]]（debug） |
| Git、PR、rebase | [[git-overview]]（git）、[[rebase-overview]]（upstream rebase） |
| benchmark / profiling | [[benchmark-overview]]（benchmark） |
| ComfyUI、示例 app 和客户端适配 | [[tooling-overview]]（tooling） |
| 远端验证 | [[remote-overview]]（remote） |
| 关键模型与负责人 | [[owners-overview]]（owners） |

- [[rules-review-lessons]]（vllm-omni review-lessons rules）
- [[rules-amd-ci-1]]、[[rules-amd-ci-2]]（vllm-omni AMD/ROCm CI 流水线规则）
- [[rules-realtime-conformance]]（vllm-omni /v1/realtime WebSocket 一致性评审规则）
- [[rules-duplexeval-judge]]（vllm-omni Omni-DuplexEval 判分校验规则）

## 关键事实

- 源页：`knowledge/repos/vllm-omni/_index.md`（InferMatrixCopilot@ecfb84d0）；title: vLLM-Omni 入口；type: index；tags: vllm-omni；created: 2026-07-10；updated: 2026-09-02
