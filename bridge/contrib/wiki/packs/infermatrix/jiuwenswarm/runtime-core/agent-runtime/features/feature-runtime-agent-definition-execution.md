---
name: feature-runtime-agent-definition-execution
description: 声明式 root Agent 定义执行（invoke_agent/stream_agent）功能知识页：公共入口与 RuntimeAgentDefinitionError、请求改写与 owner 绑定的数据流、会话绑定与 SESSION_CONFLICT、拒绝 allowlist 的取舍、定义字段 name/instructions/tools 等、单测覆盖
metadata:
  scope: 只收该功能的六块概览（入口、边界、行为、取舍、字段配置、测试覆盖）；逐符号实现证据归 feature-depth-runtime-agent-definition-execution
---
# 声明式 root Agent 定义执行（invoke_agent/stream_agent）

## 现状

- **公共入口与输入输出**
- `AgentRuntime.invoke_agent` 与 `stream_agent` 是声明式 root Agent 的两个公共入口：接收一个 `AgentRequest` 加上 `RuntimeAgentDefinition` 或普通 Mapping 形式的定义，分别返回 `list[RuntimeEvent]` 和异步迭代 `RuntimeEvent` 的流。两者都支持 `trigger_hook` 与 `on_control_event` 回调，`stream_agent` 额外提供 `on_agent_ready`。
  - 入口内部依次执行 start、会话归属校验、按请求参数里的 mode 做能力解析、定义校验、请求改写和 owner 绑定，然后把 `_agent_execution` 透传给既有的 `invoke`/`stream` 链路。定义或会话冲突通过 `RuntimeAgentDefinitionError`（`ValueError` 子类，`retryable=False`）抛出，携带稳定错误码与出错字段。
- Sources / 来源：[jiuwenswarm/runtime/service.py:L1258–L1308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1258-L1308),
  - [jiuwenswarm/runtime/agent_definition.py:L37–L64](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L37-L64)
- **职责边界与数据流**
- 模块分工明确：`agent_definition.py` 只做传输无关的声明式输入校验（模块文档声明它不依赖 Process CLI 协议、transport 或 Agent 实现），产出 `RuntimeAgentDefinition`/`RuntimeAgentExecution` 能力契约；`AgentRuntime` 负责把这个契约翻译进既有执行链。
  - 执行路径上，`_bind_agent_execution_request` 把校验后的定义改写进请求参数（`mode` 设为 execution.mode、`work_mode` 固定为 `"code"`、可选解析 `model_name`），`_claim_agent_execution_owner` 以 `(channel_id, session_id)` 为键把定义指纹钉在 Runtime 生命周期内；
  - 随后 `_prepare_chat_turn` 把 `agent_definition` 与指纹作为 kwargs 传入会话准备，最终仍走 `invoke`/`stream` 的 AgentManager 与 Agent Adapter。
- Sources / 来源：[jiuwenswarm/runtime/agent_definition.py:L3–L8](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L3-L8),
  - [jiuwenswarm/runtime/service.py:L1166–L1197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1166-L1197),
  - [jiuwenswarm/runtime/service.py:L1209–L1234](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1209-L1234),
  - [jiuwenswarm/runtime/service.py:L1050–L1073](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1050-L1073)
- **支持的执行行为与会话绑定**
- `invoke_agent`/`stream_agent` 在执行前先 `start()`、校验会话归属，再按请求 params 中的 mode 解析能力并 `validate_agent_definition`，随后把定义绑定为请求改写：`_bind_agent_execution_request` 要求请求是 chat.send 且 params 为 dict（否则 `INVALID_REQUEST`），否则覆盖 `mode` 为 execution.mode、`work_mode` 固定为 `"code"`，
  - 定义指定 model 时解析为 `model_name`（service.py:L1166–L1197）。模式层面，`RuntimeAgentExecution.__post_init__` 拒绝 `agent.work.normal`/`agent.work.plan`，抛 `UNSUPPORTED_MODE`（agent_definition.py:L276–L286）。会话绑定以 `(channel_id, session_id)` 为键：已存在绑定且指纹不同则抛 `SESSION_CONFLICT`，指纹相同则复用；
  - `_forget_agent_execution_owner` 可按 channel/session 移除绑定（service.py:L1209–L1256）。
