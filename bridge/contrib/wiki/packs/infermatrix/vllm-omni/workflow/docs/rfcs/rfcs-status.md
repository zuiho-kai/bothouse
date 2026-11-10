---
name: rfcs-status
description: vLLM-Omni RFC 状态：Deterministic rollout 的 vllm-omni#4864 与 verl-omni#203 均为 open（2026-07-10 核验），GitHub issue 为状态来源，以及 RFC 关闭后需检查的三件事
metadata:
  scope: 只收 Deterministic rollout 这一条 RFC 的状态入口与关闭后检查项；docs 目录的其余查看分流归 docs-overview
---
# RFC Status

## 关键事实

- 源页：`knowledge/repos/vllm-omni/docs/rfcs/status.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: vllm-omni, docs；created: 2026-07-10；updated: 2026-07-16
- 来源（sources）：#203；#4864

### Deterministic rollout

- vLLM-Omni RFC: [vllm-project/vllm-omni#4864](https://github.com/vllm-project/vllm-omni/issues/4864) — **open**，2026-07-10 live 核验。
- 上游需求: [verl-project/verl-omni#203](https://github.com/verl-project/verl-omni/issues/203) — **open**，2026-07-10 live 核验。
- 当前方向仍未完成，不能归档为已结项经验。GitHub issue 是正文和状态的 source of truth；本仓只保留入口，不再维护 `rfc_4864_final.md` / `rfc_4864_rewrite.md` 这类会漂移的副本。
- RFC 关闭后再检查三件事：对应实现是否已 merge、验收测试是否落地、依赖 issue 是否解除。三项都满足才把本页改成归档入口。
