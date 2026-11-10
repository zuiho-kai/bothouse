---
name: feature-planning
description: 任务规划与 Todo 功能概览：CodeTaskPlanningRail、task_reminder_turns_since_management 等提醒参数、会话级 Todo 持久化与验证步骤
metadata:
  scope: 只收任务规划与 Todo 的职责、接口、配置入口、设计取舍与验证方法（guide）；提醒附件调用链、默认值与单测断言归 feature-depth-planning
---
# 任务规划与 Todo 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-planning.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/任务规划.md
- 源页字段（feature）：planning
- 入口（entry_points）：jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py；jiuwenswarm/agents/harness/common/*；jiuwenswarm/agents/harness/code/prompt/code_todo_tool_prompts.py；jiuwenswarm/agents/harness/code/tools/__init__.py；jiuwenswarm/agents/harness/code/tools/code_todo_tools.py
  - jiuwenswarm/channels/web/frontend/src/components/MemberTaskDrawer/index.tsx；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/channels/web/frontend/src/components/TodoList/TodoItem.tsx；jiuwenswarm/channels/web/frontend/src/components/TodoList/index.tsx
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/CompactTaskList.tsx；jiuwenswarm/channels/web/frontend/src/components/teamArea/MemberTaskList.tsx；jiuwenswarm/channels/web/frontend/src/components/teamArea/TaskPlanningPanel.tsx
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/TeamMembersPanel.tsx；jiuwenswarm/channels/web/frontend/src/components/teamArea/UnassignedTeamAvatar.tsx；jiuwenswarm/channels/web/frontend/src/components/TeamTaskEvents.tsx
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/taskProgress.ts；jiuwenswarm/channels/web/frontend/src/components/AgentPanel/FileViewer.tsx；jiuwenswarm/channels/web/frontend/src/types/todo.ts；jiuwenswarm/agents/harness/common/tools/todo_toolkits.py
  - jiuwenswarm/agents/harness/common/tools/todo_compat.py；jiuwenswarm/channels/tui/frontend/src/ui/components/todo-list.ts；jiuwenswarm/channels/tui/frontend/src/app-state.ts；jiuwenswarm/channels/web/frontend/src/components/teamArea/index.tsx
  - jiuwenswarm/channels/web/frontend/src/stores/todoStore.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 任务规划把长目标拆成可跟踪的任务状态，Todo 提供查询与修改入口。计划文本、Todo 持久化状态和真正的执行结果需要分别验证。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1–L691](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L1-L691)；
  - [docs/zh/任务规划.md:L1–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E4%BB%BB%E5%8A%A1%E8%A7%84%E5%88%92.md#L1-L55)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `CodeTaskPlanningRail [on_user_message, before_model_call, after_tool_call, init]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1–L691](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L1-L691)；
  - [docs/zh/任务规划.md:L1–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E4%BB%BB%E5%8A%A1%E8%A7%84%E5%88%92.md#L1-L55)。

### 配置入口与生效条件

- 该源码入口的构造或调用参数包括 `task_reminder_turns_since_management`、`task_reminder_turns_between_reminders`、`max_tracked_task_reminder_sessions`；它们是调用参数，不自动等同于全仓持久配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1–L691](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L1-L691)；
  - [docs/zh/任务规划.md:L1–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E4%BB%BB%E5%8A%A1%E8%A7%84%E5%88%92.md#L1-L55)。

### 设计取舍

- **设计推断**：Todo 以会话为边界持久化任务状态，使长任务可跟踪并接受新增要求；代价是计划、执行与完成状态必须同步。记录一个任务为完成不能替代验证其产物，动态插入任务也需要保持已有进度可解释。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1–L691](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L1-L691)；
  - [docs/zh/任务规划.md:L1–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E4%BB%BB%E5%8A%A1%E8%A7%84%E5%88%92.md#L1-L55)。

### 数据流与关联功能

- 任务规划把长目标拆成可跟踪的任务状态，Todo 提供查询与修改入口。计划文本、Todo 持久化状态和真正的执行结果需要分别验证。 联调时结合[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）、[[feature-harness]]（Agent Loop 与 Rail 装配）、[[feature-subagents]]（子代理派发与验证）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1–L691](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L1-L691)；
  - [docs/zh/任务规划.md:L1–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E4%BB%BB%E5%8A%A1%E8%A7%84%E5%88%92.md#L1-L55)。

### 怎样验证

- 创建多步骤任务并在执行中插入新要求，检查 Todo 的增删改查、顺序和状态更新。恢复会话后核对持久化计划；验证两个会话的 Todo 隔离及取消后未完成任务的呈现。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py:L1–L691](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_task_planning_rail.py#L1-L691)；
  - [docs/zh/任务规划.md:L1–L55](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E4%BB%BB%E5%8A%A1%E8%A7%84%E5%88%92.md#L1-L55)。
