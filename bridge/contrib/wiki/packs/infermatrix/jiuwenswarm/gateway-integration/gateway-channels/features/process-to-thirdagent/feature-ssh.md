---
name: feature-ssh
description: SSH 频道与远程终端（ssh_connect.py）职责、接口与配置：SshChannel/SshChannelConfig/SshAuthConfig/SshRelaySession 入口、config/router/key_registry 构造参数、认证与会话绑定分层取舍、已登记与未登记密钥验证步骤
metadata:
  scope: 只收 SSH 频道的入口职责、API 定位、构造参数、设计推断、关联功能与建议验证；逐函数实现与单测断言归 feature-depth-ssh
---
# SSH 频道与远程终端 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-ssh.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/频道.md
- 源页字段（feature）：ssh
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py；jiuwenswarm/gateway/channel_manager/protocol/ssh/*.py；jiuwenswarm/extensions/agentos/auth/ssh_authenticator.py；jiuwenswarm/extensions/agentos/auth/ssh_key_issuer.py
  - jiuwenswarm/extensions/agentos/auth/ssh_key_registry.py；jiuwenswarm/extensions/agentos/agentos_router/router_client.py；jiuwenswarm/extensions/agentos/agentos_router/ssh_relay.py；jiuwenswarm/extensions/agentos/auth/common.py
  - jiuwenswarm/extensions/agentos/auth/credential_authenticator.py；jiuwenswarm/gateway/app_gateway.py；jiuwenswarm/gateway/channel_manager/protocol/ssh/__init__.py；jiuwenswarm/gateway/channel_manager/protocol/ssh/config.py
  - jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- SSH 频道拥有独立的配置、密钥登记和服务入口。认证成功与 Agent 会话绑定成功是不同阶段，远程终端权限需要和宿主策略一起验证。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L1–L363](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L1-L363)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `SshRelaySession [cancel_relay]`；`SshAuthConfig [from_dict]`；`SshChannelConfig [to_proxy_config, from_dict]`；`SshChannel [channel_id, clients, key_registry, authenticator, key_issuer]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L1–L363](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L1-L363)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)。

### 配置入口与生效条件

- 该源码入口的构造或调用参数包括 `config`、`router`、`key_registry`；它们是调用参数，不自动等同于全仓持久配置键。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L1–L363](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L1-L363)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)。

### 设计取舍

- **设计推断**：SSH 作为独立频道复用网关消息处理，提供远程终端入口；代价是 SSH 认证、密钥与内部会话绑定分属不同层。认证成功只说明传输可建立，Agent 工具是否可执行仍受工作区与权限策略控制。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L1–L363](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L1-L363)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)。

### 数据流与关联功能

- SSH 频道拥有独立的配置、密钥登记和服务入口。认证成功与 Agent 会话绑定成功是不同阶段，远程终端权限需要和宿主策略一起验证。 联调时结合[[feature-e2a]]（E2A 统一请求响应协议）、[[feature-cli]]（交互式命令行）、[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L1–L363](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L1-L363)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)。

### 怎样验证

- 使用已登记与未登记密钥分别连接，核对认证、终端输入与会话回复。覆盖断开重连、取消和不同用户身份，验证工具权限与会话绑定没有被 SSH 登录状态绕过。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L1–L363](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L1-L363)；
  - [docs/zh/频道.md:L1–L115](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E9%A2%91%E9%81%93.md#L1-L115)。
