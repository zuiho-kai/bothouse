---
name: rules-stream-terminals
description: "规则 SCHED-STREAM-1a：empty terminal 只能在上一 consumable chunk 被调度后替换 prompt——receive gate 在 payload 仍 staged 时不取下一 chunk，missing codes 与 present empty snapshot 区分，MOSS、Qwen3、Higgs、Fish、Cosy 的 terminal 格式分别核对（PR #8213）"
metadata:
  scope: 只收 empty terminal、staged-payload receive gate 与 tail 守恒这一条规则；显式 prompt replacement 与 segment 边界 watermark（SCHED-6d、SCHED-6e）归 scheduler-rules-2
---
# Streaming terminal 与 staged payload 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/scheduler/rules-stream-terminals.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components, scheduler；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8213
- [SCHED-STREAM-1a] empty terminal 必须在上一 consumable chunk 被调度后才能替换 prompt
  - 触发：修改connector receivegate、control-message drain、generation prompt replacement或emptyEOF。
  - 强制：missingcodes不改prompt；presentempty snapshot清旧chunk/placeholder。该区分依赖receivegate：consumable payload仍staged时不能获取下一chunk；按requestack/schedule顺序推进，保护真实tail不被后续emptymetadata覆写。MOSS、Qwen3、Higgs、Fish、Cosy的terminal格式分别核对。
  - 验收：上一chunk未schedule时emptyEOF不能被fetch；正常tail→ack/schedule→emptyfinish、same-drainattempt、cancel与多request交错都验证frame守恒与no-duplicate。模型控制组必须穿过真实scheduler/connector，不只独立调用metadata更新。 ^[PR #8213]

## 决策与踩坑

- [SCHED-STREAM-1a] 禁止：用truthiness混同missing与empty；last-writer-wins drain先收真实tail再收EOF后只调度empty；重复decode上一prompt，或为一个模型clear逻辑绕过全局receivegate。
