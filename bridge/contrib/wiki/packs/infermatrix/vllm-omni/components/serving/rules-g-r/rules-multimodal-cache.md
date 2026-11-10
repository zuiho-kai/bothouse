---
name: rules-multimodal-cache
description: "规则 SERV-MM-UUID-1a：stage-0 AR 多 replica 路径预选 receiver 后，把 replica scoped 多模态 UUID 写入返回的 prompt shallow copy 并一路传给 processor / add request，不回写 caller dict；单 replica、无 multimodal data、diffusion stage 保留原 prompt（PR #8062）"
metadata:
  scope: 只收多模态 processor cache 的 replica scoped UUID 这一条规则；Realtime 预算预检不污染 sender cache（SERV-RT-1h）归 rules-realtime-openai
---
# 多模态 processor cache 的 replica identity 合同

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-multimodal-cache.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #8062
- 置信度（confidence）：high
- [SERV-MM-UUID-1a] replica scoped UUID 写入返回副本
  - 触发：修改 stage-0 replica 预选、多模态 UUID prefix 或 add-request prompt 处理。
  - 强制：只对实际需要 scoped cache 的 stage-0 AR 多 replica 路径预选 receiver；保留 caller prompt，返回 shallow copy 写入 scoped UUID，并把该返回 prompt 一路传给 processor/add request。list prompt 保留相同结构；无 multimodal data、单 replica、diffusion stage 或预选不可用保留原 prompt。
  - 验收：复用同一 prompt dict 并更换媒体，跨两个 replica 检查不同正确 key 与 payload 接收；断言 caller UUID/media 不变，list 与 bypass 路径保持返回合同。 ^[PR #8062]

## 决策与踩坑

- [SERV-MM-UUID-1a] 禁止：把 scoped UUID 回写 caller dict，导致复用 prompt 时新媒体沿用旧内容 hash 或重复 prefix；选中 receiver 后仍处理未 scoped 原 prompt。
