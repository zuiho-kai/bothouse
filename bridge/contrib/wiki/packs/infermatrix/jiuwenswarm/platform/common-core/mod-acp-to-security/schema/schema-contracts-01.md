---
name: schema-contracts-01
description: schema 源码接口与集成边界 01：common/schema/__init__.py、common/schema/agent.py、common/schema/chat_send.py、common/schema/event_base.py、common/schema/message.py、common/schema/swarmflow_reply.py 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收上述文件的逐文件静态声明记录；入口说明与导航归 schema-overview
---
# schema 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/common/schema/__init__.py`**
- 源码对模块职责的说明：数据模型.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.common.schema.agent import AgentRequest, AgentResponse, Ag`；`from jiuwenswarm.common.schema.message import Message`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/schema/__init__.py#L1-L13)。
- **`jiuwenswarm/common/schema/agent.py`**
- 源码对模块职责的说明：Agent 请求与响应模型.。
- `PermissionContext` 定义类型边界；方法入口：`scene`, `owner_scope_key`, `to_dict`, `from_dict`。
- `AgentRequest` 定义类型边界。
- `AgentResponse` 定义类型边界。
- `AgentResponseChunk` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass, field`；`from typing import Any`；`from jiuwenswarm.common.schema.message import ReqMethod`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/schema/agent.py#L1-L122)。
- **`jiuwenswarm/common/schema/chat_send.py`**
- 源码对模块职责的说明：chat.send 参数契约。。
- `ChatSendParams` 继承 `TypedDict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from typing import TypedDict, NotRequired`。
- 模块级配置或常量名称：`PLAN_ENTRY_SOURCE_SLASH_COMMAND`, `PLAN_ENTRY_SOURCE_PLAN_TOGGLE`, `PLAN_ENTRY_SOURCES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/schema/chat_send.py#L1-L203)。
- **`jiuwenswarm/common/schema/event_base.py`**
- 源码对模块职责的说明：与 openjiuwen 0.1.9+ ''openjiuwen.core.runner.callback.events'' 中 EventBase 对齐的最小 HookEventBase。。
- 调用入口 `build_event_name(scope, event_name)`；声明返回 `str`。
- 调用入口 `parse_event_name(scoped_event)`；声明返回 `tuple[str, str]`。
- `HookEventBase` 定义类型边界；方法入口：`get_event`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 模块级配置或常量名称：`DEFAULT_SCOPE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/schema/event_base.py#L1-L41)。
- **`jiuwenswarm/common/schema/message.py`**
- 源码对模块职责的说明：统一消息模型.。
- `ReqMethod` 继承 `Enum`。
- `EventType` 继承 `Enum`。
- `Mode` 继承 `Enum`；方法入口：`from_raw`, `to_runtime_mode`。
- `Message` 定义类型边界。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`from dataclasses import dataclass`；`from enum import Enum`；`from typing import Any, Literal`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/schema/message.py#L1-L628)。
- **`jiuwenswarm/common/schema/swarmflow_reply.py`**
- 源码对模块职责的说明：chat.swarmflow_reply 参数契约。。
- `SwarmflowReplyParams` 继承 `TypedDict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from typing import TypedDict`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/schema/swarmflow_reply.py#L1-L31)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/schema/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
