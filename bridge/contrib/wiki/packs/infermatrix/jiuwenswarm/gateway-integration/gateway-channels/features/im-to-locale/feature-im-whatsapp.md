---
name: feature-im-whatsapp
description: WhatsApp 频道（whatsapp_connect.py）职责、接口与配置：WhatsAppChannelConfig 字段 bridge_ws_url/auto_start_bridge/bridge_command/bridge_workdir/bridge_env/default_jid、本地 Baileys Node bridge 与 bridge_connected/qr_pending 取舍、验证步骤
metadata:
  scope: 只收 WhatsApp 频道的入口职责、API 定位、配置字段、设计推断、关联功能与建议验证；逐函数实现细节归 feature-depth-im-whatsapp
---
# WhatsApp 频道 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-im-whatsapp.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/海外频道.md
- 源页字段（feature）：im-whatsapp
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/*；jiuwenswarm/scripts/whatsapp-bridge.js
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- WhatsApp 适配器连接平台消息、身份和内部网关。平台事件接收、消息标准化与回复交付分别依赖该适配器的配置和连接，其他频道成功不能替代本频道验证。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L1–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L1-L503)；
  - [docs/zh/海外频道.md:L1–L635](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L1-L635)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `WhatsAppChannelConfig`；`WhatsAppChannel [channel_id, clients, on_message, start, stop]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L1–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L1-L503)；
  - [docs/zh/海外频道.md:L1–L635](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L1-L635)。

### 配置入口与生效条件

- 本平台源码配置类型 `WhatsAppChannelConfig` 声明的字段包括 `enabled`、`enable_streaming`、`bridge_ws_url`、`allow_from`、`default_jid`、`auto_start_bridge`、`bridge_command`、`bridge_workdir`、`bridge_env`。它们是本适配器实际消费的字段；如何填入 channels 配置和平台侧权限按文档中本平台章节核对。值、默认值与 credential 文件状态需要分别确认，其他平台的示例不能替代该配置。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L1–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L1-L503)；
  - [docs/zh/海外频道.md:L1–L635](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L1-L635)。

### 设计取舍

- **设计推断**：Python 频道通过本地 Baileys Node bridge 收发 WhatsApp Web 消息，复用一套本地网关；代价是 Python 到 bridge 和 bridge 到 WhatsApp 是两条连接。bridge_connected、qr_pending 与真实登录在线不同，不能用 bridge WebSocket 可达宣称 WhatsApp 已能收发。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L1–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L1-L503)；
  - [docs/zh/海外频道.md:L1–L635](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L1-L635)。

### 数据流与关联功能

- WhatsApp 适配器连接平台消息、身份和内部网关。平台事件接收、消息标准化与回复交付分别依赖该适配器的配置和连接，其他频道成功不能替代本频道验证。 联调时结合[[feature-e2a]]（E2A 统一请求响应协议）、[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）、[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L1–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L1-L503)；
  - [docs/zh/海外频道.md:L1–L635](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L1-L635)。

### 怎样验证

- 启动 bridge 后验证二维码登录、认证恢复与消息闭环，分别观察两条连接状态。覆盖登出、需要重新扫码、bridge 退出和重连，核对 JID 目的地、用户白名单和未实现能力的边界。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py:L1–L503](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/whatsapp/whatsapp_connect.py#L1-L503)；
  - [docs/zh/海外频道.md:L1–L635](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E6%B5%B7%E5%A4%96%E9%A2%91%E9%81%93.md#L1-L635)。
