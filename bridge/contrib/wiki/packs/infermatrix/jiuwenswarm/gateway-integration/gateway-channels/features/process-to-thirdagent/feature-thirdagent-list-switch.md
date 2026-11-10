---
name: feature-thirdagent-list-switch
description: 3rdagent.list / 3rdagent.switch 第三方智能体切换（router_client.py）：多层 fail-fast 与 SSH 就绪等待取舍、ThirdAgent 契约与错误码（BAD_REQUEST/UNSUPPORTED/SSH_ENDPOINT_UNAVAILABLE/SSH_NOT_READY）、channels.ssh 前提配置、list/switch 数据流、builtin jiuwenswarm 捷径
metadata:
  scope: 只收第三方智能体切换的设计取舍、契约与路由实现、前提配置、数据流与支持行为；逐分支断言与单测观察归 feature-depth-thirdagent-list-switch
---
# 3rdagent.list / 3rdagent.switch 第三方智能体切换

## 现状

- **设计取舍**
- switch 采用多层 fail-fast：在创建 sandbox 之前先校验 SSH 端点和密钥签发，注释明示理由——没有密钥客户端过不了公钥认证，"成功"的 switch 也无法使用。就绪等待采取保守策略：代码注释指出 create 返回不代表端口探针成功，先等 GET status=running 再探南向 SSH，避免 sshd 未监听时立刻掐断连接；实例确认不存在/停止时强制清理残留 runtime，让下次 switch 能重建（sshd 未就绪则仍走保守的 SSH_NOT_READY 分支）。
  - 契约下沉到 `common/client` 并在 gateway 侧 re-export，是保留侧与 Gateway 仓共用契约、又保持旧 import 路径兼容的折中（module docstring 自述）。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1893–L1909](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1893-L1909),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1947–L1975](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1947-L1975),
  - [jiuwenswarm/gateway/routing/third_agent.py:L3–L7](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/routing/third_agent.py#L3-L7)
- **验证入口**
- Inference / 设计推断（非作者历史意图）：
- 在本次提供的源码片段中没有出现针对 `thirdagent_list` / `thirdagent_switch` 的测试代码，无法从所示证据确认测试入口或覆盖情况。可观察的行为锚点（可用于人工或测试验证）：空 user_id 的 `BAD_REQUEST` 返回、`UnsupportedThirdAgent` 的 `UNSUPPORTED` 返回、以及 builtin swarm 路径不创建 sandbox 而直接返回 READY payload。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1878–L1896](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1878-L1896),
  - [jiuwenswarm/common/client/third_agent.py:L63–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L63-L82),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1910–L1921](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1910-L1921)
- **ThirdAgent 契约与路由实现**
- `ThirdAgent` 是南北向共用抽象契约（Gateway 仓另持副本），声明 `thirdagent_list(user_id, current_agent_type, access_mode)` 与 `thirdagent_switch(user_id, agent_type, session_id, params)` 两个抽象方法；`UnsupportedThirdAgent` 作为无扩展注册时的默认实现，两个方法均返回 `ok=False`、`code="UNSUPPORTED"`。
  - AgentOSRouter 的实现里，空 `user_id` 返回 `BAD_REQUEST`，非法 `agent_type` 规范化失败返回 `UNSUPPORTED_AGENT_TYPE`，agent 创建类异常映射为 `INTERNAL_ERROR`。switch 成功 payload 含 `agent_id/agent_type/sandbox_id/status` 并合并 SSH 端点字段；仅当配置了密钥签发器时才附加 `ssh_private_key` 字段，未注入签发器时 `_ephemeral_ssh_key_fields` 返回空映射。
- Sources / 来源：[jiuwenswarm/common/client/third_agent.py:L24–L49](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L24-L49),
  - [jiuwenswarm/common/client/third_agent.py:L52–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L52-L82),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1878–L1896](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1878-L1896),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2013–L2021](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2013-L2021)
