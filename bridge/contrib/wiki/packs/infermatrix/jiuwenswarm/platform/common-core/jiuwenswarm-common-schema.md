---
name: jiuwenswarm-common-schema
description: 公共 Schema：Message 与 ReqMethod/EventType/Mode 枚举、AgentRequest/AgentResponse/AgentResponseChunk 与 PermissionContext、chat.send 与 chat.swarmflow_reply 参数契约、HookEventBase
metadata:
  scope: 只收 common/schema 目录的说明、关键文件与相关文档；schema 各文件的逐项声明见 schema-contracts-01
---
# 公共 Schema：Agent 请求响应、统一消息与参数契约

## 现状

- 定义各层共用的数据契约：Agent 请求、响应和流式分块（含 PermissionContext），统一消息模型 Message 及 ReqMethod/EventType/Mode 枚举，还有 chat.send 与 chat.swarmflow_reply 的入站参数结构。此外内置一个与 openjiuwen EventBase 对齐的最小 HookEventBase，统一扩展事件的命名和作用域，同时避开 extensions 包的循环导入。
- **从这里读起**
- `jiuwenswarm/common/schema/message.py` — 统一消息模型 Message，以及请求方法 ReqMethod、事件类型 EventType、运行模式 Mode 的枚举
- `jiuwenswarm/common/schema/agent.py` — AgentRequest / AgentResponse / AgentResponseChunk，以及权限上下文 PermissionContext
- **关键文件**
- `jiuwenswarm/common/schema/message.py` — Message 与各枚举；EventType 用 _missing_ 处理未知值，Mode.from_raw/to_runtime_mode 负责模式转换
- `jiuwenswarm/common/schema/agent.py` — Agent 请求和响应模型；PermissionContext 提供 scene、owner_scope_key 和 to_dict/from_dict 序列化
- `jiuwenswarm/common/schema/chat_send.py` — chat.send 的参数契约 ChatSendParams（TypedDict，total=False）
- `jiuwenswarm/common/schema/swarmflow_reply.py` — chat.swarmflow_reply 的参数契约，即真人回复 swarmflow human_session 轮次时的入站参数
- `jiuwenswarm/common/schema/event_base.py` — HookEventBase 以及 build_event_name/parse_event_name，与 openjiuwen 0.1.9+ 的 EventBase 行为保持一致
- **相关文档**
- `docs/zh/E2A-protocol.md` — 改动 Message、ReqMethod、EventType 等消息与事件定义时，对照协议文档（文档和源码冲突时以源码为准）
- `docs/zh/AgentTeam人类成员联机协作.md` — 改动 swarmflow_reply 参数契约或真人成员回复链路时读
- `docs/zh/AgentTeam.md` — 想了解 AgentRequest/AgentResponse 在 Agent Team 运行时里的使用场景时读
- `docs/zh/A2A.md` — 改动的消息结构涉及 A2A 协议交互时对照
- **路由**
- `jiuwenswarm/common/schema/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/jiuwenswarm-common-schema.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
