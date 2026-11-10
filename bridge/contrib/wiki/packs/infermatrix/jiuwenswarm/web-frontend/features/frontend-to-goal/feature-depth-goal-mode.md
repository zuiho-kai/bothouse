---
name: feature-depth-goal-mode
description: 持续目标实现深读：applyGoalArm→evaluateGoalArm→isGoalSessionBusy→hasPendingGoalAction 闸门调用链、command.goal 一次性 res 与流式 fire-and-forget 两种形态、请求负载缺省、runtime.accepted 与 execution.error 处理、goalStore 依赖、set/resume 取舍与 sessionInput 测试断言
metadata:
  scope: 只收持续目标前端实现的逐点证据；功能概览与验收步骤归 feature-goal-mode
---
# 持续目标与会话控制：实现深读

## 现状

- [[feature-goal-mode]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **目标武装开关的闸门调用链：applyGoalArm → evaluateGoalArm → isGoalSessionBusy → hasPendingGoalAction** 用户在"+"菜单或 /goal 命令触发目标武装切换时，applyGoalArm 以 (sessionId, next) 为输入：先同步调用 evaluateGoalArm 做纯判定；
  - 关闭方向（next=false）时 evaluateGoalArm 调用 isGoalSessionBusy，后者再调用 hasPendingGoalAction 读取 useGoalStore 的 runtimes[sessionId].pendingAction。全部通过且 next=true 时，applyGoalArm 会把未提交的 Plan 关闭（planStore.setActive(sessionId, false)），最后 useGoalStore.setArmed(sessionId, next) 翻转武装位并返回 true；
  - 被拦截则回调 options.onBlocked(reason) 并返回 false。
- 调用路径：`jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts`（`applyGoalArm`） → `jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts`（`evaluateGoalArm`） → `jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts`（`isGoalSessionBusy`） →
  - `jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts`（`hasPendingGoalAction`）
- 来源：[jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L201–L220](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L201-L220),
  - [jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L162–L182](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L162-L182),
  - [jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L126–L132](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L126-L132),
  - [jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L99–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L99-L102)
- **command.goal 的两种请求形态：一次性 res 与流式 fire-and-forget** requestGoalAction（action 为 'get' | 'pause' | 'clear'）走 webRequest 等 res，action==='clear' 时直接返回 null（成功后 goal 视为已清空），否则取 payload.goal ?? payload.record；
  - sendGoalStreamCommand（action 为 'set' | 'resume'）以 isStream:true 调 sendFireAndForget，不注册 pending、无超时，调用方义务是自行订阅 goal.snapshot/goal.updated 等事件获取真实状态。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L747–L763](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L747-L763),
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L773–L792](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L773-L792),
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L340–L365](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L340-L365)
- **sendGoalStreamCommand 请求负载缺省：mode ?? 'agent'，仅 set 附带 objective/overwrite_confirmed** 发送 'command.goal' 时 mode 未传按 `mode ?? 'agent'`；action==='set' 才带 objective 与 overwrite_confirmed:true，model_name 仅在 modelName 真值时附带，并以 { isStream: true } 发送。这些是该请求负载的缺省，非全局配置。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L773–L792](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L773-L792)
- **runtime.accepted 仅清残留的 resume/set pendingAction；execution.error 带 goal 时刷快照** `runtime.accepted` 回调里 payload 取不到 session id 直接 return；session 的 `pendingAction` 仍为 'resume' 或 'set' 时调用 `setPendingAction(sessionId, null)` 复位，其他值不动。
  - `execution.error` 回调在 `payload.goal !== undefined` 时以该 payload 调 `applyGoalSnapshot`。
- 来源：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L4236–L4245](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L4236-L4245),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L4247–L4251](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L4247-L4251)
- **goalModeGate 依赖 goalStore，按会话读取并写入 pendingAction** goalModeGate.ts 导入 goalStore 的 useGoalStore；sessionId 为空时 hasPendingGoalAction 直接返回 false，否则读该会话 runtimes 条目判 pendingAction != null（无 runtime 也判否）。setPendingAction 在会话缺状态时新建空 runtime，保留既有字段仅替换 pendingAction。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L19–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L19-L19),
  - [jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L99–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts#L99-L102),
  - [jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts:L265–L275](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts#L265-L275)
- **set/resume 以 fire-and-forget 发送，状态靠去重后的 goal 事件落地** 设计推断（非作者历史意图）：
- 推断收益/代价：sendGoalStreamCommand 经 sendFireAndForget（isStream:true），先 await ensureReady 与 OPEN 检查再发送，不登记待响应也不设超时，省去等注释所述永不返回的 res；但发送完成不代表目标已落地，仍依赖通过 shouldDropDuplicatedEvent 的 goal.snapshot/goal.updated 回调进入 applyGoalSnapshot，且解析不出 sessionId 时直接返回不应用。
- 来源：[jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L330–L366](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L330-L366),
  - [jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L765–L792](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/services/webClient.ts#L765-L792),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L4221–L4228](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L4221-L4228),
  - [jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L2780–L2791](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L2780-L2791)
- **goal 暂停/清除模拟事件序列结束处理且不显示旧尾部的既有 runtime 断言** sessionInput.test.mjs 用 esbuild 打包真实 useWebSocket/goalStore/webClient，在 JSDOM+桩 Socket+假定时器中挂载；
  - 用例注入 goal.updated（active→paused→goal=null）、被抑制的旧输出及末尾空 chat.final 后，断言 isProcessing=false、isThinking=false、currentStreamId=null、goalStore 目标为 null，可见气泡仅原问题/原答案/新指令。这是所示模拟事件序列的既有 automated runtime 断言，本轮未执行，不验证服务端目标调度。
- 来源：[jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs:L1–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs#L1-L63),
  - [jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs:L65–L200](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs#L65-L200),
  - [jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs:L880–L920](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs#L880-L920)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-goal-mode.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L201-L220
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L162-L182
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L126-L132
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L99-L102
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L747-L763；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L773-L792
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L340-L365；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L4236-L4245
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L4247-L4251；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs:L1061-L1073
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts:L19-L19；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts:L265-L275
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L330-L366；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/services/webClient.ts:L765-L792
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L4221-L4228；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L2780-L2791
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs:L1-L63；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs:L65-L200
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/sessionInput.test.mjs:L880-L920
- 源页字段（feature）：goal-mode
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts；jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts；jiuwenswarm/channels/web/frontend/src/services/webClient.ts；jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/goalMode/goalModeGate.ts；jiuwenswarm/channels/web/frontend/src/stores/goalStore.ts；jiuwenswarm/channels/web/frontend/src/services/webClient.ts；jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts
