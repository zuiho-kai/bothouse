---
name: rules-control-request-schema
description: "规则 SERV-CONTROL-1a：/v1/omni/sleep 与 /v1/omni/wakeup 的 OmniSleepRequest / OmniWakeupRequest schema 在 RPC 前拒绝空 stage_ids（min_length=1）和负 level（默认 2、ge=0），无效请求返回 422（PR #4740）"
metadata:
  scope: 只收 sleep/wakeup HTTP 请求 schema 这一条规则；stage 是否存在、ACK 与 admission 的后续状态合同归 rules-sleep-control
---
# Omni control request schema 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/serving/rules-control-request-schema.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #4740
- [SERV-CONTROL-1a] Sleep/wakeup HTTP schema 必须在 RPC 前拒绝空目标和负 level
  - 触发：修改 OmniSleepRequest/OmniWakeupRequest 或 /v1/omni/sleep、/v1/omni/wakeup 请求字段。
  - 强制：两类stage_ids仍required list[int]且min_length=1；sleep level默认2、ge=0。无效schema由HTTPvalidation拒绝，保留有效level0/非空target通路；stage是否存在、backendlevel能力和部分成功由后续owner处理。
  - 验收：emptytargets与negativelevel返回422/对应HTTPvalidationdetail；缺字段、level0/default及单/多stage合法结构通过，然后独立执行已有stage/admission/ACK状态验收。 ^[PR #4740]

## 决策与踩坑

- [SERV-CONTROL-1a] 禁止：把空[]解释为所有stage；负level转默认；额外从此PR推断list元素非负/unique、只允许level1/2或已完成真实模型sleep测试。
