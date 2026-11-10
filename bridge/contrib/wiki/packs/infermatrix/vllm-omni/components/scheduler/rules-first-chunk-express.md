---
name: rules-first-chunk-express
description: "Native first-chunk scheduling 两条规则（PR #8184）：SCHED-NATIVE-1a sender-only native stage 不得等待不存在的 input chunk（V1/V2 选择随最终 stage model_config、resumable 入口拒绝 native MRv2 下游）；SCHED-EXPRESS-1a VLLM_OMNI_CODEC_FIRST_CHUNK_EXPRESS 默认关闭、express 不连续两步、continuation playback slack 与 audio credit"
metadata:
  scope: 只收 native sender-only admission 与 opt-in first-chunk express 两条规则；双 waiting queue 与 resumable 终态清理归 rules-release-queues，其余 SCHED-1a–3a 归 scheduler-rules-1、SCHED-4a–6f 归 scheduler-rules-2
---
# Native first-chunk scheduling 规则

## 关键事实

- 源页：`knowledge/repos/vllm-omni/components/scheduler/rules-first-chunk-express.md`（InferMatrixCopilot@ecfb84d0）；type: rule；tags: vllm-omni, components；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：PR #8184
- [SCHED-NATIVE-1a] Sender-only native stage 不能等待不存在的 input chunk
  - 触发：修改 shared scheduler 初始化、stage runner 选择、native input coordinator 或 resumable request admission。
  - 强制：scheduler 使用最终 stage model_config 的 V1/V2选择，与worker一致；native async coordinator 仅用于 stage0 或真正 receives_chunks 的 stage，sender-only downstream 保持可调度。resumable 请求进入 orchestrator 时核对有效 final stage 范围内 native MRv2 下游，发现即返回 request-scoped client error；
    - 模型 plugin 不能绕过 turn-only guard，adapter 缺席的 resume 路径安全返回。
  - 验收：V1/V2 sender-only、receiver、stage0、turn/resumable、不同 final stage 与不存在 adapter 分别回归；错误只结束目标请求，无永久 WAITING_FOR_CHUNK。 ^[PR #8184]
- [SCHED-EXPRESS-1a] First-chunk express 必须默认关闭并保留 continuation 机会
  - 触发：修改 VLLM_OMNI_CODEC_FIRST_CHUNK_EXPRESS、generation waiting/running 排序或 continuation playback slack。
  - 强制：显式 opt-in 且 native chunks 才可 express；仅就绪且无 in-flight 的首块触发，express 不能连续两步，延后已启动 continuation 后恢复 waiting 顺序。启用正 slack threshold 时所有已就绪 continuation 都必须有足够 audio credit；未知/多声道 layout 不赚 credit。credit 仅来自 mono tensor+正整数 sample rate，以首发 monotonic 时刻和发出长度估算，request free 清状态。
  - 验收：持续首块压力、mixed first/continuation、slack不足/未知/充足、stop/free/reuse与feature关闭分别覆盖；检查不连续 express、原顺序与尾块完整，并报告首次音频和continuation underrun。 ^[PR #8184]

## 决策与踩坑

- [SCHED-NATIVE-1a] 禁止：强制所有 scheduler V1；把 native sender capability 等同 receiver；把 mixed runner 支持外推为 duplex/streaming session protocol 支持。配置 precedence 与平台 veto 仍见 CONF-5m。
- [SCHED-EXPRESS-1a] 禁止：把 emitted audio credit 说成实际客户端已播放量；在默认关闭时改调度；把最多隔步 continuation 调度描述为无饥饿/低延迟保证；为首块忽略已有 in-flight 所有权。
