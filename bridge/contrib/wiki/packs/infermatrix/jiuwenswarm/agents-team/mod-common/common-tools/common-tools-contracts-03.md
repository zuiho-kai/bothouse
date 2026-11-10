---
name: common-tools-contracts-03
description: common-tools 源码接口与集成边界 03：trusted_search_tool_adapter.py、user_todo_tool.py、verified_download_assets.py、video_gen_tools.py、video_tools.py、visual_gen_tools.py 等 12 个模块
metadata:
  scope: 只收 common/tools 下 trusted_search_tool_adapter.py 至 calendar_tools.py 共 12 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-tools-contracts-01、common-tools-contracts-02、common-tools-contracts-04、common-tools-contracts-05
---
# common-tools 源码接口与集成边界 03

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py`**
- 源码对模块职责的说明：Host integration adapters for search tools and permission provenance.。
- 异步入口 `mcp_free_search(query, max_results, timeout_seconds)`；声明返回 `str`。
- 调用入口 `refresh_paid_search_metadata()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`from copy import deepcopy`；`from openjiuwen.core.foundation.tool import LocalFunction, tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/trusted_search_tool_adapter.py#L1-L148)。
- **`jiuwenswarm/agents/harness/common/tools/user_todo_tool.py`**
- 源码对模块职责的说明：User todos tool for JiuWenSwarm - Managing todo items per channel.。
- `TodoStatus` 继承 `str, Enum`。
- `TodoPriority` 继承 `str, Enum`。
- `UserTodosParams` 定义类型边界。
- `TodoItem` 定义类型边界；方法入口：`to_dict`, `from_dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import os`；`import re`；`import uuid`；`from datetime import datetime, timedelta, timezone`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/user_todo_tool.py#L1-L400)。
- **`jiuwenswarm/agents/harness/common/tools/verified_download_assets.py`**
- 源码对模块职责的说明：TTL-owned immutable download assets for authorized file delivery.。
- `VerifiedDownloadAsset` 定义类型边界。
- `VerifiedDownloadAssetOwner` 定义类型边界；方法入口：`__init__`, `stage`, `commit`, `revoke`, `is_active`, `prune`。
- 调用入口 `get_verified_download_asset_owner()`；声明返回 `VerifiedDownloadAssetOwner`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/verified_download_assets.py#L1-L409)。
- **`jiuwenswarm/agents/harness/common/tools/video_gen_tools.py`**
- 源码对模块职责的说明：Text-to-video / image-to-video generation tools.。
- 调用入口 `video_gen_enabled()`；声明返回 `bool`。
- 调用入口 `video_gen_configured()`；声明返回 `bool`。
- 异步入口 `generate_video(prompt, aspect_ratio, resolution, duration_seconds, first_frame_path, generate_audio, save_dir)`；声明返回 `str`。
- 异步入口 `check_video_status(job_id, save_dir)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import base64`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_gen_tools.py#L1-L377)。
- **`jiuwenswarm/agents/harness/common/tools/video_tools.py`**
- `VideoUnderstandingRequest` 定义类型边界。
- 异步入口 `video_understanding(inputs, **kwargs)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import asyncio`；`import base64`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/video_tools.py#L1-L235)。
- **`jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py`**
- 源码对模块职责的说明：Text-to-image generation tool via an OpenRouter-style chat-completions image modality (e.g. google/gemini-3.1-flash-image).。
- 调用入口 `visual_gen_enabled()`；声明返回 `bool`。
- 调用入口 `visual_gen_configured()`；声明返回 `bool`。
- 异步入口 `generate_visual(prompt, aspect_ratio, resolution, save_dir)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import base64`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/visual_gen_tools.py#L1-L197)。
- **`jiuwenswarm/agents/harness/common/tools/web_fetch_tools.py`**
- 源码对模块职责的说明：Web fetch tools implemented with openjiuwen @tool style.。
- 异步入口 `mcp_fetch_webpage(url, max_chars, timeout_seconds)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import os`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/web_fetch_tools.py#L1-L341)。
- **`jiuwenswarm/agents/harness/common/tools/web_file_download.py`**
- 源码对模块职责的说明：Web File Download Token Manager。
- `WebFileDownloadManager` 定义类型边界；方法入口：`__init__`, `get_instance`, `reset_instance`, `generate_verified_asset_token`, `generate_token`, `generate_skill_content_image_token`。
- 调用入口 `generate_file_download_token(file_path, session_id, expires_in)`；声明返回 `str`。
- 调用入口 `generate_skill_content_image_token(name, version, relative_path, session_id, expires_in)`；声明返回 `str`。
- 调用入口 `is_path_within_user_dirs(path_str)`；声明返回 `bool`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import base64`；`import hashlib`；`import hmac`。
- 模块级配置或常量名称：`PURPOSE_SKILL_CONTENT_IMAGE`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/web_file_download.py#L1-L436)。
- **`jiuwenswarm/agents/harness/common/tools/wiki_tools.py`**
- `LLMWiki` 定义类型边界；方法入口：`__init__`, `ensure_initialized`, `list_sources`, `ingest`, `query`, `lint`。
- 异步入口 `wiki_ingest(source, workspace, force, sys_operation)`；声明返回 `str`。
- 异步入口 `wiki_query(query, workspace, sys_operation)`；声明返回 `str`。
- 异步入口 `wiki_lint(workspace, sys_operation)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any, List, Optional, Dict`；`from pathlib import Path`；`import datetime`。
- 模块级配置或常量名称：`DEFAULT_WIKI_DIR`, `DEFAULT_WIKI_AGENT_SYSTEM_PROMPT_EN`, `DEFAULT_WIKI_AGENT_SYSTEM_PROMPT_CN`, `DEFAULT_WIKI_AGENT_SYSTEM_PROMPT`, `DEFAULT_WIKI_AGENT_DESCRIPTION_EN`, `DEFAULT_WIKI_AGENT_DESCRIPTION_CN`, `DEFAULT_WIKI_AGENT_DESCRIPTION`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/wiki_tools.py#L1-L591)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/__init__.py`**
- 源码对模块职责的说明：Xiaoyi Handset Tools - 小艺手机端设备工具.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .location_tool import get_user_location`；`from .note_tools import create_note, search_notes, modify_note`；`from .calendar_tools import create_calendar_event, search_calendar_event`；`from .contact_tools import search_contact`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/__init__.py#L1-L70)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py`**
- 源码对模块职责的说明：Alarm tools - 闹钟工具.。
- 异步入口 `create_alarm(hour, minute, alarm_time, alarm_title, label, alarm_snooze_duration, alarm_snooze_total, alarm_ring_duration, days_of_wake_type, days_of_week)`；声明返回 `Dict[str, Any]`。
- 异步入口 `search_alarms(range_type, alarm_state, days_of_wake_type, start_time, end_time)`；声明返回 `Dict[str, Any]`。
- 异步入口 `modify_alarm(entity_id, alarm_id, alarm_time, alarm_title, alarm_state, enabled, alarm_snooze_duration, alarm_snooze_total, alarm_ring_duration, days_of_wake_type, …)`；声明返回 `Dict[str, Any]`。
- 异步入口 `delete_alarm(items, alarm_id)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from datetime import datetime, timedelta, timezone`；`from typing import Any, Dict, List, Optional, Sequence, Union`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/alarm_tools.py#L1-L645)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py`**
- 源码对模块职责的说明：Calendar tools - 日历工具.。
- 异步入口 `create_calendar_event(title, dt_start, dt_end)`；声明返回 `Dict[str, Any]`。
- 异步入口 `search_calendar_event(start_time, end_time, title)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from datetime import datetime`；`from typing import Any, Dict, Optional`；`from openjiuwen.core.foundation.tool import tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/calendar_tools.py#L1-L287)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-tools/source-contracts-03.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
