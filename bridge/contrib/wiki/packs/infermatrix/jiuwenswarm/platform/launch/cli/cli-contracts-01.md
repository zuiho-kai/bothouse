---
name: cli-contracts-01
description: cli 源码接口与集成边界 01：cli/_terminal.py、cli/chat.py、cli/events.py、cli/gateway_client.py、cli/render.py 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收上述文件的逐文件静态声明记录；入口说明与导航归 cli-overview
---
# cli 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/cli/_terminal.py`**
- 源码对模块职责的说明：Compatibility alias for :mod:'jiuwenswarm.channels.cli._terminal'.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from importlib import import_module`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/_terminal.py#L1-L8)。
- **`jiuwenswarm/cli/chat.py`**
- 源码对模块职责的说明：Compatibility alias for :mod:'jiuwenswarm.channels.cli.chat'.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from importlib import import_module`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/chat.py#L1-L8)。
- **`jiuwenswarm/cli/events.py`**
- 源码对模块职责的说明：Compatibility alias for :mod:'jiuwenswarm.channels.cli.events'.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from importlib import import_module`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/events.py#L1-L8)。
- **`jiuwenswarm/cli/gateway_client.py`**
- 源码对模块职责的说明：Compatibility alias for :mod:'jiuwenswarm.channels.cli.gateway_client'.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from importlib import import_module`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/gateway_client.py#L1-L8)。
- **`jiuwenswarm/cli/render.py`**
- 源码对模块职责的说明：Compatibility alias for :mod:'jiuwenswarm.channels.cli.render'.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from importlib import import_module`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/cli/render.py#L1-L8)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/launch/cli/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
