---
name: gateway-channel-manager-rules
description: "JW-XIAOYI-AUDIT-1a：小艺 XiaoyiChannel.send 流式审计须有界（字典最多 64 条、样本最多三条）且异常不影响投递（PR #7625）"
metadata:
  scope: 只收 JW-XIAOYI-AUDIT-1a 一条规则的触发、强制、禁止与验收；channel_manager 的逐文件接口声明归 gateway-channel-manager-contracts-01
---
# gateway-channel-manager 审查规则

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-channel-manager/rules.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: jiuwenswarm, components；created: 2026-10-09；updated: 2026-10-09
- 来源（sources）：PR #7625
- 置信度（confidence）：high
- [JW-XIAOYI-AUDIT-1a] 小艺流式审计有界且异常不影响投递
  - 触发：修改 xiaoyi_0.2.4.beta3 XiaoyiChannel.send 的 stream audit。
  - 强制：统计放在异常隔离块，仅读取消息；按 session/task 累计正文/思考与切换次数，字典最多 64 条，样本最多三条且截断；终态移除状态，有计数帧才向既有 logger 输出一行汇总。
  - 验收：构造统计异常仍投递原消息；超过容量时淘汰最旧记录；终态后无残留，空轮不输出汇总。^[PR #7625]

## 决策与踩坑

- [JW-XIAOYI-AUDIT-1a] 禁止：诊断异常向 send 传播；修改或丢弃帧；无界保存状态；新增逐帧日志或独立日志文件；把网关观测直接等同于模型内在行为证明。
