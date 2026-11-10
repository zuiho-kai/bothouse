---
name: rules-duplex-overflow
description: "规则 VLLM-OMNI-PR8683-DUPLEX-OVERFLOW-FENCE：duplex / PersonaPlex streaming 的 prompt 达到 max_model_len 时，终端错误走 duplex failure/cleanup 路由，overflowed request 挂 admission fence 且只由 FIFO abort 释放，输出 FinishReason.ERROR 且不是 segment boundary（omni_ar_scheduler.py、stage_engine_core_proc.py、duplex_orchestrator.py，PR #8683）"
metadata:
  scope: 只收流式 context overflow 的失败路由与 overflow fence 这一条规则；stale output 计数与 abort queue sweep（SCHED-6a、SCHED-6f）归 scheduler-rules-2
---
# Scheduler：duplex 流式 context overflow 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/scheduler/rules-duplex-overflow.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, scheduler；created: 2026-10-12；updated: 2026-10-12
- 来源（sources）：PR #8683
- [VLLM-OMNI-PR8683-DUPLEX-OVERFLOW-FENCE] 流式 context overflow 必须走 duplex 失败路径，overflow fence 只能由 FIFO abort 释放
  - 触发：duplex/PersonaPlex streaming 会话的 prompt 达到或超过 `max_model_len`；
    - 或修改 `vllm_omni/core/sched/omni_ar_scheduler.py` 的 streaming context overflow 路径（`_overflowed_streaming_requests` fence、`release_overflowed_requests`）、`vllm_omni/engine/stage_engine_core_proc.py` 的 eager/FIFO abort 双队列处理，或 `vllm_omni/engine/duplex_orchestrator.py` 的终端错误路由。
  - 强制：终端错误（如 context overflow）必须经既有 duplex failure/cleanup 路由发布，保留 resident-session 与 per-turn 两种既有失败策略——per-turn 失败后同一 session 保持可用、后续 turn 仍可成功（Qwen session-runner 回归），且 stage replica 不再因 overflow 被杀。
    - 已 overflow 的 request 必须挂 admission fence：迟到 append 拒绝并打 debug 日志，直到 stage engine 从有序 input queue 处理完 owner 的 ABORT；eager abort 保持 fence，FIFO 侧清理释放 fence 并允许刻意的同 request-ID 复用。overflow 输出为 `FinishReason.ERROR`、空 `new_token_ids`，且 `is_segment_finished is False`（不是 segment boundary）。
  - 验收：覆盖 overflow 后迟到 append 在 eager abort 之后仍被拒；eager/FIFO 发布交叠（另一请求保持 running、socket 线程在 eager abort 发布后 FIFO 拷贝前暂停）时 overflowed request 不被重建，而 FIFO 先于 drain 完成发布的反例保持原正确行为；FIFO 最终清理后 fence 释放、同 ID replacement 可重新入队；未实现 overflow fence 的 scheduler 不回归；plugin error policy；
    - 同一 session 内失败 response 后成功的 turn。^[PR #8683]

## 决策与踩坑

- [VLLM-OMNI-PR8683-DUPLEX-OVERFLOW-FENCE] 禁止：用普通 request `ErrorMessage` 发布 overflow 终端错误——duplex 消费者只收 session 事件，绕过 duplex 失败/清理路径会让 stage 0 被杀、后续会话报 `stage 0 has no live replica`；eager abort drain 完就释放 fence（eager abort 可早于旧 append 的 FIFO drain 完成）；维护无界 request-ID tombstone 阻止复用；
  - 放任迟到 append 重建已被移除的 overflowed request（症状：`PersonaPlex scheduler prompt reservation mismatch: reserved=1, prepared=90`）；把 overflow error 当 segment boundary。
