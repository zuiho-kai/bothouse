---
name: rules-release-queues
description: "Scheduler release waiting queue 合同：SCHED-RELEASE-1a vLLM 0.31 input gate 下 kv_holding_waiting / waiting 双物理队列与 deferred_waiting 的 park / restore / requeue（PR #8459）；SCHED-5g resumable async-chunk 在 FINISHED_STOPPED 后按 live queue 所有权做终态清理，duplex receiver 转回 WAITING（PR #6089、#6360、#6680）"
metadata:
  scope: 只收双 waiting queue、deferred set 与 resumable 终态清理两条规则；stale output 与 abort queue sweep（SCHED-6f）归 scheduler-rules-2，共享生命周期（SCHED-6a2）归 rules-shared-lifecycle
---
# Scheduler release waiting queue 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/scheduler/rules-release-queues.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, scheduler；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8459；PR #6089；PR #6360；PR #6680；vllm_omni/core/sched/omni_scheduler_mixin.py；vllm_omni/core/sched/omni_generation_scheduler.py
- 置信度（confidence）：high
- [SCHED-RELEASE-1a] vLLM 0.31 input gate 必须保留 KV holder 的队列优先级
  - 触发：vLLM rebase 改变 waiting queues、Omni input gating 或 active admission limits。
  - 强制：一次 scheduler tick 的 input-ready pass 统一访问 `kv_holding_waiting` 与 `waiting`，优先访问 KV holder，connector state 只消费一次。park/restore/requeue 依据 upstream `_holds_kv_blocks` 回到对应物理队列；移除依据实际 membership，不能依赖可能已被 input metadata 改写的 computed frontier。
    - grammar、remote-KV 与 streaming-update 等 upstream blocked status 不得被 Omni readiness 覆写。
  - 强制：`deferred_waiting` 是独立的 blocked/deferred request set；恢复接纳和终态清理要同步它与两条物理队列。临时关闭 waiting admission 时两队一起保存/替换，在 `finally` 恢复并保留顺序；reserved slots 对齐 `max_num_active_reqs`。generation path 同样先选 KV-holding queue，再选 fresh queue；CFG parent/companion 跨两队仍需配对。
  - 验收：AR/generation、full-payload/async-chunk、不同 queue policy 与双物理队列并存时覆盖 park→restore；检查 connector 单次消费、KV holder 优先、blocked waits 保持、abort sweep、streaming counter 与跨队 CFG 配对。API import 成功不能代替此状态机验收。^[PR #8459]
- [SCHED-5g] resumable async-chunk 终态清理必须以 live queue 所有权为准
  - 触发：resumable async-chunk 请求在一个流式 segment 结束时进入 `FINISHED_STOPPED`，但仍由 `running`、`waiting`、`kv_holding_waiting` 或 connector 隐藏队列持有，随后 session close、取消或其他路径调用 `finish_requests`。
  - 强制：先物化可能被多层消费的 request-id iterator，并在 adapter 清理前快照 `deferred_waiting` 中承担流式等待计数的请求；只对仍有活队列所有权的目标 resumable 终态请求恢复状态，deferred streaming wait 恢复为 `WAITING_FOR_STREAMING_REQ`，`running`/`waiting` 按实际队列对齐；下游 async-chunk 的 segment stop 必须先清除该 segment 的 finished 标记。
    - 只有 connector `receives_chunks`、最终 stage `model_config.session_mode == "duplex"` 且 request 仍为 `WAITING_FOR_STREAMING_REQ` 时，才从 `kv_holding_waiting` 转为 ordinary `WAITING` 并恢复 connector polling；sender-only 或 turn-mode stage 保持 parked，等待显式 streaming update。
    - 同一 update 尾部按 stale stopped 集合清理时不得移除已重新入队的 request；running purge 必须限定本次 finish 集合，并确保 `_free_request`、coordinator 与 connector 清理恰好执行一次。
  - 验收：AR 与 generation scheduler 均覆盖 hidden、`running`、`waiting`、`kv_holding_waiting`、脱离队列及无关 resumable 请求；另覆盖 connector-fed duplex receiver 从 segment stop 同轮转回 `WAITING`，断言它保留在 waiting queue、离开 KV-holding/deferred wait、流式等待计数递减且 segment-finished 标记清除；
    - sender-only duplex 与 connector-fed turn-mode controls 必须仍 parked，同时也清除标记。首次 finish 恰好释放、第二次无操作，并验证 generator request-id 输入。PR 作者报告的 H100 E2E 与 574-pass CPU/config suite 是提交时证据，不是当前环境或跨硬件保证。^[PR #6089] ^[PR #6360] ^[PR #6680] ^[PR #8459]

## 决策与踩坑

- [SCHED-RELEASE-1a] 禁止：仅处理旧 `waiting/skipped_waiting` 模型；metadata 修改后按新状态去错误队列 remove；KV holder 恢复为 fresh 请求；因延迟输入覆盖 upstream blocked 状态。
- [SCHED-5g] 禁止：把任意已完成请求重新打开；对脱离所有 live queue、可能等待 deferred block free 的终态请求调用释放；因 request 在本轮进入时是 `WAITING_FOR_CHUNK` 就撤销其同轮 requeue；全局清空 running 中无关的 resumable segment；重复消费单遍 request-id iterator，或因非流式 skipped 请求错误减少 streaming counter。
