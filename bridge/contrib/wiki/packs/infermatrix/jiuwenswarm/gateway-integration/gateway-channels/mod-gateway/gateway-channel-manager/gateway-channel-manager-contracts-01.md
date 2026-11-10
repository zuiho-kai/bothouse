---
name: gateway-channel-manager-contracts-01
description: gateway-channel-manager 源码接口与集成边界 01：channel_manager 的 base（BaseChannel、RobotMessageRouter）、channel_manager.py，及 im_platforms 下 dingtalk、飞书、企业微信、Slack 与小艺 formatter 的声明
metadata:
  scope: 只收 channel_manager 前半部分文件的静态声明；小艺 media 起的文件归 gateway-channel-manager-contracts-02
---
# gateway-channel-manager 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/gateway/channel_manager/__init__.py`**
- 源码对模块职责的说明：Channel 模块 - 客户端连接抽象.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.gateway.channel_manager.base import BaseChannel, ChannelMe`；`from jiuwenswarm.gateway.channel_manager.channel_manager import ChannelMana`；`from jiuwenswarm.gateway.channel_manager.web.web_connect import WebChannel`；
  - `from jiuwenswarm.gateway.channel_manager.im_platforms.xiaoyi.xiaoyi_connect`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/__init__.py#L1-L45)。
- **`jiuwenswarm/gateway/channel_manager/base.py`**
- `ChannelType` 继承 `str, Enum`。
- `ChannelMetadata` 定义类型边界。
- `RobotMessageRouter` 定义类型边界；方法入口：`__init__`, `route_user_message`, `wait_for_user_message`, `queue_robot_message`, `wait_for_robot_message`, `register_channel_subscription`。
- `BaseChannel` 继承 `ABC`；方法入口：`__init__`, `start`, `stop`, `send`, `is_allowed`, `is_running`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import logging`；`import asyncio`；`import inspect`；`import time`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/base.py#L1-L284)。
- **`jiuwenswarm/gateway/channel_manager/channel_manager.py`**
- 源码对模块职责的说明：ChannelManager - Channel 生命周期管理抽象与实现.。
- `ChannelEvent` 定义类型边界。
- `ChannelManager` 继承 `ABC`；方法入口：`__init__`, `mark_channel_restart_pending`, `pop_channel_restart_pending`, `register_channel`, `register_channel_with_inbound`, `register_external_channel`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import dataclasses`；`import logging`；`import asyncio`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/channel_manager.py#L1-L705)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/dingtalk/dingtalk_file_service.py`**
- 源码对模块职责的说明：DingTalk File Service。
- 调用入口 `detect_file_extension(content)`；声明返回 `str`。
- 调用入口 `get_mime_type(extension)`；声明返回 `str`。
- `DingTalkFileService` 定义类型边界；方法入口：`__init__`, `set_persist_hook`, `download_image`, `download_file`, `download_audio`, `download_video`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import os`；`import re`。
- 模块级配置或常量名称：`FILE_SIGNATURES`, `MIME_TYPES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/dingtalk/dingtalk_file_service.py#L1-L511)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/errors.py`**
- 源码对模块职责的说明：IM 平台附件处理公共异常。。
- `AttachmentPersistError` 继承 `RuntimeError`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/errors.py#L1-L15)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/feishu/feishu_file_service.py`**
- 源码对模块职责的说明：飞书文件服务，负责文件的下载与上传。。
- 调用入口 `get_feishu_file_type(file_path)`；声明返回 `str`。
- 调用入口 `is_image_file(file_path)`；声明返回 `bool`。
- 调用入口 `is_audio_file(file_path)`；声明返回 `bool`。
- 调用入口 `is_video_file(file_path)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import asyncio`；`import mimetypes`；`import os`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/feishu/feishu_file_service.py#L1-L769)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/feishu/feishu_im_adapter.py`**
- 源码对模块职责的说明：飞书平台的 IMPlatformAdapter 实现，处理飞书特定的用户信息获取、历史消息加载和元数据构建.。
- `FeishuIMPlatformAdapter` 定义类型边界；方法入口：`__init__`, `set_api_client`, `get_principal_user_id`, `get_user_name_by_open_id`, `resolve_user_display_name`, `get_principal_display_name`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any`；`from jiuwenswarm.gateway.channel_manager.im_platforms.platform_adapter.mess`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/feishu/feishu_im_adapter.py#L1-L232)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/feishu/feishu_streaming_card.py`**
- 源码对模块职责的说明：CardKit primitives for one Feishu streaming response card.。
- `CardKitError` 继承 `RuntimeError`。
- `FeishuCardKitClient` 定义类型边界；方法入口：`__init__`, `create_card`, `update_content`, `close_card`。
- `FeishuStreamingSession` 定义类型边界；方法入口：`__init__`, `rendered_text`, `is_active`, `start`, `replace`, `finalize`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import asyncio`；`import json`；`import time`；`import uuid`。
- 模块级配置或常量名称：`FEISHU_API_BASE`, `TOKEN_REFRESH_MARGIN_SECONDS`, `AUTH_ERROR_CODES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/feishu/feishu_streaming_card.py#L1-L263)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/platform_adapter/message.py`**
- `MessageStore` 定义类型边界；方法入口：`__init__`, `set_api_client`, `set_platform_adapter`, `get_user_name_by_open_id`, `load_memory`, `add_message_to_memory`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import threading`；`import json`；`from typing import Any`；`from pathlib import Path`。
- 模块级配置或常量名称：`MSG_TYPE_MAP`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/platform_adapter/message.py#L1-L385)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/slack/__init__.py`**
- 源码对模块职责的说明：Slack channel integration.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.gateway.channel_manager.im_platforms.slack.slack_connect i`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/slack/__init__.py#L1-L8)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py`**
- 源码对模块职责的说明：WecomFileService - 企业微信文件服务。
- 调用入口 `detect_file_extension(content)`；声明返回 `str`。
- 调用入口 `get_mime_type(extension)`；声明返回 `str`。
- `WecomFileService` 定义类型边界；方法入口：`__init__`, `set_persist_hook`, `download_file`, `upload_file`, `get_media_type_for_file`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import os`；`import re`。
- 模块级配置或常量名称：`FILE_SIGNATURES`, `MIME_TYPES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_file_service.py#L1-L331)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_im_adapter.py`**
- 源码对模块职责的说明：企业微信平台的 IMPlatformAdapter 实现，处理企业微信特定的用户信息获取、历史消息加载和元数据构建.。
- `WecomIMPlatformAdapter` 定义类型边界；方法入口：`__init__`, `set_api_client`, `get_principal_user_id`, `get_user_name_by_user_id`, `resolve_user_display_name`, `get_principal_display_name`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any`；`from jiuwenswarm.gateway.channel_manager.im_platforms.platform_adapter.mess`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/wecom/wecom_im_adapter.py#L1-L172)。
- **`jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/formatter.py`**
- 源码对模块职责的说明：XiaoYi Formatter - 消息格式化和发送模块。 基于 TypeScript formatter.ts 实现。。
- `FileInfo` 定义类型边界。
- 调用入口 `build_status_update_response(task_id, text, state)`；声明返回 `dict[str, Any]`。
- 调用入口 `build_clear_context_response()`；声明返回 `dict[str, Any]`。
- 调用入口 `build_tasks_cancel_response(task_id)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import json`；`import time`；`import uuid`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/formatter.py#L1-L660)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/gateway-channel-manager/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
