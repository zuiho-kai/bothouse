---
name: jiuwenswarm-extensions-agentos
description: AgentOS 扩展文件导览：AgentOSRouter 把请求路由到 YuanRong 沙箱 Agent，extension.py、router_client.py、agent_manager.py、ssh_relay.py、auth/ 下 SSH/Token 鉴权各文件职责
metadata:
  scope: 只收 AgentOS 扩展的读码入口与关键文件清单；扩展框架归 jiuwenswarm-extensions，视频全双工扩展归 jiuwenswarm-extensions-video-duplex
---
# AgentOS 扩展：AgentOS Router 与 SSH/Token 鉴权

## 现状

- 该扩展由 ExtensionLoader 发现并加载。它的 AgentOSRouter 同时实现 AgentServerClient 和 ThirdAgent 扩展，把 Gateway 请求按用户/会话键路由到 YuanRong 沙箱里的 Agent 实例，管理实例的创建、复用、释放、删除，以及重启后残留沙箱的清理，并通过 registry HTTP API 登记这些实例。auth/ 子目录提供 WebSocket 握手鉴权、AgentOS token 鉴权、临时 SSH 密钥签发和指纹登记，南向 SSH 中继依赖这些功能。
- **从这里读起**
- `jiuwenswarm/extensions/agentos/extension.py` — 扩展入口，ExtensionLoader 从这里发现 AgentOS 扩展
- `jiuwenswarm/extensions/agentos/agentos_router/extension.py` — AgentOSRouter 与 register_extensions：负责初始化、提供 client 和 third agent、注入 key issuer、关闭
- `jiuwenswarm/extensions/agentos/agentos_router/router_client.py` — AgentOSRouterClient：请求路由、HTTP 鉴权、频道事件、连接预热与延迟清理、文件上传下载路径
- **关键文件**
- `jiuwenswarm/extensions/agentos/agentos_router/agent_manager.py` — AgentManager/AgentRuntime：按键 get_or_create、状态流转（creating/ready/failed/deleted）、空闲回收、用户连接计数
- `jiuwenswarm/extensions/agentos/agentos_router/registry_client.py` — registry HTTP SDK：镜像 launch-spec/list，实例 register/update/list/unregister；endpoint 为空时只在本地运行
- `jiuwenswarm/extensions/agentos/agentos_router/ssh_relay.py` — YuanrongSshRelay：把北向 SshRelaySession 桥接到 YuanRong 前端 SSH 端点
- `jiuwenswarm/extensions/agentos/agentos_router/stale_cleanup.py` — 启动时对照 registry 销毁上个进程留下的沙箱，并跳过已有的 live runtime
- `jiuwenswarm/extensions/agentos/agentos_router/config.py` — RouterConfig 与 SSH 通道端点配置加载，含环境变量覆盖和数值校验
- `jiuwenswarm/extensions/agentos/agentos_router/third_agent.py` — AgentOSThirdAgent：列出和切换第三方 Agent 类型
- `jiuwenswarm/extensions/agentos/agentos_router/agentos_authenticator.py` — AgentOSAuthenticator：调用外部 auth service 校验 token
- `jiuwenswarm/extensions/agentos/agentos_router/models.py` — AgentStatus、ImageInfo、AgentInfo 数据模型
- `jiuwenswarm/extensions/agentos/auth/common.py` — WebSocket 握手鉴权工具：提取 token 和请求头，缓存握手结果并写回 ws
- `jiuwenswarm/extensions/agentos/auth/ssh_key_issuer.py` — 签发短期 SSH 密钥对，并把公钥指纹登记到 KeyRegistry
- `jiuwenswarm/extensions/agentos/auth/ssh_authenticator.py` — SshPublicKeyAuthenticator：通过 KeyRegistry 校验公钥指纹
- `jiuwenswarm/extensions/agentos/agentos_router/logutil.py` — 格式固定、便于 grep 的 AgentOS 日志行（session_id/sandbox_id 字段）
- **相关文档**
- `docs/zh/E2A-protocol.md` — 改动涉及 AgentRuntime.attach_to_envelope 或路由用到的 E2AEnvelope 字段时读
- `docs/zh/AgentTeam.md` — 改动涉及 router_client 的 team 模式判断时读
- **路由**
- `jiuwenswarm/extensions/agentos/`

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/extensions-plugins/jiuwenswarm-extensions-agentos.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-09-30；updated: 2026-09-30
