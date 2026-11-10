---
name: feature-swarmflow
description: SwarmFlow 工作流与 HITL 功能概览：PhasePlan、WorkflowProgress、modes.team.jiuwen_team.enable_swarmflow、--budget、运行树与 token 预算观察与验证步骤
metadata:
  scope: 只收 SwarmFlow 的职责、接口入口、配置入口、设计取舍与验证方法（guide）；阶段计数、事件异常处理、WorkflowRunState 与开关生效边界等实现细节归 feature-depth-swarmflow
---
# SwarmFlow 工作流与 HITL 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/feature-swarmflow.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/team/handlers/workflow_state.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/TUI使用SwarmFlow指南.md
- 源页字段（feature）：swarmflow
- 入口（entry_points）：jiuwenswarm/agents/harness/team/handlers/workflow_state.py
- 源页字段（source_globs）：jiuwenswarm/agents/harness/team/handlers/workflow_state.py；jiuwenswarm/agents/harness/team/handlers/*；jiuwenswarm/server/runtime/agent_adapter/team_helpers.py；jiuwenswarm/channels/web/frontend/src/utils/swarmflowAdvisory.ts
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/AgentDetailModal.tsx；jiuwenswarm/agents/harness/team/team_manager.py；jiuwenswarm/channels/web/frontend/src/components/ChatPanel/InputArea.tsx；jiuwenswarm/channels/tui/frontend/src/ui/app-screen.ts
  - jiuwenswarm/common/config.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/server/agent_ws_server.py；jiuwenswarm/channels/web/frontend/src/components/teamArea/SwarmflowTreeView.tsx；jiuwenswarm/channels/tui/frontend/src/core/workflows.ts
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/workflowTypes.ts；jiuwenswarm/channels/tui/frontend/src/core/commands/builtins/swarmflows.ts；jiuwenswarm/channels/web/frontend/src/App.tsx
  - jiuwenswarm/channels/web/frontend/src/components/teamArea/SwarmflowGraphView.tsx；jiuwenswarm/channels/web/frontend/src/stores/sessionStore.ts；jiuwenswarm/channels/web/frontend/src/services/webClient.ts；jiuwenswarm/agents/harness/team/handlers/workflow_monitor_handler.py
  - jiuwenswarm/server/wire_truncate.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 工作流脚本描述多阶段编排，团队运行时提供执行与人工介入。运行树、节点状态和 token 预算共同用于观察执行，而不是只看最终一条回复。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/agents/harness/team/handlers/workflow_state.py:L1–L1664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/workflow_state.py#L1-L1664)；
  - [docs/zh/TUI使用SwarmFlow指南.md:L1–L548](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8SwarmFlow%E6%8C%87%E5%8D%97.md#L1-L548)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `PhasePlan`；`WorkflowProgress`；`WorkflowAgentActivity`；`WorkflowAgentState [to_dict]`；`WorkflowVerifyGroupState [to_dict]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/agents/harness/team/handlers/workflow_state.py:L1–L1664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/workflow_state.py#L1-L1664)；
  - [docs/zh/TUI使用SwarmFlow指南.md:L1–L548](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8SwarmFlow%E6%8C%87%E5%8D%97.md#L1-L548)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `modes.team.jiuwen_team.enable_swarmflow`。这些是示例字段，不单独证明源码默认值或全部优先级。 文档中的调用选项包括 `--budget`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/agents/harness/team/handlers/workflow_state.py:L1–L1664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/workflow_state.py#L1-L1664)；
  - [docs/zh/TUI使用SwarmFlow指南.md:L1–L548](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8SwarmFlow%E6%8C%87%E5%8D%97.md#L1-L548)。

### 设计取舍

- **设计推断**：工作流显式描述阶段和节点，便于监控嵌套执行与人工等待；代价是脚本接口、节点状态和会话生命周期都需要兼容运行时。开关配置与既有 session 的生效边界必须区分，关闭功能不能简单假定已挂起的工作流自动恢复。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/agents/harness/team/handlers/workflow_state.py:L1–L1664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/workflow_state.py#L1-L1664)；
  - [docs/zh/TUI使用SwarmFlow指南.md:L1–L548](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8SwarmFlow%E6%8C%87%E5%8D%97.md#L1-L548)。

### 数据流与关联功能

- 工作流脚本描述多阶段编排，团队运行时提供执行与人工介入。运行树、节点状态和 token 预算共同用于观察执行，而不是只看最终一条回复。 联调时结合[[feature-team]]（多智能体团队协作）、[[feature-human-team]]（人类团队成员与人工协作）、[[feature-swarm-skills]]（团队技能与能力复用）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/agents/harness/team/handlers/workflow_state.py:L1–L1664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/workflow_state.py#L1-L1664)；
  - [docs/zh/TUI使用SwarmFlow指南.md:L1–L548](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8SwarmFlow%E6%8C%87%E5%8D%97.md#L1-L548)。

### 怎样验证

- 使用含 human 节点的小工作流验证启动、等待、回复和完成，检查运行树与 token 预算展示。覆盖嵌套工作流、取消、停止后恢复和无效脚本；分别检查已有 session 与新 session 对开关变化的行为。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/agents/harness/team/handlers/workflow_state.py:L1–L1664](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/team/handlers/workflow_state.py#L1-L1664)；
  - [docs/zh/TUI使用SwarmFlow指南.md:L1–L548](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/TUI%E4%BD%BF%E7%94%A8SwarmFlow%E6%8C%87%E5%8D%97.md#L1-L548)。