- **运行前提配置**
- switch 依赖北向 SSH 频道配置：`_ssh_endpoint_fields` 从 `channels.ssh` 的 listen ip/port 生成 `ssh_ip`/`ssh_port`，缺失或不合法（空 ip 或端口 ≤0）时在创建 sandbox 之前 fail-fast，返回 `SSH_ENDPOINT_UNAVAILABLE`，错误信息指明需启用 `channels.ssh` 并设置 `listen_host`/`listen_port`。
  - 临时密钥签发同样可配置：`_key_issuer` 未注入时返回空映射（auth 关闭），注入时用 `self._ephemeral_key_ttl_sec` 作为 TTL 调 `issue_ephemeral_key`，失败抛 `EphemeralKeyIssueError` 并映射为 `SSH_KEY_ISSUE_FAILED`。外部 agent 的 SSH 私钥文件路径默认取 `DEFAULT_CLIENT_KEYS_DIR` 模板，经 `resolve_client_keys_dir(template, user_id)` 解析后拼接 `id_ed25519`。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1844–L1864](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1844-L1864),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2019–L2036](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2019-L2036),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1790–L1796](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1790-L1796)
- **契约分层与 list/switch 数据流**
- 契约分层：`ThirdAgent` 抽象（含 `normalize_agent_type`）下沉在 `jiuwenswarm/common/client/third_agent.py`，作为保留侧与 Gateway 仓共用的南北向契约；`jiuwenswarm/gateway/routing/third_agent.py` 仅 re-export 同一组符号以保持旧 import 路径兼容。
  - 运行时实现位于 `AgentOSRouterClient`：`thirdagent_list` 以 user_id 从 registry 的 `list_user_images` 取镜像，经 metadata（`name`/`agent_type`/`access_mode`）组装 `{agent_type, cmd}` 条目并附 `current_agent_type`；
  - `thirdagent_switch` 依次校验 user_id、agent_type 规范化、北向 SSH 端点与临时密钥签发，然后或走 builtin 捷径（通过上述检查后仅记录 `_current_agent_types[uid]` 并返回 READY payload，不创建 sandbox），或经 `_agent_manager.get_or_create_agent` 复用/创建 runtime。当 `self._ssh_relay` 存在且实例确认不可用时，清理残留 runtime 后返回 `SSH_NOT_READY`；
  - 随后在 `_current_agent_types[uid]` 记录当前类型，成功 payload 合并 runtime info 与 `ssh_fields`/`key_fields`。
- Sources / 来源：[jiuwenswarm/common/client/third_agent.py:L3–L15](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L3-L15),
  - [jiuwenswarm/gateway/routing/third_agent.py:L3–L17](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/routing/third_agent.py#L3-L17),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1817–L1842](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1817-L1842),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1910–L1929](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1910-L1929)
- **支持的切换行为与依赖**
- `thirdagent_switch` 确保 (user_id, agent_type) 的 runtime 存在但不转发聊天：builtin `jiuwenswarm` 类型走捷径，仅更新 `_current_agent_types[uid]` 并返回空 agent_id/sandbox_id 的 READY payload，不创建沙箱；第三方类型经 `AgentManager.get_or_create_agent` 复用/创建实例。若配置了 SSH relay，switch 在返回前先等 YuanRong status=running 再探测南向 SSH。
  - 配套行为：E2A chat 请求路由到非 builtin 的 agent_type 时被拒绝，错误信息指明该类型不走 websocket、应改用 `3rdagent.switch` / SSH 接入。无扩展注册时 `UnsupportedThirdAgent` 对 list/switch 均返回 `UNSUPPORTED`。注意 `ssh_private_key` 字段仅在配置了密钥签发器且签发成功时出现，未注入签发器时成功 payload 不含该字段。
- Sources / 来源：[jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1866–L1921](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1866-L1921),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1602–L1608](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L1602-L1608),
  - [jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2007–L2021](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/extensions/agentos/agentos_router/router_client.py#L2007-L2021),
  - [jiuwenswarm/common/client/third_agent.py:L52–L82](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/common/client/third_agent.py#L52-L82)

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-thirdagent-list-switch.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-06；updated: 2026-10-07
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1893-L1909
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1947-L1975；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/routing/third_agent.py:L3-L7
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1878-L1896；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L63-L82
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1910-L1921；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L24-L49
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L52-L82；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2013-L2021
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1844-L1864
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2019-L2036
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1790-L1796；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/common/client/third_agent.py:L3-L15
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/routing/third_agent.py:L3-L17；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1817-L1842
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1910-L1929
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1866-L1921
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L1602-L1608
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/extensions/agentos/agentos_router/router_client.py:L2007-L2021
- 源页字段（feature）：thirdagent-list-switch
- 入口（entry_points）：jiuwenswarm/extensions/agentos/agentos_router/router_client.py
- 源页字段（source_globs）：jiuwenswarm/extensions/agentos/agentos_router/router_client.py；jiuwenswarm/common/client/third_agent.py；jiuwenswarm/gateway/routing/third_agent.py
