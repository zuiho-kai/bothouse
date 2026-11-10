---
name: feature-depth-plan-mode
description: 计划模式实现深读：applyPlanToggle→evaluatePlanToggle→isSessionBusyForPlanToggle 闸门链路、对 chatStore 与 goalStore 的耦合、applyPlanToggle 返回 true 不保证状态变化、explicitEntry 与 plan_toggle 默认值、忙或未完成目标时的拒绝原因、planStore.toggle 绕过闸门的取舍、test_plan_entry_source_contract 源文本比对
metadata:
  scope: 只收 planModeGate 与 planStore 的实现级证据与设计推断；功能概览、接口清单与验收步骤归 feature-plan-mode
---
# 计划模式与多入口切换限制：实现深读

## 现状

- [[feature-plan-mode]]（功能概览） · [[web-frontend-overview-1]]、[[web-frontend-overview-2]]（owner 入口）
- **用户切换计划模式的统一闸门链路** 任意用户入口调用 applyPlanToggle(sessionId, next)：它先调 evaluatePlanToggle 判断目标状态是否允许；evaluatePlanToggle 内部调 isSessionBusyForPlanToggle 读取 chatStore 中该会话的 isProcessing/isPaused/pendingQuestions。校验通过后 applyPlanToggle 才 ensureRuntime 并调 planStore.setActive 翻转开关；
  - 被拦下时通过 options.onBlocked 回传原因并返回 false。
- 调用路径：`jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts`（`applyPlanToggle`） → `jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts`（`evaluatePlanToggle`） →
  - `jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts`（`isSessionBusyForPlanToggle`）
- 来源：[jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L115–L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L115-L137),
  - [jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L81–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L81-L99),
  - [jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L54–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L54-L63)
- **闸门对 chatStore 与 goalStore 的耦合** isSessionBusyForPlanToggle 直接读 useChatStore.getState().runtimes[sessionId] 的 isProcessing/isPaused/pendingQuestions 三个信号；sessionHasUnfinishedGoal 读 useGoalStore 的 goal 并交给 hasUnfinishedGoal 判定（打开方向命中时返回 'plan.toolbarUnavailableGoal'）。
  - 这使计划开关的限制口径依赖会话与目标两个 store 的运行时状态。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L54–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L54-L70),
  - [jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L81–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L81-L99)
- **applyPlanToggle 契约：返回 true 仅代表通过校验并调用了 setActive，不保证状态实际变化** sessionId 为空或 evaluatePlanToggle 拒绝时返回 false（有 reason 则回调可选 onBlocked）；通过后按方向调 planStore.setActive 并返回 true。setActive 在新旧值一致时返回原 state，故 true 不代表 store 状态必然变化。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L115–L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L115-L137),
  - [jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L81–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L81-L99),
  - [jiuwenswarm/channels/web/frontend/src/stores/planStore.ts:L76–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/planStore.ts#L76-L102)
- **开关默认值：applyPlanToggle 打开走 explicitEntry ?? true 与 PLAN_ENTRY_SOURCE_PLAN_TOGGLE；setActive 仅在 explicitEntry 为真时补 'plan_toggle' 缺省** 校验通过后 next=true 以 options.explicitEntry ?? true、options.entrySource ?? PLAN_ENTRY_SOURCE_PLAN_TOGGLE 调 setActive；
  - next=false 调 setActive(sessionId, false) 不带 options。setActive 里 active=true 时已有 pending 值优先（|| 合并），仅当 options.explicitEntry 为真才写 entrySource（缺省 'plan_toggle'）；active=false 时 pendingExplicitEntry 复位 false、pendingEntrySource 复位 null，结果写入该会话 runtime 记录。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L115–L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L115-L137),
  - [jiuwenswarm/channels/web/frontend/src/stores/planStore.ts:L76–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/planStore.ts#L76-L102)
- **会话忙或（打开方向）存在未完成目标时 applyPlanToggle 返回 false 不调 setActive，仅回调可选 onBlocked(reason)** evaluatePlanToggle：next=true 先拒未完成目标（'plan.toolbarUnavailableGoal'）再拒忙（'plan.toolbarUnavailableProcessing'）；next=false 仅忙时拒（'plan.closeTagDisabled'）。
  - 忙 = isProcessing || isPaused || pendingQuestions.length > 0（sessionId 或 runtime 缺失视为不忙）。被拒时 applyPlanToggle 本地返回 false、不调 planStore.setActive；decision.reason 存在才调用调用方提供的 options.onBlocked?.(reason)。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L54–L99](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L54-L99),
  - [jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L115–L137](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L115-L137)
- **收益：单一忙口径可拦住等待期切换；成本：闸门非强制，planStore.toggle 仍直通 setActive** 设计推断（非作者历史意图）：
- 收益：忙口径含 isPaused 与 pendingQuestions，ask_user 等待期 isProcessing=false 时也能拦截（历史绕过仅由文件头注释记录，属文档性证据）。成本：拦截依赖入口自觉走闸门——planStore.toggle 直接 setActive({explicitEntry:true})，不经 evaluatePlanToggle。
- 来源：[jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L1–L19](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L1-L19),
  - [jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L54–L63](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts#L54-L63),
  - [jiuwenswarm/channels/web/frontend/src/stores/planStore.ts:L104–L108](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/stores/planStore.ts#L104-L108)
- **pytest 用正则比对 Web planEntrySource.ts 字面量与后端常量（源文本级，非运行时集成）** test_plan_toggle_literal_matches_web_ts 调 _extract_ts_const(_WEB_TS, 'PLAN_ENTRY_SOURCE_PLAN_TOGGLE')，以正则 export const NAME = 'literal' 抽取 Web 端 .ts 源文本字面量，断言与后端 PLAN_ENTRY_SOURCE_PLAN_TOGGLE == 相等（Python 端 rename 会使断言 fail）。
  - 该验证只比对源文件文本；planModeGate 闸门的前端运行时断言未出现在展示区间，permissionAnswerTransport.test.mjs 展示区间仅见 evaluatePlanToggle 的 import。
- 来源：[tests/unit_tests/test_plan_entry_source_contract.py:L84–L93](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_plan_entry_source_contract.py#L84-L93),
  - [tests/unit_tests/test_plan_entry_source_contract.py:L48–L57](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_plan_entry_source_contract.py#L48-L57),
  - [jiuwenswarm/channels/web/frontend/tests/permissionAnswerTransport.test.mjs:L43–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/tests/permissionAnswerTransport.test.mjs#L43-L49)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-depth-plan-mode.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L115-L137
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L81-L99
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L54-L63
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L54-L70；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_plan_entry_source_contract.py:L84-L93
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_plan_entry_source_contract.py:L48-L57；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/tests/permissionAnswerTransport.test.mjs:L43-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/stores/planStore.ts:L76-L102；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L1-L19
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/stores/planStore.ts:L104-L108；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts:L54-L99
- 源页字段（feature）：plan-mode
- 入口（entry_points）：jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts；jiuwenswarm/channels/web/frontend/src/stores/planStore.ts
- 源页字段（source_globs）：jiuwenswarm/channels/web/frontend/src/features/planMode/planModeGate.ts；jiuwenswarm/channels/web/frontend/src/stores/planStore.ts
