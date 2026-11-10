---
name: feature-web-chat-2
description: Web 对话与流式状态功能概览（下）：设计取舍（流式展示与最终结果不是同一事件）、数据流与关联功能（web-navigation、projects-sessions、e2a）、怎样验证
metadata:
  scope: 只收设计取舍、数据流关联与验证三节；职责、API 与配置入口归 feature-web-chat-1；实现细节归 feature-depth-web-chat
---
# Web 对话与流式状态 的职责、接口与配置（2/2）

## 关键事实

- 拆分说明：本页是源页 `feature-web-chat.md` 的第 2/2 部分；第 1 部分 [[feature-web-chat-1]]
- 源页：`knowledge/repos/jiuwenswarm/components/web-frontend/feature-web-chat.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01

### 设计取舍

- **设计推断**：Web 前端通过流式事件展示执行过程，让用户在长任务中观察与补充要求；代价是界面需要处理连接和运行状态的异步变化。消息显示完成、最终执行结果与后台资源清理不是同一个事件，取消应沿请求和会话身份验证。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/对话.md:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AF%B9%E8%AF%9D.md#L1-L312)。

### 数据流与关联功能

- Web 客户端管理消息输入、流式展示与运行状态，后端负责真正的会话执行。界面显示的状态需要和服务端事件、会话标识一起解释。 联调时结合[[feature-web-navigation]]（Web 页面与功能入口）、[[feature-projects-sessions-1]]、[[feature-projects-sessions-2]]（项目、会话与历史管理）、[[feature-e2a]]（E2A 统一请求响应协议）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/对话.md:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AF%B9%E8%AF%9D.md#L1-L312)。

### 怎样验证

- 发送带工具调用的任务，检查消息流、工具状态和最终结果关联到同一会话。覆盖发送中断、断连恢复、执行中补充要求和取消，验证切换视图后返回仍能解释当前运行状态。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts:L1–L5652](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/web/frontend/src/hooks/useWebSocket.ts#L1-L5652)；
  - [docs/zh/对话.md:L1–L312](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/%E5%AF%B9%E8%AF%9D.md#L1-L312)。
