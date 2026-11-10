---
name: video-duplex-contracts-01
description: video-duplex 源码接口与集成边界 01：extensions/video_duplex/extension.py（VideoDuplexApplicationPlugin 的 is_enabled、initialize、shutdown、bind_web_channel、websocket_routes、frontend_contributions；register_extensions）声明
metadata:
  scope: 只收 video_duplex/extension.py 一个文件的静态声明；入口说明归 video-duplex-overview，backend 目录归 video-duplex-backend-contracts-01 与 video-duplex-backend-contracts-02，frontend 目录归 video-duplex-frontend-contracts-01 与 video-duplex-frontend-contracts-02
---
# video-duplex 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/extensions/video_duplex/extension.py`**
- `VideoDuplexApplicationPlugin` 继承 `ApplicationPluginExtension`；方法入口：`is_enabled`, `initialize`, `shutdown`, `bind_web_channel`, `websocket_routes`, `frontend_contributions`。
- 异步入口 `register_extensions(registry)`；声明返回 `list[VideoDuplexApplicationPlugin]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from jiuwenswarm.extensions.sdk import ApplicationPluginExtension, Applicat`；`from jiuwenswarm.extensions.video_duplex.backend.qwen_omni_gateway import Q`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/video_duplex/extension.py#L1-L156)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/video-duplex/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
