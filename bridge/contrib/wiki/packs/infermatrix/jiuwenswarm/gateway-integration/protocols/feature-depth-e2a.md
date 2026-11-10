---
name: feature-depth-e2a
description: E2A 实现深读：build_acp_tool_descriptor 输入契约、delta 到 thought/message chunk 映射、merge_params_to_acp_prompt 补全优先级、tool_call_cache、wire chunk from_dict 失败、单测
metadata:
  scope: 只收 E2A 的实现深读；功能概览归 feature-e2a，A2A 与 ACP 的深读归 feature-depth-a2a、feature-depth-acp
---
# E2A 统一请求响应协议：实现深读

## 现状

- [[feature-e2a]]（功能概览） · [[protocols-overview]]（owner 入口）
- **build_acp_tool_descriptor 的输入契约** build_acp_tool_descriptor 的 tool_call_id 是唯一必填关键字参数；arguments 宽松接受 dict、JSON 字符串或其他类型，由 _normalize_arguments 归一为 dict（字符串解析失败或解析结果非 dict 时包装为 {"input": 原字符串}）。调用方只需给出原始工具名，别名与 kind 推断由函数内部完成。
- 来源：[jiuwenswarm/common/e2a/acp/acp_tool_updates.py:L119–L148](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/acp_tool_updates.py#L119-L148),
  - [jiuwenswarm/common/e2a/acp/acp_tool_updates.py:L301–L310](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/acp_tool_updates.py#L301-L310)
- **build_acp_session_update 将带非空文本的 delta 事件映射为 thought/message chunk 或 None** event_type 为 CHAT_DELTA/CHAT_REASONING 且 payload 的 content 非空时：is_reasoning_event 为真则把文本追加进 state.thought_text 并返回 agent_thought_chunk（messageId 由 state helper 生成），否则追加 assistant_text 并返回 agent_message_chunk；
  - 空文本、CHAT_SYMPHONY_STATUS 及未列出的 event_type 均返回 None。
- 来源：[jiuwenswarm/common/e2a/acp/session_updates.py:L101–L156](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/session_updates.py#L101-L156),
  - [jiuwenswarm/common/e2a/acp/acp_tool_updates.py:L105–L111](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/acp_tool_updates.py#L105-L111)
- **merge_params_to_acp_prompt：仅 method=="session/prompt" 且 params 无 prompt 键时的补全优先级与提前返回** method=="session/prompt" 且浅拷贝 p 无 prompt 键才补全：content_blocks 为非空 list 时直接作 prompt，否则 text/content/query 中第一个真值本身是非空 str 才生成单条 text block（真值非 str 不再后查）；
  - p 已含 prompt 键则 L477 提前返回，该路径不写 session_id、也不把 acp_meta 合入 _meta。
- 来源：[jiuwenswarm/common/e2a/models.py:L462–L492](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/models.py#L462-L492)
- **工具调用与工具结果更新共用 state 上惰性创建的同一 tool_call_cache** CHAT_TOOL_CALL 分支调 build_acp_tool_call_update，CHAT_TOOL_UPDATE/CHAT_TOOL_RESULT 分支调 build_acp_tool_result_update，二者都传 _ensure_tool_call_cache(state)；该 helper 在 state.tool_call_cache 不是 dict 时新建空 dict 挂回 state 并返回，同一 state 的后续事件经 getattr 取到同一 dict。
- 来源：[jiuwenswarm/common/e2a/acp/session_updates.py:L24–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/session_updates.py#L24-L29),
  - [jiuwenswarm/common/e2a/acp/session_updates.py:L135–L139](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/acp/session_updates.py#L135-L139)
- **wire chunk 的 from_dict 失败原样上抛且无兜底；无法识别形状抛含 key 列表的 ValueError** is_e2a_response_wire_dict 为真而 E2AResponse.from_dict 抛错时，记录 stage=from_dict 异常日志后 raise，此路径不走 legacy 兜底；非 E2A 形状时若 _deprecated_chunk_shape 为假则抛 ValueError，消息附带最多前 32 个顶层 key（deprecated 形状仅告警并按 raw dict 转换）。
- 来源：[jiuwenswarm/common/e2a/wire_codec.py:L174–L183](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/wire_codec.py#L174-L183),
  - [jiuwenswarm/common/e2a/wire_codec.py:L221–L229](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/wire_codec.py#L221-L229)
- **推断：legacy/deprecated 回退提高解码容错，代价是保留两条非主路径分支** 设计推断（非作者历史意图）：
- 推断：逆转换失败且 metadata 里 legacy 键为 dict 时能返回 chunk 而非上抛，是容错收益；代价是解码器须同时维持这条回退分支与 deprecated 形状的仅告警接受分支，非主转换路径增多。
- 来源：[jiuwenswarm/common/e2a/wire_codec.py:L204–L227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/wire_codec.py#L204-L227)
- **单测断言 wire 往返保留 execution_id 及 chunk 形状抛 ValueError** test_execution_binding_survives_agent_wire_and_web_payload 以四种 event_type 参数化，实际执行 e2a_response_from_agent_chunk→e2a_response_to_agent_chunk→WebChannel._build_event_payload，
  - 断言 payload['execution_id']=='execution-A' 且 payload['session_id']=='session-A'；test_wire_codec.py 将 is_complete=False 的 chunk wire 传入 parse_agent_server_wire_unary，以 pytest.raises(ValueError) 断言其抛错。
- 来源：[tests/unit_tests/e2a/test_gateway_normalize.py:L23–L41](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/e2a/test_gateway_normalize.py#L23-L41),
  - [tests/unit_tests/e2a/test_wire_codec.py:L203–L210](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/e2a/test_wire_codec.py#L203-L210)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/protocols/feature-depth-e2a.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/acp/acp_tool_updates.py:L119-L148；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/acp/acp_tool_updates.py:L301-L310
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/e2a/test_gateway_normalize.py:L23-L41；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/e2a/test_wire_codec.py:L203-L210
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/acp/session_updates.py:L101-L156；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/acp/acp_tool_updates.py:L105-L111
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/acp/session_updates.py:L24-L29；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/acp/session_updates.py:L135-L139
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/wire_codec.py:L174-L183；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/wire_codec.py:L221-L229
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/wire_codec.py:L204-L227；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/models.py:L462-L492
- 源页字段（feature）：e2a
- 入口（entry_points）：jiuwenswarm/common/e2a/models.py
- 源页字段（source_globs）：jiuwenswarm/common/e2a/models.py；jiuwenswarm/common/e2a/*.py
