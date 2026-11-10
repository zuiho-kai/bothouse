---
name: feature-depth-context
description: 上下文压缩与卸载实现深读：卸载提交与重试单测、up_to 部分压缩与 compact_partial_prompts 常量契约、model_anomaly_detection_rail 默认关闭、会话作用域 compress_context 与 stats、compact_partial 的 no_turn/failed 返回、局部摘要过滤取舍
metadata:
  scope: 只收压缩与卸载的实现级证据；功能概览与配置示例键归 feature-context
---
# 上下文压缩与卸载：实现深读

## 现状

- [[feature-context]]（功能概览） · [[agent-server-runtime-overview]]（owner 入口）
- **卸载提交与重试的单元测试** tests/unit_tests/agentserver/test_agentserver_modes.py::test_external_memory_unload_commits_serialized_session_messages 验证卸载时先等 rail 同步任务完成再调用一次 on_session_end，消息按 dict/model_dump/to_dict 三种形态序列化提交并注销 rail；
  - test_external_memory_finalize_retries_after_commit_failure 验证首次提交抛错后标志保持 False、第二次调用重试成功。此处仅记录测试断言的行为，不代表当前已运行通过。
- 来源：[tests/unit_tests/agentserver/test_agentserver_modes.py:L48–L138](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_agentserver_modes.py#L48-L138),
  - [tests/unit_tests/agentserver/test_agentserver_modes.py:L141–L170](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/agentserver/test_agentserver_modes.py#L141-L170)
- **'up_to' 部分压缩：模型仅见 pivot 前缀，摘要在保留近期消息之前** 'up_to' 分支用 PARTIAL_COMPACT_UP_TO_PROMPT：模型只看到 pivot 之前的消息（新消息 "you do not see them here"），产出的摘要将置于保留的近期消息之前，并须按模板 1-9 节结构组织。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py:L108–L123](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py#L108-L123),
  - [jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py:L132–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py#L132-L153)
- **compact_partial_prompts 常量契约：纯文本、先 <analysis> 后 <summary>、禁工具** 模块为 /rewind summarize 提供 NO_TOOLS_PREAMBLE 与 PARTIAL_COMPACT_PROMPT 常量；模板要求模型不得调用任何工具、工具调用会被拒绝，须以纯文本先输出 <analysis> 块再输出 <summary> 块，摘要含 9 个规定小节（Primary Request and Intent 到 Optional Next Step）。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py:L2–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py#L2-L22),
  - [jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py:L32–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py#L32-L58)
- **execution_guard.model_anomaly_detection_rail 默认关闭；tool_loop_compact 缺省 None** config_base 缺省时用 get_config()，读取 execution_guard.model_anomaly_detection_rail；enabled 非 True（默认 False）即返回 None 并记 info 日志；开启后 max_retries 默认 2、repeat_window_chars 默认 1024、tool_loop_compact 未配置为 None。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8898–L8930](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L8898-L8930)
- **会话作用域 compress_context 依赖 react_agent.context_engine；stats 中仅 total_messages 取自 context.statistic()** 非会话作用域时经 _get_or_create_session_adapter 委派同名调用并在 finally 调 _evict_idle_session_adapters；
  - 会话作用域要求 _instance.react_agent 存在（否则 ValueError "Agent instance not available"），压缩经其 context_engine 的 get_context/compress_context（return_state=True、可选 processor_types）完成。
  - result 为 compressed 且重取 context 非空时才写 stats：total_messages 取 context.statistic()，total_tokens 与 raw_total_tokens 由 _count_full_context_tokens 计算。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18415–L18507](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L18415-L18507)
- **compact_partial 缺轮或空输入返回 no_turn；模型 Exception 与回退后仍空白的 summary 分别返回 failed** history 为空、无用户轮、turn_index 超过总轮数、待摘要区间或转换后 recap 消息为空时返回 status=no_turn；direction 非 from/up_to 时返回 failed 与 unknown direction 错误。try 仅包围模型 invoke 与 raw 读取：Exception 记日志后返回 Model call failed；
  - raw 经 getattr(result,"content",None) 或 str(result) 回退后仍为空白时，才返回 Model returned empty response。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L19103–L19197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L19103-L19197)
- **局部摘要过滤原文以缩减输入，代价是丢失被滤细节** 设计推断（非作者历史意图）：
- _build_messages_for_model 剥离用户消息中的 file-content 块，跳过工具记录与目标完成消息，仅保留满足角色与 event_type 条件的 user/assistant 文本；推断收益是 recap 输入更省 token，成本是该摘要请求不含这些被过滤的原文内容。
- 来源：[jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L19103–L19197](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L19103-L19197),
  - [jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L19200–L19227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/runtime/agent_adapter/interface_deep.py#L19200-L19227)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/feature-depth-context.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_agentserver_modes.py:L48-L138；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/agentserver/test_agentserver_modes.py:L141-L170
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py:L108-L123
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py:L132-L153
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18326-L18329；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18358-L18360
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py:L2-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py:L32-L58；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L8898-L8930
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L3095-L3115；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L19103-L19197
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L19200-L19227；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/server/runtime/agent_adapter/interface_deep.py:L18415-L18507
- 源页字段（feature）：context
- 入口（entry_points）：jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py
- 源页字段（source_globs）：jiuwenswarm/server/runtime/agent_adapter/compact_partial_prompts.py；jiuwenswarm/server/runtime/agent_adapter/interface_deep.py；jiuwenswarm/agents/harness/common/*
