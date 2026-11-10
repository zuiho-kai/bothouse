---
name: common-tools-contracts-04
description: common-tools 源码接口与集成边界 04：contact_tools.py、file_tools.py、file_upload_helpers.py、image_reading_tool.py、location_tool.py、message_tools.py 等 14 个模块
metadata:
  scope: 只收 common/tools/xiaoyi_phone_tools 下 contact_tools.py 至 xiaoyi_gui_tool.py 共 14 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-tools-contracts-01、common-tools-contracts-02、common-tools-contracts-03、common-tools-contracts-05
---
# common-tools 源码接口与集成边界 04

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py`**
- 源码对模块职责的说明：Contact tools - 联系人工具.。
- 异步入口 `search_contact(name)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any, Dict`；`from openjiuwen.core.foundation.tool import tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/contact_tools.py#L1-L102)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_tools.py`**
- 源码对模块职责的说明：File tools - 文件工具.。
- 异步入口 `search_file(query)`；声明返回 `Dict[str, Any]`。
- 异步入口 `upload_file(file_infos)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import json`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_tools.py#L1-L340)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py`**
- 源码对模块职责的说明：OBS 上传辅助：prepare、upload、completeAndQuery 获取公网 URL.。
- `XiaoyiObsUploadConfig` 定义类型边界。
- 异步入口 `upload_local_file_public_url(session, config, file_path, object_type)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import hashlib`；`import os`；`from dataclasses import dataclass`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/file_upload_helpers.py#L1-L97)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/image_reading_tool.py`**
- 源码对模块职责的说明：image_reading：。
- 异步入口 `image_reading(local_url, remote_url, prompt)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`import tempfile`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/image_reading_tool.py#L1-L293)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py`**
- 源码对模块职责的说明：Location tool - 获取手机当前定位.。
- 异步入口 `get_user_location()`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any, Dict`；`from openjiuwen.core.foundation.tool import tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/location_tool.py#L1-L86)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/message_tools.py`**
- 源码对模块职责的说明：Message tools - 短信/消息工具.。
- 异步入口 `send_message(phone_number, content)`；声明返回 `Dict[str, Any]`。
- 异步入口 `search_message(content)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any, Dict, Optional`；`from openjiuwen.core.foundation.tool import tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/message_tools.py#L1-L247)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py`**
- 源码对模块职责的说明：Note tools - 备忘录工具.。
- 异步入口 `create_note(title, content)`；声明返回 `Dict[str, Any]`。
- 异步入口 `search_notes(query)`；声明返回 `Dict[str, Any]`。
- 异步入口 `modify_note(entity_id, text)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any, Dict`；`from openjiuwen.core.foundation.tool import tool`；`from jiuwenswarm.common.utils import logger`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/note_tools.py#L1-L251)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py`**
- 源码对模块职责的说明：Phone tools - 电话工具.。
- 异步入口 `call_phone(phone_number, slot_id)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any, Dict, Optional`；`from openjiuwen.core.foundation.tool import tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/phone_tools.py#L1-L113)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py`**
- 源码对模块职责的说明：Photo tools - 相册工具.。
- 异步入口 `search_photo_gallery(query)`；声明返回 `Dict[str, Any]`。
- 异步入口 `upload_photo(media_uris)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any, Dict, List, Union`；`from openjiuwen.core.foundation.tool import tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/photo_tools.py#L1-L281)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py`**
- 源码对模块职责的说明：Push result tool - 查看推送记录工具.。
- 调用入口 `view_push_result(keywords, limit)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`from typing import Any, Dict, Optional`；`from openjiuwen.core.foundation.tool import tool`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/push_result_tool.py#L1-L152)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py`**
- 源码对模块职责的说明：PushData 持久化管理器.。
- 调用入口 `save_push_data(data_detail)`；声明返回 `str`。
- 调用入口 `search_push_data(keywords)`；声明返回 `List[Dict[str, str]]`。
- 调用入口 `get_all_push_data()`；声明返回 `List[Dict[str, str]]`。
- 调用入口 `clear_all_push_data()`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`import uuid`。
- 模块级配置或常量名称：`PUSHDATA_FILE`, `MAX_PUSHDATA_ITEMS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/pushdata_manager.py#L1-L147)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py`**
- 源码对模块职责的说明：Save tools - 保存到手机工具.。
- 异步入口 `save_media_to_gallery(url, media_type, file_name)`；声明返回 `Dict[str, Any]`。
- 异步入口 `save_file_to_file_manager(file_name, url, suffix)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import os`；`from typing import Any, Dict, Optional`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/save_tools.py#L1-L277)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py`**
- 源码对模块职责的说明：Timestamp tool - 时间戳转换工具.。
- 调用入口 `convert_timestamp_to_utc8_time(timestamp)`；声明返回 `dict`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from datetime import datetime, timedelta, timezone`；`from openjiuwen.core.foundation.tool import tool`；`from jiuwenswarm.common.utils import logger`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/timestamp_tool.py#L1-L84)。
- **`jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_gui_tool.py`**
- 源码对模块职责的说明：小艺 GUI 自动化（xiaoyi_gui_agent）：通过 InvokeJarvisGUIAgent 与设备协同完成屏幕操作.。
- 异步入口 `xiaoyi_gui_agent(query)`；声明返回 `Dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import time`；`import uuid`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/tools/xiaoyi_phone_tools/xiaoyi_gui_tool.py#L1-L167)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-tools/source-contracts-04.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
