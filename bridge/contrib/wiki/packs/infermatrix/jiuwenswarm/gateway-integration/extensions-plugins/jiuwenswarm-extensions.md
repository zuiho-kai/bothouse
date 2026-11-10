---
name: jiuwenswarm-extensions
description: 扩展机制与 openYuanRong 集成（jiuwenswarm/extensions/）：ExtensionManager/Loader 搜索与加载顺序、ExtensionRegistry 单例与槽位替换、hook 分发、进程生命周期与关闭、验证入口
metadata:
  scope: 只收扩展框架本身；应用插件绑定与资源挂载归 jiuwenswarm-application-plugins，AgentOS 与 video_duplex 两个具体扩展归 jiuwenswarm-extensions-agentos、jiuwenswarm-extensions-video-duplex，设计取舍归 extensions-plugins-design-tradeoffs
---
# 扩展机制与 openYuanRong 集成（jiuwenswarm/extensions/）

## 现状

- 负责 JiuwenSwarm 的扩展体系：查找、加载和管理扩展，用 ExtensionRegistry 统一登记 AgentServerClient、加密工具、第三方 Agent、应用插件等扩展点，并提供 Gateway/AgentServer 的 hook 事件与上下文；应用插件的 HTTP、WebSocket 路由和前端资源也在这里挂载。同一目录下还有 openYuanRong 集成：Frontend HTTP 客户端、对应的 AgentServerClient 扩展，以及 clawee FaaS 函数入口。
- **从这里读起**
- `jiuwenswarm/extensions/manager.py` — ExtensionManager：从配置解析扩展目录，load_all_extensions / shutdown_all_extensions / list_extensions 管理全部扩展的生命周期
- `jiuwenswarm/extensions/registry.py` — ExtensionRegistry 单例：注册和获取各类扩展，register/unregister/trigger 负责 hook 事件分发；应用插件在这里绑定 web channel
- `jiuwenswarm/extensions/application_host.py` — 应用插件宿主：生成插件清单，挂载插件的 HTTP 路由和静态资源，枚举插件的 WebSocket 路由
- `jiuwenswarm/extensions/clawee.py` — openYuanRong 函数入口（init/handler/ahandler/pre_stop），复用 AgentWebSocketServer._handle_message，FaaS 链路和 ws 链路走同一套处理代码
- `jiuwenswarm/extensions/agent_client/extension.py` — YuanrongAgentServerClientExtension 与 register_extensions：把 Yuanrong 客户端注册为 AgentServerClient 扩展
- **关键文件**
- `jiuwenswarm/extensions/loader.py` — ExtensionLoader：在搜索路径中识别扩展根目录，读取 manifest，安装依赖，导入入口模块
- `jiuwenswarm/extensions/sdk/base.py` — BaseExtension 抽象基类：initialize/shutdown 生命周期，从 YAML 读取元数据和配置
- `jiuwenswarm/extensions/sdk/application_plugin.py` — ApplicationPluginExtension、ManifestApplicationPlugin，以及 WebSocket 路由和前端贡献的数据结构
- `jiuwenswarm/extensions/sdk/agent_server_client.py` — AgentServerClientExtension 扩展点：提供 AgentServerClient
- `jiuwenswarm/extensions/sdk/crypto_utility.py` — CryptoUtility 扩展点：提供 CryptoProvider，由 registry 桥接加解密
- `jiuwenswarm/extensions/sdk/third_agent.py` — ThirdAgentExtension 扩展点：提供第三方 Agent
- `jiuwenswarm/extensions/hook_event.py` — GatewayHookEvents / AgentServerHookEvents：hook 事件名定义
- `jiuwenswarm/extensions/hooks_context.py` — Memory、Gateway 对话、AgentServer 对话、SystemPrompt 这几类 hook 的上下文对象
- `jiuwenswarm/extensions/types.py` — ExtensionMetadata / ExtensionConfig 类型
- `jiuwenswarm/extensions/callback_compat.py` — 兼容 openjiuwen<0.1.9 的 AsyncCallbackFramework：补上缺失的 unregister_sync
- `jiuwenswarm/extensions/yuanrong_frontend_client.py` — YuanrongFrontendAgentClient：调用 openYuanRong Frontend 函数，管理常驻 agent 沙箱，处理 trace id 和 TCP 探针配置

### 扩展发现与加载（manager / loader）

