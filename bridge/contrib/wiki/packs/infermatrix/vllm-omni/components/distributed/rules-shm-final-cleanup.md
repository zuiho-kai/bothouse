---
name: rules-shm-final-cleanup
description: "Distributed 规则 DIST-FINAL-1a、DIST-FINAL-1b：stage-0-final 完成时不发送空 finished SHM，CFG force-KV override 只影响 KV；undrained segment 只在全部 stage 结束后由 orchestrator 发 background release（每 RPC 至多 5 s），adapter 仅回收自己 tracked 的 `<external>_<stage>_<integer-chunk>`（PR #7245）"
metadata:
  scope: 只收 stage final 的 chunk omission 与全部 stage 结束后的 SHM segment 回收两条规则；SHM producer 按完整 key 清理与 reap_consumed（DIST-1m）归 distributed-rules-2，SHM arrival wakeup 归 rules-shm-readiness
---
# Stage final SHM cleanup 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/distributed/rules-shm-final-cleanup.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #7245
- [DIST-FINAL-1a] Stage-0-final 的 chunk omission 必须与 KV override 分开
  - 触发：修改 AR save_async 条件、omni_final_stage_id、CFG companion 或 metadata cache。
  - 强制：stage-0-final 没有 downstream chunk consumer，完成时不发送空 finished SHM；CFG force-KV override 只影响 KV，不重新启用 chunk。payload identity 变化使 cached flags 失效，streaming replacement 主动清 cache；必须在 free_request 重写 metadata 前读取 omission。异常携带 inter-stage output 的 stage-0-final 记录 warning 并仍不 put。
  - 验收：text-only、CFG force-KV、普通 downstream、metadata 替换与 in-place lifecycle reset 分别检查 put/KV 行为；用实际 SHM+lockfile 扫描验证 final 请求不留下无人接收 segment。 ^[PR #7245]
- [DIST-FINAL-1b] Undrained segment 只能在全部 stage 完成后按 owner prefix 回收
  - 触发：修改 orchestrator cleanup、release RPC、adapter save-thread reclaim 或 SHM prefix cleanup。
  - 强制：只有知道所有 stage 已结束的 orchestrator 发 best-effort background release；强引用 task，stage/replica 并发 RPC 每个至多等 5 s，失败 warning，非 async_chunk 跳过。广播 live replicas 而不依赖已释放 binding；adapter 映射 external ID 后排队到 save thread，仅回收自己 tracked 的 `<external>_<stage>_<integer-chunk>`，未知 ID 幂等。
    - 内部请求 ID 继续带唯一 suffix/UUID，延迟 release 不能命中后续请求。
  - 验收：early consumer stop、正常 terminal drain、unknown/repeated release、相似 ID、late put、dead replica timeout 与不同 internal ID 并发回归；保留原 producer fencing。 ^[PR #7245]

## 决策与踩坑

- [DIST-FINAL-1a] 禁止：复用仅按 request ID 缓存的旧 final/KV 决定；把 force-KV 当 chunk consumer；普通 downstream request 也跳过 terminal，从泄漏修复变成接收端挂起。
- [DIST-FINAL-1b] 禁止：scheduler thread 执行 unlink/I/O；producer/consumer 未结束就删除 terminal；按模糊 request prefix 扫全目录；因 RPC 成功就声称强事务/网络或资源释放必达。
