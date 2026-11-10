---
name: knowledge-protocols
description: jiuwenswarm/common/e2a 组件知识：手工联调验证入口、职责边界、设计取舍、内部键前缀与 legacy 快照大小常量、chat.delta identity 白名单
metadata:
  scope: 只收 common/e2a 组件级知识；各协议功能概览归 feature-e2a、feature-a2a、feature-acp，深读归对应 feature-depth 页
---
# jiuwenswarm/common/e2a：E2A 统一请求/响应协议组件知识

## 现状

- **验证入口**
- 所提供的切片中没有针对 jiuwenswarm/common/e2a/ 的自动化测试文件，可查的验证入口是文档约定的手工联调命令：docs/zh/A2A.md §8 给出对 http://127.0.0.1:{A2A_SERVER_PORT:-19100}{A2A_SERVER_PATH:-/a2a} 的 curl 请求（非流式 method=SendMessage 与流式 SendStreamingMessage），
  - 前置条件为 AgentServer 与 Gateway 均启动且 A2A_SERVER_ENABLED=true——该链路会穿过 A2A→Message→E2A 的适配器。docs/zh/ACP插件使用.md 给出先启动主进程、再经 VS Code ACP Client 连接的端到端步骤。代码内另有规范化路径的运行时日志（[E2A][norm]、[E2A][fallback]、[E2A][enable_memory]）可用于联调观测；此处仅记录文档约定与日志钩子，不宣称测试已运行。
- Sources / 来源：[docs/zh/A2A.md:L134–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L134-L152),
  - [docs/zh/ACP插件使用.md:L60–L86](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/ACP%E6%8F%92%E4%BB%B6%E4%BD%BF%E7%94%A8.md#L60-L86),
  - [jiuwenswarm/common/e2a/gateway_normalize.py:L197–L213](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L197-L213)
- **职责与边界**
- E2A 是 Gateway 与 AgentServer 之间使用的统一请求/响应载体：通道 Message 经 message_to_e2a 规范化为 E2AEnvelope，AgentResponse/AgentResponseChunk 经 gateway_normalize 转为 E2AResponse；
  - ACP JSON-RPC 与 A2A SendMessage 经 adapters.py 的 envelope_from_acp_jsonrpc / envelope_from_a2a_send_message 转入 E2A，并用 E2AProvenance 记录来源协议、转换器与时间。协议本身不规定传输层，WebSocket 线路上的编码/解码与 legacy 兜底由 wire_codec.py 单独承担。
- Sources / 来源：[jiuwenswarm/common/e2a/gateway_normalize.py:L138–L213](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L138-L213),
  - [jiuwenswarm/common/e2a/adapters.py:L42–L124](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/adapters.py#L42-L124),
  - [docs/zh/E2A-protocol.md:L21–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/E2A-protocol.md#L21-L25),
  - [jiuwenswarm/common/e2a/wire_codec.py:L1–L3](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/wire_codec.py#L1-L3)
- **设计取舍**
- Inference / 设计推断（非作者历史意图）：
- 设计推断：chat.delta 的流式身份字段（rid、proactive_* 等 17 个键）通过一份共享元组 _CHAT_DELTA_PASSTHROUGH_KEYS 在双向转换的两个循环中白名单透传，保证 delta 与 final 共享同一关联键、前端不重复渲染；代价是新增业务字段必须加入该名单，否则会在 E2A 往返中丢失。
  - 另一取舍是规范化失败时不丢请求，而是降级为携带 legacy 快照的兜底信封以保住可追溯性，代价是系统需并行维护正常 E2A 路径与 legacy 分支——e2a_to_agent_request 检测到兜底标记会抛 RuntimeError 要求调用方先分流。以上为从所示代码与文档边界得出的推断，不代表作者自述意图。
- Sources / 来源：[jiuwenswarm/common/e2a/gateway_normalize.py:L38–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L38-L59),
  - [jiuwenswarm/common/e2a/gateway_normalize.py:L116–L135](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L116-L135),
  - [jiuwenswarm/common/e2a/agent_compat.py:L28–L37](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/agent_compat.py#L28-L37)
- **模块级常量约定：内部键前缀与 legacy 快照大小上限**
- 该层配置是模块常量而非配置文件：`E2A_INTERNAL_CONTEXT_KEY = "_jiuwenswarm"`（注释声明通道业务勿占用此前缀），`MAX_LEGACY_AGENT_REQUEST_JSON_BYTES = 512_000` 限制兜底 legacy 快照的 JSON 字节数——超限时仅把 `params` 替换为 `{"_e2a_fallback_error": "legacy payload too large"}`，替换后不再复查总大小。
  - `constants.py` 定义 `E2A_WIRE_INTERNAL_METADATA_KEYS`（含 `_jiuwenswarm_server_push`、`_e2a_wire_legacy_*` 等），注释约定这些键仅用于编解码/队列语义，不得随业务 channel metadata 下发给 `Message.metadata`。
- Sources / 来源：[jiuwenswarm/common/e2a/gateway_normalize.py:L61–L65](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L61-L65),
  - [jiuwenswarm/common/e2a/gateway_normalize.py:L93–L113](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L93-L113),
  - [jiuwenswarm/common/e2a/constants.py:L93–L116](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/constants.py#L93-L116)
- **chat.delta identity passthrough whitelist survives the E2A round trip**
- Streaming `chat.delta` frames are converted to `E2AResponse` bodies by copying a fixed whitelist of keys (`rid`, `execution_id`, `turn_request_id`, `cross_session`, `proactive_type`, etc.) alongside `delta_kind`/`delta`,
  - and the reverse conversion `e2a_response_to_agent_chunk` restores exactly the same key set, so round-identity fields (execution binding, cross-session and proactive markers) survive the Gateway↔AgentServer wire.
  - Unit tests in `tests/unit_tests/e2a/test_gateway_normalize.py` exercise this round trip against `WebChannel._build_event_payload` for execution, cross-session, phase-order and proactive fields.
- Sources / 来源：[jiuwenswarm/common/e2a/gateway_normalize.py:L41–L59](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L41-L59),
  - [jiuwenswarm/common/e2a/gateway_normalize.py:L487–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L487-L503),
  - [jiuwenswarm/common/e2a/gateway_normalize.py:L559–L572](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/e2a/gateway_normalize.py#L559-L572),
  - [tests/unit_tests/e2a/test_gateway_normalize.py:L23–L46](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/e2a/test_gateway_normalize.py#L23-L46)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/protocols/knowledge-protocols.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2A.md:L134-L152；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/ACP插件使用.md:L60-L86
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L197-L213；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L138-L213
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/adapters.py:L42-L124；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/E2A-protocol.md:L21-L25
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/wire_codec.py:L1-L3；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L38-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L116-L135；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/agent_compat.py:L28-L37
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L61-L65；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L93-L113
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/constants.py:L93-L116；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L41-L59
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L487-L503；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/e2a/gateway_normalize.py:L559-L572
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/e2a/test_gateway_normalize.py:L23-L46
