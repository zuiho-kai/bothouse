---
name: rules-shm-readiness
description: "Distributed 规则 DIST-WAKE-1a：SharedMemoryConnector 的 FIFO arrival wakeup 只作提示——同一 deployment 共用 wakeup_scope、接收者各持 UUID FIFO、发送与接收用独立 event，wakeup 不可用时保留 timed polling（poll 间隔非法时回退 5 ms）（PR #8184）"
metadata:
  scope: 只收 SHM connector 的 arrival wakeup 与有界 polling 这一条规则；stage final 的 SHM 回收归 rules-shm-final-cleanup，SHM key 清理（DIST-1m）归 distributed-rules-2
---
# SHM arrival readiness 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/distributed/rules-shm-readiness.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8184
- [DIST-WAKE-1a] FIFO wakeup 只能作为提示，正确性必须保留有界 polling
  - 触发：修改 SharedMemoryConnector arrival wakeup、native receiver loop、send/receive work event 或 connector shutdown。
  - 强制：launcher 为同一 deployment 的 SHM connectors 生成并序列化同一 wakeup_scope，接收者各持 UUID FIFO；put 后非阻塞广播目标 stage 的所有当前 FIFO，校验 FIFO 类型且不跟随 symlink。receive 在 poll 前取 generation、无 progress 后等新 generation，不能以已存在未来 chunk 的 key 作 readiness predicate。发送和接收分别用独立 event，shutdown 唤醒两者；
    - graceful close 只删自己 FIFO，空目录才移除。wakeup 不可达/禁用/满 pipe 时保留 timed polling；poll ms 必须 finite/positive，否则 warning 后 5 ms，两个等待路径都用最终间隔。
  - 验收：不同 parent、多个 replica/restart、hint-before-poll、blocked future chunk、满/缺失 FIFO、无效 poll interval 与 shutdown 并发分别覆盖；禁用 wakeup 仍交付同一数据且不忙等。 ^[PR #8184]

## 决策与踩坑

- [DIST-WAKE-1a] 禁止：按 EngineCore parent 分裂已声明的 deployment scope；缓存跨 receiver restart 的 writer；清理 peer FIFO；让 receive 清掉 send wakeup；把本机 FIFO 提示声称为 multi-node transport 或 hard-crash 自动回收保证。
