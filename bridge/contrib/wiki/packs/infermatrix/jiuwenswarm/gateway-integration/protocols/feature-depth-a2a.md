---
name: feature-depth-a2a
description: A2A 接入与 AgentCard 实现深读：enabled 开关与 AgentCard 字段来源、推理内容不进 artifact、A2AChannel.start 幂等、依赖缺失 RuntimeError、execute 的两条 FAILED 路径
metadata:
  scope: 只收 A2A 的实现深读；功能概览归 feature-a2a，E2A 与 ACP 的深读归 feature-depth-e2a、feature-depth-acp
---
# A2A 接入与 AgentCard：实现深读

## 现状

- [[feature-a2a]]（功能概览） · [[protocols-overview]]（owner 入口）
- **enabled 开关与 AgentCard 字段来源** A2AChannel.start 在 config.enabled 为假时记日志 "[A2AChannel] disabled by config" 并不启动服务（默认关闭，文档 §3：A2A_SERVER_ENABLED 未设则关闭，端口默认 19100、路径 /a2a）。
  - AgentCard 的 name/description/version 取自 config.app_name/app_description/app_version，supported_interfaces[0].url 由 config.host:port + rpc_path 拼出，capabilities 固定 streaming=True、push_notifications=False。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L284–L314](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L284-L314),
  - [docs/zh/A2A.md:L51–L58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L51-L58)
- **推理内容不进 artifact，仅作状态事件** 设计推断（非作者历史意图）：
- 推理消息永不写入 response artifact：config.expose_reasoning 为真时以 working 状态的 TaskStatusUpdateEvent 流式输出，part 由 message_to_a2a_parts(fallback_to_text=False) 生成；关闭时直接丢弃。
  - 推断：好处是调用方可借助 metadata 键 jiuwen_thought（对齐 Google ADK 的 adk_thought 惯例）结构化区分思考与正文，代价是纯 artifact 消费方看不到推理、且终态 reasoning 分支必须显式清空 response_parts 防泄漏。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L151–L188](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L151-L188),
  - [docs/zh/A2A.md:L122–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L122-L125)
- **文档给出的本地验证命令** docs/zh/A2A.md §8 给出针对 http://127.0.0.1:{A2A_SERVER_PORT:-19100}{A2A_SERVER_PATH:-/a2a} 的 curl 验证：非流式 method=SendMessage 与流式 method=SendStreamingMessage 的 JSON-RPC 请求，前置条件是 AgentServer、Gateway 均已启动且 A2A_SERVER_ENABLED=true。所提供的切片中没有该功能的自动化测试入口，此处仅记录文档约定的手工验证方式，不宣称测试已运行或通过。
- 来源：[docs/zh/A2A.md:L134–L152](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L134-L152)
- **`A2AChannel.start()` 幂等且受 `config.enabled` 门控；对外暴露 JSON-RPC 与 Agent Card 端点** `A2AChannel.start()` 幂等：`self._running` 已置位或 `config.enabled` 为假直接返回；
  - 成功时以 `config.app_name/app_description/app_version` 构造 `AgentCard`（`AgentCapabilities(streaming=True, push_notifications=False)`、单个 `chat` skill）并按 `card_path`/`rpc_path` 注册路由。
  - 文档：JSON-RPC 端点为 `http://{A2A_SERVER_HOST}:{A2A_SERVER_PORT}{A2A_SERVER_PATH}`，Agent Card 默认 `/.well-known/agent-card.json`。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L284–L359](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L284-L359),
  - [docs/zh/A2A.md:L68–L84](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L68-L84)
- **a2a-sdk 与 fastapi 缺失时抛带安装指引的 RuntimeError；uvicorn 导入不在该守卫内** start() 把 a2a.server/a2a.types 与 fastapi 的导入包在 try 内，ImportError 经 _raise_missing_a2a_sdk 转为附 `pip install -e ".[a2a]"` / `uv sync --extra a2a` 指引的 RuntimeError；紧随其后的 `import uvicorn` 在该 try 之外，缺失时抛出的是原始 ImportError 而非该指引错误。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L29–L33](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L29-L33),
  - [jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L291–L299](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L291-L299)
- **A2A execute：空 query 拒绝返回；循环遇终态消息或异常时结束并本地清理** execute 在 try 前解析 task 与 query；query 为空时入队任务、发 TASK_STATE_FAILED("empty query")、关闭事件队列并返回。
  - 非空 query 在 try 中入队任务并发 WORKING，经 dispatch_a2a_request 取得 pending 后循环读 pending.queue：非终态 reasoning 仅在 config.expose_reasoning 开启且转换出非空 thought_parts 时以 WORKING 状态消息发出；artifact parts 排除 reasoning 与完成哨兵文本；读到终态消息时按 CHAT_ERROR/CHAT_INTERRUPT_RESULT/其余映射 FAILED/CANCELED/COMPLETED 并退出循环。
  - try 内普通 Exception 记日志并发 FAILED；finally 清除 pending request 并关闭队列。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L106–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L106-L125),
  - [jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L127–L147](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L127-L147),
  - [jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L154–L177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L154-L177),
  - [jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L181–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L181-L247)
- **A2A execute：空 query 与 try 内普通 Exception 是两条独立 FAILED 路径，BaseException 型取消不经此 except** query 为空时入队 FAILED("empty query") 状态、close 队列后局部 return。try 内异常仅被 except Exception 捕获：logger.exception 记录并尝试入队 FAILED 状态；finally 调 clear_pending_request 与 event_queue.close，未对二者自身失败提供兜底。
  - 终态 CHAT_ERROR 消息则在正常循环分支映射为 FAILED，属另一路径。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L112–L125](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L112-L125),
  - [jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L221–L227](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L221-L227),
  - [jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L236–L247](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L236-L247)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/protocols/feature-depth-a2a.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L284-L314；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2A.md:L51-L58
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L151-L188；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2A.md:L122-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2A.md:L134-L152；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L284-L359
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2A.md:L68-L84；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L29-L33
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L291-L299；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L111-L125
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L236-L247；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L405-L408
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L112-L125；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L221-L227
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L106-L125；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L127-L147
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L154-L177；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L181-L247
- 源页字段（feature）：a2a
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py；jiuwenswarm/gateway/channel_manager/protocol/a2a/*.py
