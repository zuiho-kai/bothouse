---
name: client-contracts-01
description: client 源码接口与集成边界 01：common/client/agent_client.py、common/client/agent_http_bridge.py、common/client/third_agent.py 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收上述文件的逐文件静态声明记录；入口说明与导航归 client-overview
---
# client 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/common/client/agent_client.py`**
- 源码对模块职责的说明：AgentServerClient - 与 AgentServer 通信的客户端接口（南北向契约）。。
- `AgentServerClient` 继承 `ABC`；方法入口：`connect`, `disconnect`, `set_or_update_server_config`, `send_request`, `send_request_stream`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from abc import ABC, abstractmethod`；`from typing import Any, AsyncIterator`；`from jiuwenswarm.common.e2a.models import E2AEnvelope`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/agent_client.py#L1-L64)。
- **`jiuwenswarm/common/client/agent_http_bridge.py`**
- 源码对模块职责的说明：目标 AgentServer 的受认证 HTTP bridge 基址解析与上传执行。。
- 调用入口 `resolve_agent_host_port()`；声明返回 `tuple[str, str, str]`。
- 调用入口 `resolve_agent_http_base()`；声明返回 `str`。
- 调用入口 `resolve_agent_upload_base()`；声明返回 `str`。
- 调用入口 `set_agent_http_base_resolver(resolver)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import os`；`from typing import Any`。
- 模块级配置或常量名称：`UPLOAD_TIMEOUT_SECONDS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/agent_http_bridge.py#L1-L210)。
- **`jiuwenswarm/common/client/third_agent.py`**
- 源码对模块职责的说明：ThirdAgent - 第三方 Agent list/switch 能力接口（南北向契约）。。
- `ThirdAgent` 继承 `ABC`；方法入口：`normalize_agent_type`, `thirdagent_list`, `thirdagent_switch`。
- `UnsupportedThirdAgent` 继承 `ThirdAgent`；方法入口：`thirdagent_list`, `thirdagent_switch`。
- 调用入口 `get_unsupported_third_agent()`；声明返回 `ThirdAgent`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from abc import ABC, abstractmethod`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L1-L89)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/client/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
