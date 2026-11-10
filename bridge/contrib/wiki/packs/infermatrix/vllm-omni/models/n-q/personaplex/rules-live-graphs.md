---
name: rules-live-graphs
description: "PersonaPlex 规则 PPLEX-4a 到 PPLEX-4c：talker stage-0 batched live append 按 session 与 slot 身份对应、Mimi CUDA graph 按 slot 生命周期保持 encode/decode parity（typed hf_overrides）、提高并发时 admission 与两个 stage 的 max_num_seqs 及完整窗口预算同步（PR #8356）"
metadata:
  scope: 只收 PPLEX-4a / 4b / 4c；frame、session 隔离、greedy 与 prefill 规则归 personaplex-rules-1，streaming 表与 codec delta 合同归 rules-streaming-state
---
# PersonaPlex live append 与 Mimi graph 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/models/personaplex/rules-live-graphs.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, models；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #8356
- 置信度（confidence）：high
- [PPLEX-4a] batched live append 保持 session 与 slot 身份
  - 触发：修改 talker stage-0 batched append、prefill/live 混批或 slot recycling。
  - 强制：保持每行 embeddings、audio tokens、provided codes 与 agent 状态对应当前 session；忽略 first/unencoded 项，cancel/restart 后新 session 不继承旧 slot 状态。
  - 验收：对比逐请求 oracle 的 embeddings/tokens/codes/agent，覆盖 prefill/live 混批和 cancel/restart slot 复用。 ^[PR #8356]
- [PPLEX-4b] Mimi graph 按 slot 生命周期保持 encode/decode parity
  - 触发：修改 Mimi CUDA graph cache、reset、decode 或 typed overrides。
  - 强制：图开关经两个 stage 的 typed hf_overrides 传递；API 默认仍 false，bundled profile 可显式启用。slot 回收/reset 后图状态与 eager 一致。
  - 验收：真实 CUDA 对照 encode/decode bitwise parity 并覆盖 recycle；config factory 检查两个 stage 的显式开关及未设置默认。 ^[PR #8356]
- [PPLEX-4c] 提高并发必须同步两个 stage 与完整窗口预算
  - 触发：修改 PersonaPlex session admission、stage max_num_seqs 或 Mimi cache 容量。
  - 强制：admission 上限与两个 stage 的 max_num_seqs 一同调整，按实际最长窗口、每 slot cache 与 stage 总开销核算容量。
  - 验收：核对三个容量入口，在目标最长窗口下验证内存与回收；性能数字只用于相同 GPU、窗口、head 和配置。 ^[PR #8356]

## 决策与踩坑

- [PPLEX-4a] 禁止：用行号代替请求身份，或只验证 tensor shape。
- [PPLEX-4b] 禁止：把 profile 开启误写成所有调用默认开启；沿用已结束 session 的 codec state。
- [PPLEX-4c] 禁止：把短 session 并发测量当作满窗口容量保证；仅提高前端 admission 而下游容量不变。
