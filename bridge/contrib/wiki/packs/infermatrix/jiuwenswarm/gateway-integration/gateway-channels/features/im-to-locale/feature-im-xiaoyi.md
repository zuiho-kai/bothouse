---
name: feature-im-xiaoyi
description: 小艺频道（xiaoyi_connect.py）职责、接口与配置：XiaoyiChannelConfig 字段 mode/ak/sk/agent_id/ws_url1/ws_url2/uid/api_key、XYFileUploadService 与 get_xiaoyi_channel 入口、A2A 客户端与推送取舍、验证步骤
metadata:
  scope: 只收小艺频道的入口职责、API 定位、配置字段、设计推断、关联功能与建议验证；逐函数实现与单测断言归 feature-depth-im-xiaoyi
---
# 小艺 频道 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/feature-im-xiaoyi.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/国内频道.md
- 源页字段（feature）：im-xiaoyi
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py；jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/*；jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/formatter.py
  - jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/media.py；jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_utils/push.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 小艺 适配器连接平台消息、身份和内部网关。平台事件接收、消息标准化与回复交付分别依赖该适配器的配置和连接，其他频道成功不能替代本频道验证。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L1–L2119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L1-L2119)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `get_xiaoyi_channel(channel_id)`；`DataEvent`；`XiaoyiChannelConfig`；`XYFileUploadService [upload_file]`；`XiaoyiChannel [channel_id, app_id, gui_tool_lock, clients, on_message]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L1–L2119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L1-L2119)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 配置入口与生效条件

- 本平台源码配置类型 `XiaoyiChannelConfig` 声明的字段包括 `enabled`、`channel_id`、`mode`、`ak`、`sk`、`agent_id`、`ws_url1`、`ws_url2`、`enable_streaming`、`uid`、`api_key`。它们是本适配器实际消费的字段；如何填入 channels 配置和平台侧权限按文档中本平台章节核对。值、默认值与 credential 文件状态需要分别确认，其他平台的示例不能替代该配置。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L1–L2119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L1-L2119)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 设计取舍

- **设计推断**：小艺 A2A 客户端将平台请求转入内部执行链，同时保留推送和文件上传入口；代价是开放平台凭据、应用发布、WebSocket 与推送配置需要相互一致。平台白名单和内部用户授权分别生效，通道连接不代表结果推送已可用。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L1–L2119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L1-L2119)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 数据流与关联功能

- 小艺 适配器连接平台消息、身份和内部网关。平台事件接收、消息标准化与回复交付分别依赖该适配器的配置和连接，其他频道成功不能替代本频道验证。 联调时结合[[feature-e2a]]（E2A 统一请求响应协议）、[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）、[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L1–L2119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L1-L2119)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。

### 怎样验证

- 完成开放平台应用绑定后的请求、流式回复与推送闭环，核对 agent 和用户身份。覆盖无效 AK/SK、白名单、超时、双地址连接与附件上传，检查取消后任务和会话资源收尾。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py:L1–L2119](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/im_platforms/xiaoyi/xiaoyi_connect.py#L1-L2119)；
  - [docs/zh/国内频道.md:L1–L621](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%9B%BD%E5%86%85%E9%A2%91%E9%81%93.md#L1-L621)。
