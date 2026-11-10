---
name: gateway-message-handler-contracts-01
description: gateway-message-handler 源码接口与集成边界 01：gateway/message_handler 下 slash_command、evolution_approval、join_exit_handlers、message_handler.py（ChannelMode）与 prompts（review、security_review）的声明
metadata:
  scope: 只收 gateway/message_handler 各文件的静态声明；模块入口归 gateway-message-handler-overview
---
# gateway-message-handler 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/gateway/message_handler/__init__.py`**
- 源码对模块职责的说明：Message handler module.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.gateway.message_handler.message_handler import MessageHand`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/__init__.py#L1-L9)。
- **`jiuwenswarm/gateway/message_handler/command_parser/slash_command.py`**
- 源码对模块职责的说明：Gateway 受控通道 slash 指令：单一解析与注册表（无 IO）.。
- `GatewaySlashCommand` 继承 `str, Enum`。
- `ModeSubcommand` 继承 `str, Enum`。
- `SwitchSubcommand` 继承 `str, Enum`。
- `ParsedControlAction` 继承 `str, Enum`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from dataclasses import dataclass`；`from enum import Enum`；`import re`。
- 模块级配置或常量名称：`CONTROL_MESSAGE_TEXTS`, `FIRST_BATCH_REGISTRY`, `BUILTIN_COMMANDS_META`, `VALID_MODE_LINES`, `VALID_MODE_SUBCOMMANDS`, `VALID_SWITCH_LINES`, `VALID_SWITCH_SUBCOMMANDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/command_parser/slash_command.py#L1-L726)。
- **`jiuwenswarm/gateway/message_handler/evolution_approval.py`**
- 源码对模块职责的说明：Evolution approval state coordination for the gateway message handler.。
- `EvolutionApprovalChunkDecision` 定义类型边界。
- `DeferredEvolutionApproval` 定义类型边界。
- `EvolutionApprovalFinishResult` 定义类型边界。
- `EvolutionApprovalCoordinator` 定义类型边界；方法入口：`__init__`, `is_current_pending`, `pending_request_id`, `deferred_request_ids`, `mark_pending`, `mark_session_in_progress`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import secrets`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/evolution_approval.py#L1-L361)。
- **`jiuwenswarm/gateway/message_handler/join_exit_handlers.py`**
- 源码对模块职责的说明：团队成员 /join /exit 处理逻辑。。
- `JoinExitHandlers` 定义类型边界；方法入口：`__init__`, `is_allowed_when_joined`, `sender_has_joined`, `join_slash_handler`, `notify_godview_member_join`, `notify_godview_member_exit`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import logging`；`import secrets`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/join_exit_handlers.py#L1-L661)。
- **`jiuwenswarm/gateway/message_handler/message_handler.py`**
- 源码对模块职责的说明：MessageHandler - 消息处理抽象与双队列实现（入队经 AgentServerClient 发往 AgentServer）.。
- 调用入口 `apply_a2ui_text_fallback_to_gateway_payload(payload, channel_id)`；声明返回 `dict[str, Any]`。
- 调用入口 `normalize_legacy_health_check_relay_payload(payload)`；声明返回 `dict[str, Any]`。
- `ChannelMode` 继承 `str, Enum`；方法入口：`is_team_mode`。
- 调用入口 `channel_mode_from_str(mode_str)`；声明返回 `ChannelMode`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import asyncio`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/message_handler.py#L1-L5516)。
- **`jiuwenswarm/gateway/message_handler/prompts/__init__.py`**
- 调用入口 `response_language_line()`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.common.config import get_config`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/__init__.py#L1-L11)。
- **`jiuwenswarm/gateway/message_handler/prompts/review_prompt.py`**
- 源码对模块职责的说明：PR 审查 prompt（单一数据源）.。
- 调用入口 `build_review_prompt(pr_arg)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from jiuwenswarm.gateway.message_handler.prompts import response_language_l`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/review_prompt.py#L1-L39)。
- **`jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py`**
- `GitPreExecError` 继承 `Exception`。
- 调用入口 `build_security_review_prompt(extra_arg, cwd)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import subprocess`；`from jiuwenswarm.gateway.message_handler.prompts import response_language_l`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/message_handler/prompts/security_review_prompt.py#L1-L263)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-message-handler/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
