---
name: gateway-channels-design-tradeoffs
description: 进程式 CLI 的设计取舍：直接复用 Runtime（InProcessRuntimeClient）、结果可见与 AFTER_RESULT_DELIVERY 提交时点分开、process_cli 频道归属边界，基线 f0a69728c96b
metadata:
  scope: 只收设计推断与代价说明；机器执行与租约见 jiuwenswarm-process-cli-machine，交互与渲染入口见 jiuwenswarm-channels-process-cli，规则见 gateway-channels-rules
---
# CLI 与会话结果交付的设计取舍

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/gateway-channels/design-tradeoffs.md`（InferMatrixCopilot@ecfb84d0）；type: guide；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
- 来源（sources）：openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/client.py；openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:jiuwenswarm/channels/process_cli/app.py
  - openJiuwen-ai/jiuwenswarm@f0a69728c96b5961d993449f1a901cbd2f4dac5b:tests/unit_tests/process_cli/test_process_cli.py
- 本页解释该组件的设计选择、代价与适用边界。基线为 `f0a69728c96b`。收益和替代方案分析标为**设计推断**，不把推断当成作者历史意图，也不代替规则页。

### 进程式 CLI 直接复用 Runtime

- InProcessRuntimeClient 是不承载 socket 或线路协议的薄适配层。**设计推断**：本地调用复用 Runtime 公共契约并减少传输适配工作；相应地，调用进程承担 Runtime 启停与资源收尾。不能由这种边界推断本地调用与 WebSocket 服务具有相同的持久进程生命期。
- 源码依据：[jiuwenswarm/channels/process_cli/client.py:L73–L87](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/client.py#L73-L87)。

### 结果可见时点与提交时点分开

- session.create 的结果先渲染、写父进程结果文件，再执行 AFTER_RESULT_DELIVERY 提交；提交异常在这一分支记录为 warning。**设计推断**：保持已有父 REPL 的结果交付顺序，但“已看到成功结果”与“后续提交成功”不是同一事实。这里不能承诺输出和提交具有原子性；switch/fork 的时序应分别查看原实现。
- 源码依据：[jiuwenswarm/channels/process_cli/app.py:L270–L321](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/app.py#L270-L321)。

### 会话归属由本地边界保留

- 客户端固定 process_cli 频道标识，并给越界调用稳定的失败码。**设计推断**：共享 Runtime 可服务多种宿主，同时调用方仍能检查自己的频道范围；代价是每个适配器需要维护本身的边界校验，不能因为底层相同就混用宿主上下文。
- 源码依据：[jiuwenswarm/channels/process_cli/client.py:L11–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/channels/process_cli/client.py#L11-L25)。

### API、配置与数据流入口

- 会话操作和机器模式 API 见[[jiuwenswarm-process-cli-machine]]（机器执行与租约），交互、事件渲染与参数入口见[[jiuwenswarm-channels-process-cli]]（进程式 CLI）。

### 关联功能

- 准备/提交/中止的公共租约来自 [[agent-runtime-overview]]（Runtime），模型和权限配置由 [[common-core-overview]]（common-core） 提供。

### 怎样验证

- [tests/unit_tests/process_cli/test_process_cli.py:L1–L25](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/tests/unit_tests/process_cli/test_process_cli.py#L1-L25)
- 这些入口用于查找既有验证范围；源码阅读没有替代运行测试或真实服务验证。
