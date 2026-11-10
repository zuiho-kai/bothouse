---
name: config-panel-contracts-01
description: config-panel 源码接口与集成边界 01：common/config_panel/config_set_handlers.py、common/config_panel/tui_models_handlers.py 的逐文件静态声明记录与源码链接
metadata:
  scope: 只收上述文件的逐文件静态声明记录；入口说明与导航归 config-panel-overview
---
# config-panel 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/common/config_panel/config_set_handlers.py`**
- 源码对模块职责的说明：Web 侧 config.set / config.save_all 域 handler 下沉实现（自 gateway app_web_handlers 迁出）。。
- `ConfigPanelInternalError` 继承 `RuntimeError`。
- `ConfigChangeSet` 定义类型边界；方法入口：`changed`, `updated_keys`, `reload_scopes`, `reload_options`。
- `ConfigApplyResult` 定义类型边界。
- 调用入口 `permission_profile(permission_config)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import importlib.metadata`；`import inspect`；`import json`。
- 模块级配置或常量名称：`WEB_CONFIG_RELOAD_CHANNEL_ID`, `SEARCH_RELOAD_ENV_KEYS`, `MODEL_RELOAD_ENV_KEYS`, `MULTIMODAL_RELOAD_ENV_KEYS`, `ASR_ENV_KEYS`, `ENV_FILE`, `CONFIG_SET_ENV_MAP`, `CONFIG_KEYS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config_panel/config_set_handlers.py#L1-L1798)。
- **`jiuwenswarm/common/config_panel/tui_models_handlers.py`**
- 源码对模块职责的说明：TUI 侧 config 域 handler 下沉实现（自 gateway tui_connect 迁出）。。
- `ModelOpError` 继承 `Exception`。
- 调用入口 `get_auto_harness_config()`；声明返回 `dict[str, Any]`。
- 调用入口 `normalize_provider_value(value)`；声明返回 `str`。
- 异步入口 `clear_agent_config_cache(agent_client, user_id, send_request)`；声明返回 `None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import asyncio`；`import inspect`；`import logging`。
- 模块级配置或常量名称：`CLI_CONFIG_SET_ENV_MAP`, `CLI_CONFIG_YAML_SETTERS`, `CLI_CONFIG_YAML_KEYS`, `PREFERRED_LANGUAGE_OPTIONS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/config_panel/tui_models_handlers.py#L1-L1859)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/common-core/config-panel/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
