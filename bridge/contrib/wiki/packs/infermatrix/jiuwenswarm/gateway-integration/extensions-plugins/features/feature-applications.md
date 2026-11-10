---
name: feature-applications
description: Application Plugin 与前端贡献功能知识入口：职责与边界、application_plugin_manifest 等接口入口、插件元数据配置键、设计取舍、关联功能与验收步骤
metadata:
  scope: 只收应用插件的功能概览与六个 facet 摘要；路由、注册与禁用门禁的实现证据归 feature-depth-applications
---
# Application Plugin 与前端贡献 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/feature-applications.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/application-plugins.md
- 源页字段（feature）：applications
- 入口（entry_points）：jiuwenswarm/extensions/application_host.py
- 源页字段（source_globs）：jiuwenswarm/extensions/application_host.py；jiuwenswarm/channels/web/frontend/src/applicationPlugins/manifest.ts；jiuwenswarm/channels/web/frontend/src/applicationPlugins/types.ts；jiuwenswarm/channels/web/frontend/src/applicationPlugins/useApplicationPlugins.ts
  - jiuwenswarm/extensions/sdk/application_plugin.py；jiuwenswarm/channels/web/frontend/src/applicationPlugins/ApplicationTaskControls.tsx；jiuwenswarm/channels/web/frontend/src/applicationPlugins/taskProgressStore.ts
  - jiuwenswarm/channels/web/frontend/src/applicationPlugins/ApplicationPluginOutlet.tsx；jiuwenswarm/channels/web/frontend/src/App.tsx
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 应用插件通过元数据、宿主绑定和贡献项连接前后端。仅提供前端贡献的插件与可导入 Python 后端模块应分别理解。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/extensions/application_host.py:L1–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L1-L110)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `application_plugin_manifest(registry)`；`iter_websocket_routes(registry)`；`mount_application_plugin_http_routes(app, registry)`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/extensions/application_host.py:L1–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L1-L110)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 配置入口与生效条件

- 上游 YAML 示例的配置键包括 `id`、`name`、`version`、`description`、`author`、`min_jiuwenswarm_version`、`package_type`、`permissions`。这些是示例字段，不单独证明源码默认值或全部优先级。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/extensions/application_host.py:L1–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L1-L110)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 设计取舍

- **设计推断**：应用插件独立贡献页面、RPC 和 WebSocket 路由，纯前端包无需 Python；代价是发现、资源托管、宿主服务注入和禁用状态需要协调。Python 与 iframe 都处于 Jiuwen 信任边界，媒体权限控制不能当成对任意插件业务能力的完整沙箱。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/extensions/application_host.py:L1–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L1-L110)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 数据流与关联功能

- 应用插件通过元数据、宿主绑定和贡献项连接前后端。仅提供前端贡献的插件与可导入 Python 后端模块应分别理解。 联调时结合[[feature-video-duplex]]（音视频双工扩展）、[[feature-web-navigation]]（Web 页面与功能入口）、[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/extensions/application_host.py:L1–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L1-L110)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。

### 怎样验证

- 安装最小纯前端插件检查发现接口和资源加载，再添加后端 RPC 验证服务注入。禁用时核对入口隐藏与新业务连接被拒绝，管理 RPC 的 available_when_disabled 只留给配置和启用状态。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/extensions/application_host.py:L1–L110](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/application_host.py#L1-L110)；
  - [docs/zh/application-plugins.md:L1–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/application-plugins.md#L1-L149)。
