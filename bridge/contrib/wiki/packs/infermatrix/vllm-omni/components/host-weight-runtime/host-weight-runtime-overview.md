---
name: host-weight-runtime-overview
description: Host Weight Runtime 组件入口：源码入口 vllm_omni/host_weight_runtime/，职责为跨模型共享的 immutable host artifact、lease、filesystem store、typed outcome 与 restore transaction；何时查本目录，以及指向规则页（新增核对 HWR-1f）的对照表
metadata:
  scope: 只收 host-weight-runtime 目录的入口说明：职责边界、何时查这里和目录对照表；HWR-* 规则正文归 host-weight-runtime-rules，diffusion producer、identity adapter 与 DLO selection 归 Diffusion owner（入口 diffusion-overview）
---
# Host Weight Runtime

## 现状

- 源码入口：`vllm_omni/host_weight_runtime/`。
- 主要职责：跨模型共享的 immutable host artifact、lease、filesystem store、typed outcome 和 restore transaction；transport 可在 lease 生命周期内注册 immutable mapping，但具体 diffusion producer、identity adapter 与 DLO selection 仍归 Diffusion owner。

### 什么时候查这里

- 修改 host-weight store、lease/lock、deny/quarantine、locality、fallback 或 restore transaction。
- 具体 diffusion layout/source identity 同时读取 [[rules-checkpoint-loading-1]]、[[rules-checkpoint-loading-2]]（Diffusion DIFF-2d）。

### 目录内容

| 遇到什么 | 查看哪里 |
|---|---|
| typed failure、lease/store concurrency、single-take carrier、restore transaction，以及 hardened artifact 的 cleanup/quarantine/publication、deny-marker 或 durability I/O failure | [[host-weight-runtime-rules]]（rules）   新增核对：HWR-1f。 |

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/host-weight-runtime/_index.md`（InferMatrixCopilot@ecfb84d0）；type: index；tags: vllm-omni, components；created: 2026-08-23；updated: 2026-09-22
- 来源（sources）：PR #6419；PR #6486；PR #6591；PR #6692；vllm_omni/host_weight_runtime/
- 置信度（confidence）：high