- Sources / 来源：[jiuwenswarm/runtime/service.py:L1258–L1308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1258-L1308),
  - [jiuwenswarm/runtime/service.py:L1166–L1197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1166-L1197),
  - [jiuwenswarm/runtime/service.py:L1209–L1256](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1209-L1256),
  - [jiuwenswarm/runtime/agent_definition.py:L276–L286](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L276-L286)
- **显式拒绝 allowlist 与复用既有执行链**
- 两个有文档依据的取舍：(1) 显式工具 allowlist 被有意拒绝——`RuntimeAgentDefinition` 的 docstring 写明 "An explicit allowlist is intentionally rejected until the Runtime can enforce it after all rails and extensions have contributed their tools"（agent_definition.py:L161–L166），即在全部 rails/extensions 贡献工具之前无法可靠执行 allowlist，
  - 因此 `tools='*'` 表示使用 Runtime 配置的工具集。
  - (2) `RuntimeAgentExecution` 自述为 "a capability contract, not a second executor"：AgentRuntime 把它翻译为既有的 AgentManager/Agent Adapter 输入，避免第二套执行路径（agent_definition.py:L265–L271）。定义指纹是对 schema+canonical JSON 的 SHA-256，作为绑定一致性比较的稳定键（L233–L247）。
- Sources / 来源：[jiuwenswarm/runtime/agent_definition.py:L159–L166](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L159-L166),
  - [jiuwenswarm/runtime/agent_definition.py:L233–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L233-L247),
  - [jiuwenswarm/runtime/agent_definition.py:L265–L271](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L265-L271)
- **定义字段与请求改写配置**
- `RuntimeAgentDefinition.from_mapping` 接受严格字段集 name/instructions/description/model/tools/skills/max_iterations（缺 name 或 instructions 报 INVALID_DEFINITION）。tools 默认 `"*"`；显式工具 allowlist 被拒绝（TOOL_ALLOWLIST_UNSUPPORTED），注意序列条目会先经过重复/空/非字符串校验。
  - 执行时 `_bind_agent_execution_request` 把请求 params 的 mode 覆盖为 execution.mode、work_mode 固定为 `"code"`，定义带 model 时经 `resolve_model_capability` 写入 `model_name`。max_iterations 可为 None，非 None 时须为正整数。
- Sources / 来源：[jiuwenswarm/runtime/agent_definition.py:L21–L34](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L21-L34),
  - [jiuwenswarm/runtime/agent_definition.py:L103–L135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L103-L135),
  - [jiuwenswarm/runtime/service.py:L1166–L1197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1166-L1197),
  - [jiuwenswarm/runtime/agent_definition.py:L194–L203](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L194-L203)
- **现有单元测试对定义校验与模式能力的覆盖**
- `tests/unit_tests/runtime/test_agent_definition.py`（标记 `pytest.mark.unit`，测试未被本分析执行）中，`test_explicit_tool_allowlist_has_stable_unsupported_error` 断言显式工具 allowlist 抛出错误码为 `AGENT_DEFINITION_TOOL_ALLOWLIST_UNSUPPORTED`、字段 `tools`、`retryable=False`；
  - `test_work_modes_return_stable_unsupported_error` 与 `test_noncanonical_or_non_single_agent_modes_are_invalid` 分别对 `prepare_agent_execution` 断言 `AGENT_DEFINITION_MODE_UNSUPPORTED`（field=mode，不可重试）和 `AGENT_DEFINITION_MODE_INVALID`。
- Sources / 来源：[tests/unit_tests/runtime/test_agent_definition.py:L177–L183](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_agent_definition.py#L177-L183),
  - [tests/unit_tests/runtime/test_agent_definition.py:L247–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_agent_definition.py#L247-L253),
  - [tests/unit_tests/runtime/test_agent_definition.py:L269–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_agent_definition.py#L269-L274)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/feature-runtime-agent-definition-execution.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1258-L1308；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L37-L64
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L3-L8；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1166-L1197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1209-L1234；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1050-L1073
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1209-L1256；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L276-L286
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L159-L166；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L233-L247
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L265-L271；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L21-L34
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L103-L135；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L194-L203
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_agent_definition.py:L177-L183；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_agent_definition.py:L247-L253
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_agent_definition.py:L269-L274
- 源页字段（feature）：runtime-agent-definition-execution
- 入口（entry_points）：jiuwenswarm/runtime/service.py
- 源页字段（source_globs）：jiuwenswarm/runtime/service.py；jiuwenswarm/runtime/agent_definition.py
