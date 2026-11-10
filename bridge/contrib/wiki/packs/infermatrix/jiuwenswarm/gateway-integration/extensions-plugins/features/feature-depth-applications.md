---
name: feature-depth-applications
description: Application Plugin 实现深读：资产路由契约、API 前缀与贡献默认值、对 FastAPI 与 ExtensionRegistry 的耦合、manifest-only 插件加载测试、禁用插件的 available_when_disabled 放行、manifest-only 仅限 iframe 的取舍
metadata:
  scope: 只收应用插件 HTTP 路由、注册与禁用门禁的实现级证据和测试断言；功能概览归 feature-applications
---
# Application Plugin 与前端贡献：实现深读

## 现状

- [[feature-applications]]（功能概览） · [[extensions-plugins-overview]]（owner 入口）
- **资产路由契约** GET /api/application-plugins/{plugin_id}/assets/{asset_path:path} 要求 registry 中存在该插件（_plugin_or_404，否则 HTTP 404 "application plugin not found"），且 plugin.frontend_asset_root() 非 None；命中时返回 FileResponse(target) 并带 Cache-Control: no-cache 头。
  - 调用方只需给出插件 id 与相对资产路径，宿主负责把路径限制在 resolve 后的 asset root 内。
- 来源：[jiuwenswarm/extensions/application_host.py:L96–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L96-L110),
  - [jiuwenswarm/extensions/application_host.py:L70–L77](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L70-L77)
- **API 前缀与贡献默认值** HTTP 前缀由常量 APPLICATION_PLUGIN_API_PREFIX = "/api/application-plugins" 固定，两条路由（清单与资产）都基于它拼接。无前端贡献的插件在清单中合成 id 为 "{plugin_id}:management" 的条目，render_mode="none"、position=1000；文档声明 nav_key/render_mode/entrypoint/position 缺省分别为 app:{plugin_id}、iframe、index.html、100。
- 来源：[jiuwenswarm/extensions/application_host.py:L15–L16](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L15-L16),
  - [jiuwenswarm/extensions/application_host.py:L30–L44](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L30-L44),
  - [docs/zh/application-plugins.md:L47–L48](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L47-L48)
- **对 FastAPI 与 ExtensionRegistry 的耦合** mount_application_plugin_http_routes 直接接收 FastAPI 实例并通过 @app.get 注册路由，说明应用插件的 HTTP 面完全寄生在宿主 Web 框架上；插件列表本身来自 ExtensionRegistry.get_application_plugins()，registry 为 None 时 _plugins 返回空元组，清单退化为 {"api_version": 1, "plugins": []} 而不是报错。
- 来源：[jiuwenswarm/extensions/application_host.py:L88–L94](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L88-L94),
  - [jiuwenswarm/extensions/application_host.py:L18–L21](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L18-L21)
- **测试内 manifest-only 插件经 ExtensionLoader 注册后由资产路由返回 index.html** 测试在 tmp_path 写入 extension.yaml 与 frontend/dist/index.html 后，await ExtensionLoader(registry).load_extension(root) 为真且 registry.get_application_plugin("hello-plugin") 非空；
  - manifest 首条 entry_url 以 /hello-plugin/assets/index.html 结尾，TestClient GET 该 URL 返回 200 与文件原文。
- 来源：[tests/unit_tests/test_application_plugins.py:L168–L178](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_application_plugins.py#L168-L178),
  - [tests/unit_tests/test_application_plugins.py:L193–L207](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_application_plugins.py#L193-L207),
  - [jiuwenswarm/extensions/application_host.py:L96–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L96-L110)
- **禁用插件的方法按注册时 available_when_disabled 区分错误码与放行** enabled=False 的 _TestPlugin 经 registry.bind_application_plugins(channel) 绑定后，调用绑定产物 example.ping 返回 code="APPLICATION_PLUGIN_DISABLED"；注册时带 available_when_disabled=True 的 example.settings 仍返回 payload={"settings": true}。两个方法均以 local_only=True 注册。
- 来源：[tests/unit_tests/test_application_plugins.py:L77–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_application_plugins.py#L77-L83),
  - [tests/unit_tests/test_application_plugins.py:L140–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_application_plugins.py#L140-L153)
- **Manifest-only 插件以仅限 iframe 换取无需 Python 后端** 设计推断（非作者历史意图）：
- 设计推断：收益是 ManifestApplicationPlugin 面向无需 Python 后端的预构建 iframe 应用、由 loader 自动创建注册（类 docstring 自述）；代价是其 frontend render_mode 非 iframe 即 raise ValueError("manifest-only application plugins support iframe frontends only")。
- 来源：[jiuwenswarm/extensions/sdk/application_plugin.py:L107–L112](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/sdk/application_plugin.py#L107-L112),
  - [jiuwenswarm/extensions/sdk/application_plugin.py:L128–L131](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/sdk/application_plugin.py#L128-L131)
- **自动化运行时测试断言禁用门禁与 available_when_disabled 放行** test_registry_binds_local_methods_and_blocks_disabled_plugins 用真实 ExtensionRegistry 注册并绑定 enabled=False 插件，断言 channel.local_only == {"example.ping", "example.settings"}、
  - responses[0]["code"] == "APPLICATION_PLUGIN_DISABLED" 且 responses[1]["payload"] == {"settings": true}。
- 来源：[tests/unit_tests/test_application_plugins.py:L77–L83](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_application_plugins.py#L77-L83),
  - [tests/unit_tests/test_application_plugins.py:L140–L153](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/test_application_plugins.py#L140-L153)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-depth-applications.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py:L96-L110；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py:L70-L77
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py:L15-L16；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py:L30-L44
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/application-plugins.md:L47-L48；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py:L88-L94
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py:L18-L21；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_application_plugins.py:L168-L178
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_application_plugins.py:L193-L207；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_application_plugins.py:L77-L83
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_application_plugins.py:L140-L153；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/sdk/application_plugin.py:L107-L112
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/sdk/application_plugin.py:L128-L131
- 源页字段（feature）：applications
- 入口（entry_points）：jiuwenswarm/extensions/application_host.py
- 源页字段（source_globs）：jiuwenswarm/extensions/application_host.py
