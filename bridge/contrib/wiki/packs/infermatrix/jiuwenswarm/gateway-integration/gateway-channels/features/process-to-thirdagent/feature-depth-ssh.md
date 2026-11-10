---
name: feature-depth-ssh
description: SSH 频道与远程终端实现深读：asyncssh 缺失与会话错误传播、SshChannel.start 启动路径、SshChannel 构造与 SSHProxy authenticator 优先级、ssh 包惰性导出、主机键 ssh-rsa 2048 自动生成、身份 metadata 与 relay 单测、SshChannelConfig.from_dict 缺省值
metadata:
  scope: 只收 SSH 频道的逐函数实现细节与行为断言；职责、API 总览与验证建议归 feature-ssh
---
# SSH 频道与远程终端：实现深读

## 现状

- [[feature-ssh]]（功能概览） · [[gateway-channels-overview]]（owner 入口）
- **缺依赖与会话错误的传播** SSHProxy.start 在 ASYNCSSH_AVAILABLE 为假且 import asyncssh 失败时调用 _raise_missing_asyncssh 抛出，服务不启动。会话期间抛出 asyncssh.Error 时，_handle_ssh_client 记录 error 日志，随后对 stdout 写入 "Proxy error: ..." 和 process.exit(1) 的尝试都包在吞掉异常的 try/except 中，因此输出与退出码是尽力而为；finally 仍会 await unregister_session。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L144–L149](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py#L144-L149),
  - [jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L273–L290](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py#L273-L290)
- **启用且 asyncssh 可导入时的 SshChannel.start 启动路径** SshChannel.start() 在 _running 已置位或 config.enabled 为假（记 "[SSHChannel] disabled by config" 日志）时直接返回；否则构建 SSHProxy 并 await start()——ASYNCSSH_AVAILABLE 为假且导入失败时经 _raise_missing_asyncssh 抛出——成功后置 _running=True、记录 started 日志并 await wait_closed()。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L163–L193](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L163-L193),
  - [jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L144–L171](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py#L144-L171),
  - [jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L180–L182](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py#L180-L182)
- **SshChannel 构造签名与 SSHProxy 的 authenticator 解析优先级** SshChannel(BaseChannel).__init__(config: SshChannelConfig, router: RobotMessageRouter, key_registry: KeyRegistry | None = None) 先经 super().__init__(config, router) 将 config 存为 self.config、router 存为 self.bus；
  - SSHProxy.__init__ 中显式传入的 authenticator 优先，否则由 key_registry 构造 SshPublicKeyAuthenticator，两者皆无则为 None。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L119–L138](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L119-L138),
  - [jiuwenswarm/gateway/channel_manager/base.py:L129–L136](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/base.py#L129-L136),
  - [jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L124–L141](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py#L124-L141)
- **ssh 包惰性导出：频道类延迟加载 ssh_connect，KeyRegistry 直接取自 auth 模块，未知名抛 AttributeError** 包 __getattr__：取 SshChannel/SshChannelConfig/SshAuthConfig 时才 import ssh_connect（其顶层引入 server.py 的 SSHProxy/SSHAgentHooks，server.py 再引入 ssh_authenticator、ssh_key_registry 与 ssh/config）；
  - 取 KeyRegistry 直接来自 extensions.agentos.auth.ssh_key_registry；其余名字抛 AttributeError，故包级导入不加载 ssh_connect。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/ssh/__init__.py:L1–L29](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/__init__.py#L1-L29),
  - [jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L18–L24](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L18-L24),
  - [jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L13–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py#L13-L18)
- **键路径无文件时才自动生成 ssh-rsa 2048 主机键；算法与键长硬编码** 设计推断（非作者历史意图）：
- _ensure_host_key 先 mkdir 父目录：键路径已存在即 read_private_key 复用，不存在才 generate_private_key("ssh-rsa", key_size=2048) 并落盘私钥与 .pub。收益：该不存在分支可就地补齐缺失的键文件；代价：算法与键长写死，ProxyConfig 仅 listen_host/listen_port/host_key_path 三个字段、无对应设置。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L184–L194](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py#L184-L194),
  - [jiuwenswarm/gateway/channel_manager/protocol/ssh/config.py:L14–L18](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/config.py#L14-L18)
- **运行时单测断言：身份 metadata 来自注册条目；relay 用例断言 relay_started/ran/exit_code** `test_handle_ssh_client_uses_authenticated_identity` 注册指纹 `SHA256:ok`、source=`tui_switch` 的 KeyRegistryEntry 后，断言捕获 metadata `username=="auth-user"`、`auth_source=="tui_switch"`；
  - relay 用例经 `send_request(_ssh_envelope(...))` 断言 `response.payload["status"]=="relay_started"`、`stub_relay.ran==[("ssh_alice_1234","sbx-1","alice")]` 且 `session.exit_code==0`（relay 以 stub 注入）。
- 来源：[tests/unit_tests/channel/test_ssh_channel.py:L205–L219](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_ssh_channel.py#L205-L219),
  - [tests/unit_tests/channel/test_ssh_channel.py:L279–L281](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/channel/test_ssh_channel.py#L279-L281),
  - [tests/unit_tests/extensions/test_agentos_ssh_relay.py:L392–L416](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/extensions/test_agentos_ssh_relay.py#L392-L416)
- **SshChannelConfig.from_dict 的显式缺省值与 auth 字典守卫** SshChannelConfig.from_dict 缺省 enabled=False、listen_port=2222、relay_timeout_sec=3600.0；auth 键非 dict 时以空字典调用 SshAuthConfig.from_dict，认证缺省 enabled=False、ephemeral_key_ttl_sec=300.0、ephemeral_key_type=ssh-ed25519、cleanup_interval_sec=60.0。
- 来源：[jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L54–L102](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py#L54-L102)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-depth-ssh.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-02；updated: 2026-10-02
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L144-L149；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L273-L290
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_ssh_channel.py:L205-L219；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/channel/test_ssh_channel.py:L279-L281
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/extensions/test_agentos_ssh_relay.py:L392-L416；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/__init__.py:L1-L29
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L18-L24；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L13-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L163-L193；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L144-L171
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L180-L182；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L119-L138
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/base.py:L129-L136；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L124-L141
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/server.py:L184-L194；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/config.py:L14-L18
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py:L54-L102
- 源页字段（feature）：ssh
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/protocol/ssh/ssh_connect.py；jiuwenswarm/gateway/channel_manager/protocol/ssh/*.py
