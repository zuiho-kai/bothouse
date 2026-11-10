---
name: feature-cron
description: 定时任务与调度存储的职责、接口与配置：职责边界、CronStoreSettings/create_gateway_cron_store 入口、配置生效条件、设计取舍、数据流与建议验证（factory.py 与 docs/zh/定时任务.md 引用）
metadata:
  scope: 只收该功能的基础知识入口；实现深读归 feature-depth-cron，任务模型与路由归 jiuwenswarm-runtime-cron，存储后端归 jiuwenswarm-cron-store，设计取舍归 cron-scheduling-design-tradeoffs
---
# 定时任务与调度存储 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/cron-scheduling/feature-cron.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/cron/factory.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/定时任务.md
- 源页字段（feature）：cron
- 入口（entry_points）：jiuwenswarm/runtime/cron/factory.py
- 源页字段（source_globs）：jiuwenswarm/runtime/cron/factory.py；jiuwenswarm/runtime/cron/*.py；jiuwenswarm/gateway/message_handler/message_handler.py；jiuwenswarm/gateway/cron/controller.py；jiuwenswarm/agents/harness/common/tools/cron/cron_tools.py
  - jiuwenswarm/agents/harness/common/tools/cron/cron_runtime.py；jiuwenswarm/gateway/channel_manager/channel_manager.py；jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronExprValidation.ts；jiuwenswarm/runtime/cron/cron_expr.py；jiuwenswarm/runtime/cron/store.py
  - jiuwenswarm/gateway/cron/scheduler.py；jiuwenswarm/server/runtime/agent_adapter/team_helpers.py；jiuwenswarm/runtime/cron/models.py；jiuwenswarm/runtime/cron/cron_job_mutations.py；jiuwenswarm/gateway/cron/cron_json_convert.py；jiuwenswarm/gateway/cron/lifecycle_owners.py
  - jiuwenswarm/channels/web/frontend/src/components/CronPanel/ModeSelector.tsx；jiuwenswarm/channels/web/frontend/src/components/CronPanel/index.tsx；jiuwenswarm/server/runtime/session/project_store.py
  - jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronProjectDisplay.ts；jiuwenswarm/gateway/cron/cron_expr.py；jiuwenswarm/gateway/cron/dingtalk_routing.py；jiuwenswarm/gateway/cron/factory.py；jiuwenswarm/gateway/cron/models.py；jiuwenswarm/runtime/cron/__init__.py
  - jiuwenswarm/channels/web/frontend/src/components/CronPanel/ScheduleEditor.tsx；jiuwenswarm/channels/web/frontend/src/components/CronPanel/ConfirmDialog.tsx；jiuwenswarm/channels/web/frontend/src/components/CronPanel/DatePicker.tsx
  - jiuwenswarm/channels/web/frontend/src/components/CronPanel/SimpleSelect.tsx；jiuwenswarm/channels/web/frontend/src/components/CronPanel/TimePicker.tsx；jiuwenswarm/channels/web/frontend/src/components/CronPanel/scheduleConvert.ts
  - jiuwenswarm/server/control/store/project_queries.py；jiuwenswarm/common/cron_session.py；jiuwenswarm/runtime/cron/etcd_store.py；jiuwenswarm/runtime/cron/store_base.py；jiuwenswarm/gateway/cron/store.py；jiuwenswarm/gateway/cron/store_base.py
  - jiuwenswarm/channels/web/frontend/src/components/CronPanel/CronTaskDrawer.tsx；jiuwenswarm/channels/web/frontend/src/components/CronPanel/StatusBadge.tsx；jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronMode.ts；jiuwenswarm/common/cron_team_completion.py
  - jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronWakeOffset.ts；jiuwenswarm/gateway/channel_manager/web/app_web_handlers.py；jiuwenswarm/channels/web/frontend/src/components/CronPanel/cronWeekAlpha.ts；jiuwenswarm/runtime/cron/dingtalk_routing.py
  - jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/gateway/cron/proactive_cron_sync.py；jiuwenswarm/agents/swarm/providers/runtime_tools.py；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/cron.ts；jiuwenswarm/gateway/channel_manager/tui/tui_connect.py
  - jiuwenswarm/channels/web/frontend/src/stores/cronStore.ts；jiuwenswarm/channels/web/frontend/src/components/CronPanel/xiaoyiCronTarget.ts
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 定时任务把调度描述、任务内容和输出目的地连接到执行运行时。任务持久化、到期触发和结果交付是不同阶段，本地和远端存储后端具有不同可用性边界。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/runtime/cron/factory.py:L1–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L1-L84)；
  - [docs/zh/定时任务.md:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1.md#L1-L401)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `CronStoreSettings`；`load_cron_store_settings(config)`；`create_gateway_cron_store(config)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/runtime/cron/factory.py:L1–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L1-L84)；
  - [docs/zh/定时任务.md:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1.md#L1-L401)。

### 配置入口与生效条件

- 该源码入口的构造或调用参数包括 `config`；它们是调用参数，不自动等同于全仓持久配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/runtime/cron/factory.py:L1–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L1-L84)；
  - [docs/zh/定时任务.md:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1.md#L1-L401)。

### 设计取舍

- **设计推断**：调度、执行会话与输出频道分离，使定时任务可复用普通执行运行时；代价是持久化、到期触发和推送交付需要分别观察。任务记录存在不代表已触发，任务执行成功也不证明目标频道收到了结果。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/runtime/cron/factory.py:L1–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L1-L84)；
  - [docs/zh/定时任务.md:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1.md#L1-L401)。

### 数据流与关联功能

- 定时任务把调度描述、任务内容和输出目的地连接到执行运行时。任务持久化、到期触发和结果交付是不同阶段，本地和远端存储后端具有不同可用性边界。 联调时结合[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）、[[feature-team]]（多智能体团队协作）、[[feature-swarmflow]]（SwarmFlow 工作流与 HITL）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/runtime/cron/factory.py:L1–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L1-L84)；
  - [docs/zh/定时任务.md:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1.md#L1-L401)。

### 怎样验证

- 创建一个短周期任务，核对下次执行时间、关联会话与结果推送。覆盖暂停、更新、删除、服务重启和输出频道不可用；Team 或 SwarmFlow 任务另外检查协作状态与停止行为。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/runtime/cron/factory.py:L1–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/cron/factory.py#L1-L84)；
  - [docs/zh/定时任务.md:L1–L401](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AE%9A%E6%97%B6%E4%BB%BB%E5%8A%A1.md#L1-L401)。
