---
name: agentos-contracts-01
description: agentos 源码接口与集成边界 01：extensions/agentos 的 __init__.py（导入 AgentCreateFailed）与 extension.py（导入 AgentOS）声明
metadata:
  scope: 只收 agentos 目录两个文件的静态声明；入口说明归 agentos-overview，agentos_router 子目录的声明归 agentos-agentos-router-contracts-01，auth 子目录的声明归 agentos-auth-contracts-01
---
# agentos 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/agentos/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.extensions.agentos.agentos_router import AgentCreateFailed`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/__init__.py#L1-L27)。
- **`jiuwenswarm/extensions/agentos/extension.py`**
- 源码对模块职责的说明：AgentOS extension entry (discovered by ExtensionLoader).。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.extensions.agentos.agentos_router.extension import AgentOS`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/extension.py#L1-L10)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/agentos/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
