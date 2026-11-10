---
name: feature-depth-yuanrong-faas-invocation
description: YuanRong FaaS 调用实现深读：send_request_stream 的输入输出与错误项、agent_client.type=yuanrong 的必填项与默认值、未连接与非 2xx 处理、to_thread 读取器与队列、agent_client 扩展构造、阻塞 urllib 取舍、请求头单测
metadata:
  scope: 只收 send_request_stream、agent_client 配置与线程桥接的实现级证据和单测断言；功能概览归 feature-yuanrong-faas-invocation
---
# YuanRong FaaS 函数调用（非流式 + SSE 流式）：实现深读

## 现状

- [[feature-yuanrong-faas-invocation]]（功能概览） · [[extensions-plugins-overview]]（owner 入口）
- **send_request_stream 输入 E2AEnvelope、产出 AgentResponseChunk；error 项产出错误块，exception 项抛 RuntimeError** 输入是 E2AEnvelope；
  - 产出为 AgentResponseChunk，request_id/channel_id 优先取 chunk 自身字段、兜底 e2a_to_agent_request 的值。"error" 项产出 payload={"error": text or "invoke stream failed"} 且 is_complete=False 的块；"exception" 项直接 raise RuntimeError(f"invoke stream failed: {text}")。调用方需消费异步迭代器并在 RuntimeError 上做自身错误处理。
- 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L1880–L1908](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1880-L1908)
- **gateway.agent_client.type=yuanrong 时必填两项，其余有默认值** type 默认 "websocket"（非 yuanrong 返回 [] 不注册）；yuanrong 模式下 frontend_endpoint 与 function_version_urn 缺失抛 ValueError；concurrency 默认 1、invoke_timeout_s 默认 60.0、agent_timeout_s 默认 300.0、agent_namespace 默认 "default"。
- 来源：[jiuwenswarm/extensions/agent_client/extension.py:L31–L60](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agent_client/extension.py#L31-L60)
- **未连接时抛 RuntimeError("client not connected")；流式 HTTP 非 2xx 转为队列 error 项** _ensure_connected 在 self._connected 为假时抛 RuntimeError("client not connected")；
  - _do_invoke_stream 中 200<=status<300 不成立时读取响应体、记录日志并把 ("error", 含 http_status 与 body 的 JSON) 经 call_soon_threadsafe 放入输出队列后 return——return 只结束该线程函数，不表示进程退出。
- 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L969–L971](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L969-L971),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1936–L1943](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1936-L1943)
- **send_request_stream 经 to_thread 读取器与队列逐项产出 chunk（1848–1915）** send_request_stream 先 _ensure_connected，用 _build_invoke_payload(envelope, stream=True) 构造载荷，
  - 随后 asyncio.create_task(asyncio.to_thread(self._do_invoke_stream, ...)) 启动读取器并循环 await queue.get()："chunk" 项经 _normalize_invoke_chunk 解析后构造 AgentResponseChunk yield，"error" 项 yield 带 {"error": text} 的非完成 chunk，"exception" 项 raise RuntimeError，"done" 项 break 后补发一个 is_complete=True 的收尾 chunk；
  - finally 中 cancel reader_task 并等待其 CancelledError。
- 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L1848–L1915](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1848-L1915)
- **agent_client 扩展直接构造 YuanrongFrontendAgentClient 并传入配置参数（7–22, 49–58）** YuanrongAgentServerClientExtension 在构造时持有传入的 YuanrongFrontendAgentClient 并由 get_client 返回；
  - 工厂处以 frontend_endpoint、function_version_urn、agent_namespace 及取自 agent_client 配置的 concurrency（缺省 1）、invoke_timeout_s（缺省 60.0）、agent_timeout_s（缺省 300.0）直接实例化该客户端并包进扩展，形成扩展对该具体客户端类的编译期依赖。
- 来源：[jiuwenswarm/extensions/agent_client/extension.py:L7–L22](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agent_client/extension.py#L7-L22),
  - [jiuwenswarm/extensions/agent_client/extension.py:L49–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agent_client/extension.py#L49-L58)
- **阻塞式 urllib 读取移入工作线程，代价是结果须经队列与线程安全调度回传** 设计推断（非作者历史意图）：
- 收益（推断）：SSE 读取使用阻塞的 urllib.request.urlopen（超时取 self._invoke_timeout_s），通过 asyncio.to_thread 在工作线程执行，使事件循环不必直接阻塞在网络上。成本（推断）：结果必须以 (item_type, text) 字符串形式经 asyncio.Queue 中转，例如非 2xx 分支要把错误 JSON 序列化后经 loop.call_soon_threadsafe 投递回循环，增加了序列化与跨线程调度开销。
- 来源：[jiuwenswarm/extensions/yuanrong_frontend_client.py:L1862–L1876](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1862-L1876),
  - [jiuwenswarm/extensions/yuanrong_frontend_client.py:L1930–L1943](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/yuanrong_frontend_client.py#L1930-L1943)
- **单测 test_send_request_passes_user_id_in_session_context 以 mock urlopen 验证请求头（166–196）** 该 @pytest.mark.asyncio 测试 patch urllib.request.urlopen 返回 status=200 的 MagicMock，await client.send_request(envelope) 后断言 response.ok 为 True、捕获的 X-session-context JSON 等于 {"sessionCtx": "alice"}、
  - 且 TRACE_ID_HEADER 被铸造且不同于 request_id "req-1"。网络层被 mock，仅验证客户端侧 header 构造与响应处理路径；本回复未执行该测试，不宣称其通过。
- 来源：[tests/unit_tests/extensions/test_yuanrong_frontend_client.py:L166–L196](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/extensions/test_yuanrong_frontend_client.py#L166-L196)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-depth-yuanrong-faas-invocation.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-06
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1880-L1908；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agent_client/extension.py:L31-L60
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L969-L971；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1936-L1943
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1848-L1915；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agent_client/extension.py:L7-L22
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agent_client/extension.py:L49-L58；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1862-L1876
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/yuanrong_frontend_client.py:L1930-L1943；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/extensions/test_yuanrong_frontend_client.py:L166-L196
- 源页字段（feature）：yuanrong-faas-invocation
- 入口（entry_points）：jiuwenswarm/extensions/yuanrong_frontend_client.py
- 源页字段（source_globs）：jiuwenswarm/extensions/yuanrong_frontend_client.py；jiuwenswarm/extensions/clawee.py；jiuwenswarm/extensions/agent_client/extension.py
