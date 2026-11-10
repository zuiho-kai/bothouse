---
name: feature-depth-planning
description: 任务规划与 Todo 实现深读：code_task_planning_rail.py 的 task_reminder 恢复调用链、提醒节奏默认 10/10 轮与会话数 1000、after_tool_call 重置、_load_fresh_todos 异常兜底与单测
metadata:
  scope: 只收 CodeTaskPlanningRail 的实现级事实；职责、接口与验证方法的概览归 feature-planning
---
# 任务规划与 Todo：实现深读

## 现状

- [[feature-planning]]（功能概览） · [[agents-team-overview-1]]、[[agents-team-overview-2]]（owner 入口）
- **用户消息进入时恢复 task_reminder 附件的调用链** 用户消息到达后，CodeTaskPlanningRail.on_user_message 调用 _restore_task_reminder_attachment，后者经 _session_id 取会话标识，再调用 _task_reminder_lock 获取该会话的 asyncio.Lock，确保恢复与节奏变更互斥；锁在 WeakValueDictionary 中按 session_id 惰性创建。
- 调用路径：`jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py`（`CodeTaskPlanningRail.on_user_message`） → `jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py`（`CodeTaskPlanningRail._restore_task_reminder_attachment`） →
  - `jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py`（`CodeTaskPlanningRail._task_reminder_lock`）
- 来源：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L86–L89](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L86-L89),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L249–L261](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L249-L261),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L426–L431](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L426-L431)
- **提醒节奏构造参数默认 10/10 轮，会话数下限为 1** 构造参数 task_reminder_turns_since_management 与 task_reminder_turns_between_reminders 默认取常量 _TASK_REMINDER_TURNS_SINCE_MANAGEMENT=10 与 _TASK_REMINDER_TURNS_BETWEEN_REMINDERS=10；max_tracked_task_reminder_sessions 默认 1000 且经 max(1, ...) 取下限。
  - 生效条件是两个计数同时达到阈值才追加一次提醒，并把 turns_since_task_reminder 清零。
- 来源：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L1-L84),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L91–L154](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L91-L154)
- **继承 openjiuwen TaskPlanningRail 并复用 CodeTodo* 工具与提示附件管理器** CodeTaskPlanningRail 继承 openjiuwen.harness.rails.task_planning_rail 的 TaskPlanningRail（构造先 super().__init__，after_tool_call 先调 super()），并从 jiuwenswarm 的 code_todo_tools 导入 CodeTodoCreate/Get/List/Modify 四个工具类用于注册。
  - 提醒附件经 agent.prompt_attachment_manager.add_section 写入，依赖 PromptAttachment/PromptAttachmentKind 等平台附件抽象。
- 来源：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L1-L84),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L156–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L156-L169),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L104–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L104-L115)
- **缺少会话或附件管理器时静默跳过提醒逻辑** before_model_call 在 session_id 为空、agent 无 prompt_attachment_manager 或找不到 todo 工具时直接 return，不追加提醒；_session_id 对没有 get_session_id 方法的 session 返回 None。同一会话的恢复与计数变更由 _task_reminder_lock 的 asyncio.Lock 串行化，锁对象经 WeakValueDictionary 惰性创建。
- 来源：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L91–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L91-L115),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L234–L238](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L234-L238),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L426–L431](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L426-L431)
- **节奏投递与并发串行化的测试断言** tests/unit_tests/agents/harness/code/test_code_task_planning_rail.py::test_code_task_planning_rail_injects_one_attachment_per_reminder_period 断言：该用例配置下连续 9 次 before_model_call 后 sync_to_context 均返回 None，
  - 第 10 次投递唯一 todo_reminder 附件（metadata["delivery_sequence"]==1，内容含 "todo_list to read the latest task state" 且不含具体 todo 项文本），再 9 轮后投递 delivery_sequence==2 的第二条且历史消息均不含 "no longer active"。
  - test_code_task_planning_rail_serializes_overlapping_session_updates 用延迟的 add_section 断言并发两次 before_model_call 仅产出一条 delivery_sequence==1 的提醒且 state.turns_since_task_reminder==1，覆盖会话锁串行化。
- 来源：[tests/unit_tests/agents/harness/code/test_code_task_planning_rail.py:L143–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/harness/code/test_code_task_planning_rail.py#L143-L210),
  - [tests/unit_tests/agents/harness/code/test_code_task_planning_rail.py:L558–L589](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agents/harness/code/test_code_task_planning_rail.py#L558-L589)
- **after_tool_call 仅在 todo 工具调用且解析出 session_id 时重置 turns_since_task_management** 异步 after_tool_call(ctx) 先 await super()；若非 todo 工具调用或解析不到 session_id 则直接返回。否则在该 session 的锁内取提醒状态（缓存命中返回副本，否则从 history 重建并保存），将 turns_since_task_management 置 0 后存入按 max_tracked_task_reminder_sessions 限容、LRU 淘汰最旧的会话缓存。
- 来源：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L156–L169](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L156-L169),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L448–L459](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L448-L459),
  - [jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L590–L598](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L590-L598)
- **_load_fresh_todos 捕获 load_todos 的任意异常并返回空列表（仅 debug 日志）** 设计推断（非作者历史意图）：
- 未找到 todo 工具或 tool.load_todos 抛出任意 Exception 时都返回 []，后者仅 logger.debug 记录且不更新 _todos_cache。收益（推断）：todo 存储故障不会打断 rail；代价（推断）：调用方无法区分「无 todo」与「读取失败」。
- 来源：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L642–L654](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L642-L654)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-depth-planning.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L86-L89；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L249-L261
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L426-L431；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1-L84
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L91-L154；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L156-L169
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L104-L115；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L91-L115
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L234-L238
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/harness/code/test_code_task_planning_rail.py:L143-L210
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agents/harness/code/test_code_task_planning_rail.py:L558-L589
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L448-L459
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L590-L598
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L642-L654
- 源页字段（feature）：planning
- 入口（entry_points）：jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py；jiuwenswarm/agents/harness/common/*
