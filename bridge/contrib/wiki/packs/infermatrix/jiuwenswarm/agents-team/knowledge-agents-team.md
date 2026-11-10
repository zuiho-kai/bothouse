---
name: knowledge-agents-team
description: Code harness 的静态提示词分层、计划审批意图分类（approve/revise）、agent_observability 启用条件与计划中断 rail 的接口、配置与测试入口
metadata:
  scope: 只收 code_prompt_builder、plan_approval、agent_observability 与 code_plan_approval_interrupt_rail 的接口与边界；逐文件声明清单归 agents-team-contracts-01
---
# Code harness：静态提示词、计划审批与观测开关

## 现状

### 静态提示词与请求时状态分层

- `build_code_system_prompt()` 以 language=en 创建 SystemPromptBuilder，逐个添加 `_CODE_SECTION_GENERATORS` 的分节并 build。当前列表有 8 个生成器，而文件顶部文档仍写 7 个；不能把顶部计数当作当前实现。函数文档把静态提示词放在 Agent 创建阶段，把时间、运行态和记忆的动态注入留给每次请求的 Rails。
- 来源：[jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py:L3–L10](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py#L3-L10),
  - [jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py:L481–L507](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py#L481-L507)

### 审批意图分类的输入与默认结果

- `classify_plan_user_intent(user_message)` 接收字符串并先 strip，返回 approve 或 revise；空字符串和所有未识别情况都返回 revise。拒绝前缀与 revision intent 在 implementation intent 和纯批准判断之前处理，`is_user_approving()` 只比较最终结果是否为 approve。
- 来源：[jiuwenswarm/agents/harness/code/prompt/plan_approval.py:L261–L300](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/prompt/plan_approval.py#L261-L300)

### 观测启用不是单一布尔开关

- `agent_observability.enabled` 默认 False，但同步函数还会考虑 trajectory store、skill/symphony/TTSE evolution、当前 force 以及 `_force_ever_enabled`。传入 force 时会记录粘性标志，后续同步继续把它计入启用条件。traces_dir 缺省为用户工作区的 `.trace`，构造观测配置时 service_name 为 `jiuwenswarm-agent`。
- 来源：[jiuwenswarm/agents/harness/agent_observability.py:L101–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/agent_observability.py#L101-L139)

### 独立配置状态与共享 Provider 的边界

- 模块注释说明单 Agent 观测保留独立文件、状态和配置段，以免直接影响既有 team 场景；同一注释将 Provider 共享协调归给 SDK；平台同步代码调用 acquire_observability。强制观测的粘性标志用于避免交替请求反复初始化和关闭 Provider，状态操作由可重入 RLock 串行化。这里描述已写明的边界与动机，不把 SDK 内部机制当成本模块实现。
- 来源：[jiuwenswarm/agents/harness/agent_observability.py:L3–L23](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/agent_observability.py#L3-L23),
  - [jiuwenswarm/agents/harness/agent_observability.py:L51–L70](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/agent_observability.py#L51-L70),
  - [jiuwenswarm/agents/harness/agent_observability.py:L97–L98](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/agent_observability.py#L97-L98),
  - [jiuwenswarm/agents/harness/agent_observability.py:L113–L121](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/agent_observability.py#L113-L121),
  - [jiuwenswarm/agents/harness/agent_observability.py:L132–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/agent_observability.py#L132-L139)

### 计划预览与 Web/TUI 审批关系

- 计划中断 rail 首次在 user_input 为 None 且存在 tool_call 时读取计划，构造带计划预览的 InterruptRequest，auto_confirm_key 为 exit_plan_mode。其 Web 分支另识别 plan_skip 与 plan_execute 标记；代码注释明确普通 TUI reject/approve 不携带这些 Web 标记，因此两种交互不能按同一恢复分支理解。
- 来源：[jiuwenswarm/agents/harness/code/rails/code_plan_approval_interrupt_rail.py:L200–L244](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/rails/code_plan_approval_interrupt_rail.py#L200-L244)

### 审批的测试入口

- 意图解析的测试入口是 `tests/unit_tests/agentserver/test_plan_approval.py`；计划中断的测试入口是 `tests/unit_tests/agentserver/test_plan_approval_interrupt_rail.py`。前者列有实现、修改与混合意图案例，后者列有 Web 跳过、TUI 拒绝及执行批准的分支案例；运行这两份测试可核对审批分类和恢复行为。
- 来源：[tests/unit_tests/agentserver/test_plan_approval.py:L20–L42](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_plan_approval.py#L20-L42),
  - [tests/unit_tests/agentserver/test_plan_approval_interrupt_rail.py:L31–L129](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_plan_approval_interrupt_rail.py#L31-L129)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/knowledge-agents-team.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py:L3-L10；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/prompt/code_prompt_builder.py:L481-L507
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/prompt/plan_approval.py:L261-L300；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/agent_observability.py:L101-L139
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/agent_observability.py:L3-L23；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/agent_observability.py:L51-L70
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/agent_observability.py:L97-L98；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/agent_observability.py:L113-L121
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/agent_observability.py:L132-L139；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/agents/harness/code/rails/code_plan_approval_interrupt_rail.py:L200-L244
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_plan_approval.py:L20-L42；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_plan_approval_interrupt_rail.py:L31-L129
