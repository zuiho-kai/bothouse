---
name: feature-a2a
description: A2A 接入与 AgentCard 功能知识：职责边界、接口入口 a2a_connect.py、enabled 配置条件、设计取舍、数据流与验证方式
metadata:
  scope: 只收 A2A 入站接入的概览；逐文件实现细节归 feature-depth-a2a，E2A 与 ACP 归 feature-e2a、feature-acp
---
# A2A 接入与 AgentCard 的职责、接口与配置

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/protocols/feature-a2a.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:docs/zh/A2A.md
- 源页字段（feature）：a2a
- 入口（entry_points）：jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py
- 源页字段（source_globs）：jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py；jiuwenswarm/gateway/channel_manager/protocol/a2a/*.py；jiuwenswarm/gateway/app_gateway.py
- 本页是该功能的基本知识入口，基线 `f0a69728c96b`。它连接源码契约与上游功能文档；详细字段和行为仍沿固定引用核对。

### 职责与边界

- 网关将 A2A 请求与消息格式转换为内部执行入口，再投影响应。入站接入、能力声明与 Agent 主动调用远端是不同能力，不能由入站可用推断出站已接线。 本页记录入口职责与边界；逐文件的类型、函数和依赖关系见同 owner 的源码接口记录。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L1–L595](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L1-L595)；
  - [docs/zh/A2A.md:L1–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L1-L165)。

### 接口与调用入口（API）

- 可定位的实现声明包括 `A2AChannelConfig`；`A2AChannel [channel_id, on_message, start, stop, send]`。这些是源码定位入口，具体公共用户操作沿功能文档查证；本页不把内部符号直接当成稳定 HTTP API。参数、返回类型、错误传播和生命周期应在所列实现与调用方一起核对。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L1–L595](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L1-L595)；
  - [docs/zh/A2A.md:L1–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L1-L165)。

### 配置入口与生效条件

- 文档中的调用选项包括 `--host`、`--extra`，适用命令与前置条件沿文档确认。 修改设置时还要检查配置加载位置与本功能的装配或连接时机，不能只由“保存成功”判断当前运行实例已经采用新值。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L1–L595](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L1-L595)；
  - [docs/zh/A2A.md:L1–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L1-L165)。

### 设计取舍

- **设计推断**：入站 A2A 适配复用内部 Message 与 E2A，便于外部客户端接入同一执行链；代价是 Task 事件与内部流式状态需要准确投影。AgentCard 描述、入站请求和 Agent 主动调用外部 A2A 是不同能力，不能由一项通过推断其他项已接线。以上分析从所列接口与功能边界得出，不宣称作者曾评估所有替代方案。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L1–L595](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L1-L595)；
  - [docs/zh/A2A.md:L1–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L1-L165)。

### 数据流与关联功能

- 网关将 A2A 请求与消息格式转换为内部执行入口，再投影响应。入站接入、能力声明与 Agent 主动调用远端是不同能力，不能由入站可用推断出站已接线。 联调时结合[[feature-e2a]]（E2A 统一请求响应协议）、[[feature-acp]]（ACP 与 stdio 桥接）、[[feature-permissions-1]]、[[feature-permissions-2]]（工具权限与安全治理）的入口、数据归属和生效条件查证；这些关联页解释不同阶段，不能只凭一项成功判定整个链路完成。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L1–L595](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L1-L595)；
  - [docs/zh/A2A.md:L1–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L1-L165)。

### 怎样验证

- 查询 AgentCard 并发送流式与非流式请求，核对请求映射、Task 状态和 artifact 结果。覆盖不支持的方法、取消与身份关联；需要出站能力时再检查独立配置和调用闭环。这些是建议的验收步骤，本页没有记录上游运行测试已执行或已通过。
- 源码与文档：[jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py:L1–L595](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/gateway/channel_manager/protocol/a2a/a2a_connect.py#L1-L595)；
  - [docs/zh/A2A.md:L1–L165](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/docs/zh/A2A.md#L1-L165)。