- 以下行为按源码 f0a6972 静态核对，未运行测试。
- 搜索路径按固定顺序拼接：最前是 `<root>/application_plugins`（不存在会自动创建），随后是配置 `extensions.extension_dirs`（只接受字符串、按 `;` 分割），末尾总是追加内置目录 `jiuwenswarm/extensions`；去重按小写归一的路径 parts 保留首个出现者，因此配置里显式写内置路径不会重复搜索。相对路径 `jiuwenswarm/extensions` 会同时尝试 CWD 解析和 extensions 包目录两个候选。
  - 见 [manager.py L31-80](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L31-L80)。
- 扩展根目录的判定只看搜索路径的**一级子目录**：目录内含 `extension.yaml` **或** `extension.py` 即算，不递归、普通文件跳过。清单缺失时按 `{}` 处理，`extension.py`-only 的根仍可加载。见 [loader.py L29-58](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/loader.py#L29-L58)、
  - [L167-177](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/loader.py#L167-L176)。
- `load_all_extensions` 逐根处理：先 `load_manifest`（只读 YAML，不导入入口模块），`include_transport_extensions=False` 时跳过 `requires_transport is True` 的扩展——判断是严格布尔恒等，字符串 `"false"` 也会被加载（`tests/unit_tests/test_extension_manager.py::test_transport_manifest_flag_requires_a_real_boolean` 固定该行为）；
  - 单个根加载抛任何异常捕获 Exception 后记 error 日志并继续其余根；取消等 BaseException 不在该捕获范围。Runtime 直连与 AgentServer 启动都传 False，Gateway 默认加载全部。见 [manager.py L82-109](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L82-L109)、
  - [app_agentserver.py L263-265](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/app_agentserver.py#L263-L265)。
- `load_extension` 顺序：读清单 → 安装依赖 → 无入口脚本且 `package_type == "application"` 时走 manifest-only 分支，否则按 `jiuwenswarm.loaded_extension.<目录名>` 导入入口并调用模块级异步 `register_extensions(registry)`（可返回单个对象或列表；未定义或返回空时 loader 返回 None）。
  - 返回对象有 set_extension_dir 方法时才调用 set_extension_dir(root)，但只有 `ApplicationPluginExtension` 实例由 loader 追加 `await ext.initialize(registry.config)`，其他扩展点的初始化由各自 `register_extensions` 内部负责。
  - 依赖安装：清单 `dependencies` 为 包名→版本约束 映射，先 `importlib.metadata.version` 探测，未装时优先 `uv pip install`（PATH 有 uv 时）否则 `python -m pip install`，单包 120 秒超时；超时与失败**只记日志、继续加载**，不阻断导入。
  - 见 [loader.py L65-144](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/loader.py#L65-L144)。
- `BaseExtension.metadata` 首次访问从扩展目录 `extension.yaml` 解析并缓存；目录优先取 `set_extension_dir` 的显式值，否则从子类模块文件位置推断（仅当旁边恰有 extension.yaml），都取不到抛 `ValueError`，清单文件缺失抛 `FileNotFoundError`；`set_extension_dir` 同时清空 metadata 与 config.yaml 两个缓存。
  - 见 [sdk/base.py L38-114](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/sdk/base.py#L38-L114)。

### Registry：单例、槽位替换与 hook 分发

- `ExtensionRegistry` 是单槽单例：初始化前 `get_instance`、重复 `create_instance` 都抛 `RuntimeError`。AgentServerClient / CryptoUtility / ThirdAgent 三个扩展点是单槽属性，**后注册直接覆盖、不报错**；应用插件按 `plugin_id`（空值回退 `metadata.id`）存字典，id 为空或重复注册抛 `ValueError`。`reset_instance` 同时清掉注入到 `common.security.base_crypto` 的 crypto 桥。
  - 见 [registry.py L101-151](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/registry.py#L101-L151)、
  - [L125-129](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/registry.py#L125-L129)。
- `create_instance` 把 `_RegistryCryptoBridge` 装进 `base_crypto` 全局钩子（common/config 的 api_key 解密入口）。桥按调用时点解析 crypto 扩展；未注册时 encrypt/decrypt **原样返回输入**（回退明文，不抛错），供调用方继续处理原文。
  - 见 [registry.py L33-51](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/registry.py#L33-L51)、
  - [L121-122](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/registry.py#L121-L122)。
- hook 分发委托 openjiuwen 的 `AsyncCallbackFramework`：`register` = `register_sync(event, handler, priority=100)`；`unregister` 走兼容 shim（openjiuwen<0.1.9 没有 `unregister_sync`，shim 还按 `__wrapped__` 解装饰器匹配，callback 为 None 时直接返回）；
  - `trigger` 区分三种载荷——context+kwargs、仅 context、仅 kwargs（context 为 None 且有 kwargs 时只传 kwargs）。见 [registry.py L204-223](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/registry.py#L204-L223)、
  - [callback_compat.py L9-52](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/callback_compat.py#L9-L52)。

### 应用插件绑定、前端贡献与资源挂载

- 该工作流的职责、顺序、错误边界与源码入口见[[jiuwenswarm-application-plugins]]（应用插件绑定、前端贡献与资源挂载）。

### 进程生命周期与关闭

- Gateway `run()`：`create_instance` → `ExtensionManager` → `load_all_extensions()`（含 transport 扩展）→ 从 registry 取 AgentServerClient 扩展，取不到回退内置 WebSocket 客户端；clawee FaaS 入口同样 create + 全量加载。
  - 见 [app_gateway.py L1843-1868](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/app_gateway.py#L1843-L1868)。
- Runtime 直连在进程锁内做借用判定：AgentServer/Gateway 已预加载 registry 时 Runtime 只借用、不参与其生命周期（直接返回）；否则自建并 `load_all_extensions(include_transport_extensions=False)`。加载失败时先 `shutdown_all_extensions`，再在"当前单例仍是自己"时 `reset_instance`；清理自身失败只记 warning，原始加载异常保留并重抛。
  - 释放按 `_PROCESS_RUNTIME_EXTENSION_USERS` 引用计数，最后一个使用者才关闭并重置。见 [runtime/service.py L215-293](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/runtime/service.py#L215-L293)。
- `shutdown_all_extensions` 按加载顺序逐个 `await ext.shutdown()`（仅当对象有该方法），单个失败记 warning 后继续，最后清空列表——一个扩展关闭抛错不会阻断其余扩展。见 [manager.py L111-118](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/manager.py#L111-L118)。

### 怎样验证

- `tests/unit_tests/test_extension_manager.py` — 搜索路径拼接与去重（`test_extension_dirs_*`）、transport 标志严格布尔、registry 类型注解无 transport 导入（`test_registry_type_hints_resolve_without_transport_imports`）。
- `tests/unit_tests/test_application_plugins.py` — 禁用门禁与 `APPLICATION_PLUGIN_DISABLED`、WS 路由用运行时 plugin_id、manifest-only iframe 插件加载→清单→资产 200 的进程内链路（`test_manifest_only_iframe_plugin_requires_no_python_entry`）。
- 本页结论来自 pinned 源码静态核对；未运行上述测试，也未做浏览器或 FaaS 环境验证。`tests/unit_tests/server/extensions/` 是服务端设备包（equipment）测试，不属于本 owner。
- **相关页面**
- [[jiuwenswarm-extensions-agentos]]（AgentOS 扩展）、[[jiuwenswarm-extensions-video-duplex]]（视频全双工扩展） — 两个真实扩展/应用插件实现
- [[jiuwenswarm-runtime]]（共享 Agent Runtime） — Runtime 直连借用/自建 registry 的调用方
- [[extensions-plugins-rules]]（video_duplex 审查规则）
- **路由**
- `jiuwenswarm/extensions/agent_client/`
- `jiuwenswarm/extensions/application_host.py`
- `jiuwenswarm/extensions/callback_compat.py`
- `jiuwenswarm/extensions/clawee.py`
- `jiuwenswarm/extensions/hook_event.py`
- `jiuwenswarm/extensions/hooks_context.py`
- `jiuwenswarm/extensions/loader.py`
- `jiuwenswarm/extensions/manager.py`
- `jiuwenswarm/extensions/registry.py`
- `jiuwenswarm/extensions/sdk/`
- `jiuwenswarm/extensions/types.py`
- `jiuwenswarm/extensions/yuanrong_frontend_client.py`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/jiuwenswarm-extensions.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/manager.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/loader.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/registry.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/application_host.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/sdk/base.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/sdk/application_plugin.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/callback_compat.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/web/web_channel_app.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/app_gateway.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/runtime/service.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_extension_manager.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/test_application_plugins.py
