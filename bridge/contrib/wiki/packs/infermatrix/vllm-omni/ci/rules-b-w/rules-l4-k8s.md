---
name: rules-l4-k8s
description: "CUDA L4 Kubernetes CI 规则 OMNI-CI-1e：l4_1..4 按卡数投影到 l4-k8s preset（selector vllm.ci/gpu-pool=l4x4、N GPU 配 10N CPU、40N Gi memory、24N Gi shm）、infra retry 退出码范围、ready/nightly/weekly 的 cards 切分（PR #6890）"
metadata:
  scope: 只收 CUDA L4 队列的 Kubernetes preset、资源投影与 retry 规则；MIRROR_HW preset 推导与硬件 marker 归 ci-rules-2，HF_TOKEN alias 归 ci-rules-3，AMD lane 归 rules-amd
---
# CUDA L4 Kubernetes CI 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/ci/rules-l4-k8s.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, ci；created: 2026-09-05；updated: 2026-09-05
- 来源（sources）：PR #6890；.buildkite/common/ci_mirror_hardwares.yml；.buildkite/cuda/test-ready.yml；.buildkite/cuda/test-nightly.yml；.buildkite/cuda/test-weekly.yml；tests/buildkite/test_upload_pipeline.py
- 置信度（confidence）：high
- [OMNI-CI-1e] L4 jobs 必须按卡数投影到 l4-k8s preset
  - 触发：L4 queue/preset、CUDA ready/nightly/weekly split、pod resource/retry 变更。
  - 强制：`l4_1..4` 使用 `l4-k8s`、selector `vllm.ci/gpu-pool=l4x4`；N GPU 配 `10N` CPU、`40N Gi` memory、`24N Gi` shm，保留 CI image/FSx HF cache/`HF_TOKEN`。只对 `-1`/`128`/`agent_stop`/`agent_refused` infra retry once，不对 `1`/`137`；explicit step retry 覆盖 preset。
    - ready cards 1/2/4（attention 仅4），nightly 2/3/4，weekly affected 2/4，保持 L4 SKU selector。
  - 验收：CPU preset render/collection 证明各 split nonempty；真实 L4 runtime 另验。^[PR #6890]

## 决策与踩坑

- [OMNI-CI-1e] 禁止：旧 gpu queue/docker/mount-agent claim，`not cards_1` 代替 exact cards，或从 render/screenshots 推断 hardware/runtime pass。
