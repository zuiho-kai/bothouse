---
name: rules-settled-preprocess
description: "MRv2 settled row preprocess 规则 EXEC-SETTLED-1a（PR #8477）：run_preprocess 的 _split_settled_rows 仅当本步 scheduled tokens=1 且 slot owner 等于当前 request ID 才判 settled，identity decode 另有 skip 或 pending preemption replay 时保留原 row loop；eager MTP tuple 转置保持字段布局，preempted stream 的 CPU history 恢复到当前 worker device"
metadata:
  scope: 只收 MRv2 vectorized settled rows 的 predicate 与 preemption replay fallback 一条规则 EXEC-SETTLED-1a；eager-MTP replay 的 optional codec 检查归 rules-mrv2-optional-codec，MRv2 输出合同归 rules-mrv2-output-contracts
---
# MRv2 settled row preprocess 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/model-executor/rules-settled-preprocess.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8477
- [EXEC-SETTLED-1a] Vectorized settled rows 必须保留 scalar predicate 和 replay fallback
  - 触发：修改MRv2run_preprocess、_split_settled_rows、eagerMTPmetadata或preemptedstreamrestore。
  - 强制：settled仅当本步scheduledtokens=1且slotowner恰等当前requestID；返回settled与remaining两组保持roworder/queryoffset。当identitydecode另有skip或pendingpreemptionreplay时保留原rowloop，buffer/slot清理同步清settledowner。eagerMTPtuple一次transpose仍按原row/request/prefill/firstaudio/position字段布局，ready更新保留slot→ID；
    - 只有待restore状态非空才扫描，CPU保存history恢复到当前workerdevice后再执行。
  - 验收：随机slotpermutation、staleID、mixedtokencount、pendingreplay、queryoffset与scalarpredicate对照；暂停/恢复streamdecoder和非emptyrestore保留原PCM，热路径改写不改变requeststate。 ^[PR #8477]

## 决策与踩坑

- [EXEC-SETTLED-1a] 禁止：只靠slot命中旧request；把preemptionreplay当普通settledskip；转置时重排firstaudio/prefill flags；以CPU/GPU驻留判断扩展为任意device迁移保证。
