---
name: rules-shared-lifecycle
description: "Scheduler shared lifecycle 两条规则：SCHED-6a2 AR 与 generation 的 I/O、输出包装、finish 与统计只在 OmniSchedulerMixin 有一个 canonical 实现，NewRequestData 逐字段无损重包（PR #5461）；SCHED-1c OmniPrefixCacheManager 同 step prefix-hit prefetch 在 publish 后按新 version 重规划（PR #7877）"
metadata:
  scope: 只收共享 mixin 生命周期与 same-step prefetch 重规划两条规则；rebase 时对照 upstream 接口（SCHED-3a）与 prefix cache key（SCHED-1a、SCHED-1b）归 scheduler-rules-1，写边界归 rules-prefix-cache-write
---
# Scheduler shared lifecycle 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/scheduler/rules-shared-lifecycle.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, scheduler；created: 2026-09-22；updated: 2026-10-09
- 来源（sources）：PR #5461；PR #7877
- [SCHED-6a2] AR 与 generation 的共享生命周期只能有一个 canonical 实现
  - 触发：把 AR/generation scheduler 的 I/O、输出包装、finish 或统计逻辑移入 `OmniSchedulerMixin`，或修改该 mixin 及任一 scheduler 的 shared hook。
  - 强制：两类 scheduler 共用 pending connector/chunk 输入处理、wait queue restore、`OmniSchedulerOutput` 包装、失败 KV load 的 terminal output、finished IDs、队列清理、stats/events 和 finish cleanup；`NewRequestData` 转成 Omni 结构时逐字段无损，并保留已经是 Omni 类型的 fast path。AR 的 synthetic-abort 等差异策略必须作为显式参数留在调用点。
  - 验收：同一组 contract 测试分别驱动 AR 与 generation 输入路径；断言 base dataclass 的每个字段均被转交、现有 Omni entry 保持 identity、失败 KV load 终止输出、finished ID/stats/events/cleanup 一致，并单独验证显式 abort policy。 ^[PR #5461]
- [SCHED-1c] 同 step 的 prefix-hit prefetch 必须在 publish 后按新 version 重规划
  - 触发：修改 `OmniPrefixCacheManager`（`core/prefix_cache/manager.py`）的 same-step hit prefetch、`_hit_prefetch` / `_prefetch_queue`，或 `allocate_slots` 后同一次 `schedule()` 内后到请求命中先到请求本步才写入的 block。
  - 强制：B 在 `new_step_starts` 规划的 hit 可能读到 ABSENT mm 行，或回收块上上一 tenant 的 COMMITTED 行。A 在本步 `save_outputs` / `_publish_saved_step` 登记 write 后，必须丢掉 `reserved_version` 已不再匹配的 prefetch future（旧 fetch 可跑完但须 unregister pending read），再让 `_prefetch_hit_spans` 对现已 `IN_TRANSIT` 的行重规划。
    - COW 保住旧 tenant 时，该 hit 也不得继续用旧 future。
  - 验收：覆盖 fresh/reused block 与 immediate/deferred mm；断言 B 物化的 prefix 等于本步 A 刚写入的 hidden/mm，而不是 prefetch 当时的旧/空行。^[PR #7877]

## 决策与踩坑

- [SCHED-6a2] 禁止：把共享生命周期复制回两个 subclass；重建 `NewRequestData` 时只挑当前已知字段；在 mixin 内按 scheduler 类型隐式猜差异策略；失败 KV load 只改状态而不发 terminal output。
- [SCHED-1c] 禁止：只因 `_hit_prefetch` 已有 future 就跳过 re-plan；把提前读到的 pool 行当成 B 的 merged prefix。
