---
name: gateway-im-pipeline-contracts-01
description: gateway-im-pipeline 源码接口与集成边界 01：gateway/im_pipeline 下 im_inbound（IMPlatformAdapter、IMConversationProcessor）、im_outbound（IMOutboundPipeline）、im_session_input 的声明
metadata:
  scope: 只收 gateway/im_pipeline 三个文件的静态声明；模块入口归 gateway-im-pipeline-overview
---
# gateway-im-pipeline 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/gateway/im_pipeline/im_inbound.py`**
- 源码对模块职责的说明：IM 输入管道，负责处理收到的 IM 消息，包括解析、验证、路由等.。
- `IMHistoryMessage` 定义类型边界。
- `IMPlatformAdapter` 继承 `Protocol`；方法入口：`get_principal_user_id`, `get_principal_display_name`, `resolve_user_display_name`, `get_bot_mention_tokens`, `load_recent_messages`, `build_relevance_metadata`。
- `InboundProcessResult` 定义类型边界。
- `IMConversationProcessor` 定义类型边界；方法入口：`__init__`, `process`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`from dataclasses import dataclass, field`。
- 模块级配置或常量名称：`SYSTEM_PROMPT_TEMPLATE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/im_pipeline/im_inbound.py#L1-L747)。
- **`jiuwenswarm/gateway/im_pipeline/im_outbound.py`**
- 源码对模块职责的说明：IMOutboundPipeline — 出站预处理管线：路由决策（群发 vs 私发）+ 追问前缀解析。。
- `IMOutboundPipeline` 定义类型边界；方法入口：`__init__`, `register_adapter`, `unregister_adapter`, `apply`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/im_pipeline/im_outbound.py#L1-L462)。
- **`jiuwenswarm/gateway/im_pipeline/im_session_input.py`**
- 源码对模块职责的说明：Shared IM handoff onto the public Session input entry.。
- 调用入口 `is_shared_im_channel(channel_id)`；声明返回 `bool`。
- 调用入口 `prepare_im_session_input(msg)`；声明返回 `bool`。
- 调用入口 `steer_busy_im_chat(msg)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.common.mode_matrix import is_team_mode`；`from jiuwenswarm.common.schema.message import Message`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/im_pipeline/im_session_input.py#L1-L162)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-im-pipeline/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
