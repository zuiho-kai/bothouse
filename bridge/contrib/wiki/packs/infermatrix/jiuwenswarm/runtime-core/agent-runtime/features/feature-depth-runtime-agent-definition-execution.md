---
name: feature-depth-runtime-agent-definition-execution
description: 声明式 root Agent 定义执行实现深读：RuntimeAgentExecution 冻结数据类与 fingerprint/to_dict、tools 默认 '*'、能力契约不自行执行、WORK_NORMAL/WORK_PLAN 触发 UNSUPPORTED_MODE 与 INVALID_MODE、拒绝 allowlist 的取舍、单测断言、stream_agent 入口链
metadata:
  scope: 收 agent_definition.py 与 service.py stream_agent 的实现级证据，来源另含 test_agent_definition.py；功能概览与配置归 feature-runtime-agent-definition-execution
---
# 声明式 root Agent 定义执行（invoke_agent/stream_agent）：实现深读

## 现状

- [[feature-runtime-agent-definition-execution]]（功能概览） · [[agent-runtime-overview]]（owner 入口）
- **RuntimeAgentExecution 冻结 kw-only 数据类：fingerprint 代理 definition，to_dict 输出 JSON 兼容描述** 公开 fingerprint 属性直接返回 definition.fingerprint；to_dict 返回 {agent, agent_fingerprint, mode}，其中 mode 经 _runtime_agent_mode 再次取 value。
  - prepare_agent_execution 接受 definition 实例或 Mapping 加仅关键字 mode，返回不可变 RuntimeAgentExecution。
- 来源：[jiuwenswarm/runtime/agent_definition.py:L288–L301](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L288-L301),
  - [jiuwenswarm/runtime/agent_definition.py:L304–L316](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L304-L316),
  - [tests/unit_tests/runtime/test_agent_definition.py:L41–L50](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_agent_definition.py#L41-L50)
- **tools 默认 '*' 表示使用 Runtime 已配置的工具集** RuntimeAgentDefinition 为 frozen/slots/kw_only 数据类，tools 默认值为 "*"，skills 默认空元组，max_iterations 默认 None；docstring 说明 '*' 即复用 Runtime 配置的工具集。传入 ["*"] 列表也会归一化为 "*"。
- 来源：[jiuwenswarm/runtime/agent_definition.py:L159–L174](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L159-L174),
  - [jiuwenswarm/runtime/agent_definition.py:L117–L122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L117-L122)
- **agent_definition 契约模块声明为能力契约，由 AgentRuntime 翻译，自身不执行** RuntimeAgentExecution 文档字符串说明它是 capability contract，AgentRuntime 将其翻译为既有 AgentManager 与 Agent Adapter 输入，而非第二个执行器；模块尾 __all__ 仅导出六个契约符号。
- 来源：[jiuwenswarm/runtime/agent_definition.py:L265–L274](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L265-L274),
  - [jiuwenswarm/runtime/agent_definition.py:L319–L326](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L319-L326)
- **WORK_NORMAL/WORK_PLAN mode 触发 AGENT_DEFINITION_MODE_UNSUPPORTED（UNSUPPORTED_MODE，field=mode），非规范 mode 触发 INVALID_MODE** __post_init__ 中 mode 解析失败抛 code=INVALID_MODE、field="mode" 的错误（"unsupported single-Agent mode"）；
  - 命中 WORK_NORMAL/WORK_PLAN 抛 code=UNSUPPORTED_MODE、field="mode"（"custom Agent definitions are not supported in work mode"）。测试断言对应 code 且 retryable is False。
- 来源：[jiuwenswarm/runtime/agent_definition.py:L276–L286](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L276-L286),
  - [jiuwenswarm/runtime/agent_definition.py:L252–L262](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L252-L262),
  - [tests/unit_tests/runtime/test_agent_definition.py:L244–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_agent_definition.py#L244-L253)
- **拒绝显式工具白名单：换取契约稳定，代价是暂时无法按 Agent 限权** 设计推断（非作者历史意图）：
- 实现注释写明拒绝 allowlist 是有意的，直到 Runtime 能在所有 rails 和扩展贡献完工具之后再 enforcing。推断（inference）：收益是避免承诺无法执行的权限承诺，代价是定义方当前只能用全量工具集 '*'。
- 来源：[jiuwenswarm/runtime/agent_definition.py:L161–L166](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/agent_definition.py#L161-L166)
- **单元测试直接调用 prepare_agent_execution 断言 mode 错误码与先校验定义再校验 mode 能力** test_work_modes_return_stable_unsupported_error 对两个 WORK mode 断言 AGENT_DEFINITION_MODE_UNSUPPORTED、field=mode、retryable False；
  - test_prepare_accepts_mapping_and_validates_before_mode_capability 用非法 name 映射加 WORK_NORMAL 断言先得到 field=name 的 AGENT_DEFINITION_INVALID。这些是运行时断言，但仅覆盖契约校验层，未执行真实 Agent 执行。
- 来源：[tests/unit_tests/runtime/test_agent_definition.py:L244–L253](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_agent_definition.py#L244-L253),
  - [tests/unit_tests/runtime/test_agent_definition.py:L277–L285](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/runtime/test_agent_definition.py#L277-L285)
- **stream_agent 入口：校验并改写定义后委托既有 stream 链** stream_agent 先 await self.start() 并做会话归属校验；
  - 当 request.params 是 dict 时取其中的 mode 经 resolve_mode_capability 解析，再 validate_agent_definition 得到 execution，随后 _bind_agent_execution_request 改写请求并 await _claim_agent_execution_owner 绑定 owner，最后在 aclosing 中把 bound_request 连同 _agent_execution=execution 透传给 self.stream，逐个 yield 事件。
- 来源：[jiuwenswarm/runtime/service.py:L1281–L1308](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L1281-L1308)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-runtime/feature-depth-runtime-agent-definition-execution.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L159-L174；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L117-L122
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L161-L166；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L288-L301
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L304-L316；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_agent_definition.py:L41-L50
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L265-L274；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L319-L326
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L276-L286；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/agent_definition.py:L252-L262
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_agent_definition.py:L244-L253；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/runtime/test_agent_definition.py:L277-L285
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py:L1281-L1308
- 源页字段（feature）：runtime-agent-definition-execution
- 入口（entry_points）：jiuwenswarm/runtime/service.py
- 源页字段（source_globs）：jiuwenswarm/runtime/service.py；jiuwenswarm/runtime/agent_definition.py
