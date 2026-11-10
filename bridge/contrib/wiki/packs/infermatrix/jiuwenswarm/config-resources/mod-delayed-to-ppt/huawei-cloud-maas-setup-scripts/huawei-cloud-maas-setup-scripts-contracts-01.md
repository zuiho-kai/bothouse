---
name: huawei-cloud-maas-setup-scripts-contracts-01
description: huawei-cloud-maas-setup-scripts 源码接口记录 01：huawei-cloud-maas-setup 技能脚本（账号检测、授权、API Key 与模型开通、配置写入校验、CDP 浏览器辅助）；覆盖 auto_authorize.py、auto_create_apikey.py、auto_open_model.py、check_account.py、config_writer.py 等共 11 个文件
metadata:
  scope: 只收 huawei-cloud-maas-setup-scripts 下这 11 个源文件的逐文件接口记录；本目录入口归 huawei-cloud-maas-setup-scripts-overview
---
# huawei-cloud-maas-setup-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py`**
- 源码对模块职责的说明：自动完成华为云 MaaS 委托授权（V2 折中方案）。。
- 调用入口 `auto_authorize(cdp_url, timeout_s)`；声明返回 `dict`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_authorize.py#L1-L234)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py`**
- 源码对模块职责的说明：自动创建华为云 MaaS API Key 并捕获完整 Key（V2 折中方案）。。
- 调用入口 `auto_create_apikey(cdp_url, tag, description, timeout_s)`；声明返回 `dict`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import re`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_create_apikey.py#L1-L410)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py`**
- 源码对模块职责的说明：自动开通华为云 MaaS 预置服务（文本生成）模型。。
- 调用入口 `auto_open_models(cdp_url, models, type_filter, timeout_s)`；声明返回 `dict`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/auto_open_model.py#L1-L816)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py`**
- 源码对模块职责的说明：检测华为云账号状态（实名认证 + 引导弹窗关闭）。。
- 调用入口 `check_account(cdp_url, timeout_s)`；声明返回 `dict`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import logging`；`import sys`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/check_account.py#L1-L132)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/config_writer.py`**
- 源码对模块职责的说明：华为云 MaaS 模型配置写入脚本。。
- 调用入口 `safe_update_env(updates, env_path)`；声明返回 `Path`。
- 调用入口 `add_models(api_base, api_key, models, provider)`；声明返回 `dict[str, Any]`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 模块级配置或常量名称：`ENV_PREFIX`, `DEFAULT_PROVIDER`, `DEFAULT_TIMEOUT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/config_writer.py#L1-L358)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/ensure_browser.py`**
- 源码对模块职责的说明：确保 Chromium 系浏览器在 CDP 端口可用。。
- 调用入口 `ensure_browser(timeout_s)`；声明返回 `dict[str, Any]`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/ensure_browser.py#L1-L321)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py`**
- 源码对模块职责的说明：CDP 连接与浏览器状态工具。。
- 调用入口 `emit(step, message)`；声明返回 `None`。
- 调用入口 `emit_progress(current, total, message)`；声明返回 `None`。
- 调用入口 `output_json(payload)`；声明返回 `None`。
- 调用入口 `load_browser_profile()`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import json`；`import logging`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/cdp_client.py#L1-L228)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/flow_state.py`**
- 源码对模块职责的说明：统一的成功/失败 JSON 生成函数，供所有脚本复用。。
- 调用入口 `make_failure(stage, message, **extra)`；声明返回 `dict[str, Any]`。
- 调用入口 `make_success(stage, **extra)`；声明返回 `dict[str, Any]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/flow_state.py#L1-L24)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py`**
- 源码对模块职责的说明：华为云 MaaS 控制台页面选择器集中维护。。
- `SelectorSet` 定义类型边界；方法入口：`first_visible`, `wait_first`。
- 调用入口 `click_first_visible(page, selector_set, timeout_ms)`；声明返回 `bool`。
- 调用入口 `click_wait_first(page, selector_set, timeout_ms)`；声明返回 `bool`。
- 调用入口 `extract_api_key_from_dialog(page)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`import time`；`from dataclasses import dataclass, field`。
- 模块级配置或常量名称：`MAAS_HOMEPAGE_URL`, `MAAS_APIKEY_URL`, `MAAS_DEPLOYMENT_URL`, `HUAWEI_COST_CENTER_URL`, `HUAWEI_REALNAME_AUTH_URL`, `MAAS_DEPLOYMENT_ROWS`, `MAAS_DEPLOYMENT_ROW_NAME`, `MAAS_DEPLOYMENT_ROW_STATUS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/lib/huawei_selectors.py#L1-L605)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/navigate.py`**
- 源码对模块职责的说明：通用 URL 跳转脚本（V2 折中方案核心脚本）。。
- 调用入口 `navigate(url, cdp_url, wait_until, timeout_ms)`；声明返回 `dict`。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/navigate.py#L1-L124)。
- **`jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/validate_config.py`**
- 源码对模块职责的说明：验证 jiuwenswarm 中的华为云 MaaS 配置是否有效。。
- 调用入口 `check_config_exists()`；声明返回 `tuple[bool, dict[str, str]]`。
- 调用入口 `test_connectivity(api_base, api_key, model_name)`；声明返回 `tuple[bool, str]`。
- 调用入口 `main()`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import json`；`import logging`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/huawei-cloud-maas-setup/scripts/validate_config.py#L1-L152)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/huawei-cloud-maas-setup-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
