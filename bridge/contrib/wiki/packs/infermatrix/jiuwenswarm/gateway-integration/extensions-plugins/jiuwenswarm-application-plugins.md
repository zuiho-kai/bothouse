---
name: jiuwenswarm-application-plugins
description: 应用插件绑定、前端贡献与资源挂载：ManifestApplicationPlugin 构造、bind_application_plugins 与禁用门禁、GET /api/application-plugins 清单与资产、WebSocket 路由
metadata:
  scope: 只收 ApplicationPlugin 的 manifest-only 构造、宿主绑定、禁用门、HTTP 资产与 WebSocket 路由；扩展发现和进程生命周期归 jiuwenswarm-extensions，设计取舍归 extensions-plugins-design-tradeoffs
---
# 应用插件绑定、前端贡献与资源挂载

## 现状

### 职责和边界

- 说明 ApplicationPlugin 的 manifest-only 构造、宿主绑定、禁用门、HTTP 资产与 WebSocket 路由；扩展发现和进程生命周期见扩展主页面。

### 应用插件：manifest-only、绑定与挂载

- manifest-only 插件：无入口脚本且 `package_type == "application"` 时 loader 直接构造 `ManifestApplicationPlugin` 并注册，要求 `metadata.id` 非空、至少一个 frontend 贡献；
  - frontend 仅允许 `render_mode == "iframe"`（其余抛 `ValueError`），`entrypoint` 缺省 `index.html`，id/nav_key/position 缺省分别为 `<plugin_id>-page`、`app:<plugin_id>`、`100+序号`；initialize/shutdown 均为 no-op。无入口且非 application 的根会在 `_import_module` 抛 `FileNotFoundError`。
  - 见 [sdk/application_plugin.py L107-153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/sdk/application_plugin.py#L107-L153)、
  - [loader.py L70-81](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/loader.py#L70-L81)。
- 绑定与禁用门禁：Gateway 在 `_register_web_handlers` 之后调 `bind_application_plugins(web_channel, agent_client=..., media_attachment_normalizer=...)`，每个插件拿到包了 `_ApplicationPluginChannel` 的 channel 与 `ApplicationPluginServices`。
  - wrapper 拦截所有 `register_method`：除非声明 `available_when_disabled=True`，禁用插件的 RPC 直接回 `code="APPLICATION_PLUGIN_DISABLED"` 错误响应（设置类方法可声明该标志让用户从管理页重新启用）；同时设 `channel.application_plugin_registry = registry`，Web app 构建时从该属性取插件 registry。
  - `ApplicationPluginServices.require_agent_client` / `normalize_media_attachments` 在宿主未注入对应服务时抛 `RuntimeError`。见 [registry.py L54-82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/registry.py#L54-L82)、
  - [L162-180](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/registry.py#L162-L180)、
  - [app_gateway.py L2215-2219](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L2215-L2219)。
- HTTP 清单与资产：`GET /api/application-plugins` 返回 `{"api_version": 1, "plugins": [...]}`，每个前端贡献一项（含 plugin_id/enabled/permissions/entry_url），按 `(position, nav_key)` 排序；无贡献的插件合成 `<plugin_id>:management` 条目（`render_mode="none"`、position 1000）。
  - 资产路由 `GET /api/application-plugins/{plugin_id}/assets/{asset_path:path}` 的 404 条件：插件不存在、frontend_asset_root()（SDK 默认实现为已存在的 <扩展目录>/frontend/dist，插件可覆盖该方法）为 None、`resolve()` 后落在根外（`relative_to` 抛 `ValueError`）、目标不是文件；命中时以 `Cache-Control: no-cache` 返回 FileResponse。该检查使用解析后的 root 与 target 比较路径包含关系；
  - 它本身不构成整个插件的安全保证。见 [application_host.py L24-110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L24-L110)。
- WebSocket 路由：`iter_websocket_routes` 产出 `(plugin_id or metadata.id, route)`，运行时 `plugin_id` 优先于清单 id（`test_websocket_routes_use_the_registered_runtime_plugin_id` 固定）。Web app 构建时保留主 WS 路径与 `/ws/git`，插件路由与之冲突或彼此重复都在**构建期**抛 `ValueError`；
  - 连接时先做可选 origin 检查（`check_origin` 默认 True），插件禁用且未声明 `available_when_disabled` 时 `close(1008, reason="application plugin is disabled")`。
  - 见 [web_channel_app.py L59-95](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/web/web_channel_app.py#L59-L95)、
  - [application_host.py L80-85](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L80-L85)。

### 怎样验证

- 源码链接固定在 f0a69728c96b5961d993449f1a901cbd2f4dac5b。聚焦单测选择器和验证范围见[[jiuwenswarm-extensions]]（原模块页面；源锚点 #怎样验证）；单元契约不能替代真实服务、模型端点或跨平台集成验证。

### 相关文档

- [[jiuwenswarm-extensions]]（原模块架构与入口）
- [[jiuwenswarm-extensions-video-duplex]]（相邻模块）

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/jiuwenswarm-application-plugins.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/loader.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/registry.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/sdk/application_plugin.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/web_channel_app.py
