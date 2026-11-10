---
name: source-contracts-08
description: common-rails 源码接口与集成边界 08：retrieval_context_processor.py、tool_stream_events.py
metadata:
  scope: 只收 common/rails/symphony 下 retrieval_context_processor.py 至 tool_stream_events.py 共 2 个源码文件的静态声明（接口、类型、依赖与源码依据链接）；同目录其余契约页是 common-rails-contracts-01、common-rails-contracts-02、common-rails-contracts-03、common-rails-contracts-04、common-rails-contracts-05、common-rails-contracts-06、source-contracts-07
---
# common-rails 源码接口与集成边界 08

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/common/rails/symphony/retrieval_context_processor.py`**
- 源码对模块职责的说明：Project consumed Symphony retrieval results out of model context windows.。
- `SymphonyRetrievalCompactProcessorConfig` 继承 `BaseModel`。
- `SymphonyRetrievalCompactProcessor` 继承 `ContextProcessor`；方法入口：`config`, `trigger_get_context_window`, `on_get_context_window`。
- 调用入口 `symphony_retrieval_compact_processor_spec()`；声明返回 `tuple[str, SymphonyRetrievalCompactProcessorConfig]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import ast`；`import json`；`from typing import Any`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/symphony/retrieval_context_processor.py#L1-L240)。
- **`jiuwenswarm/agents/harness/common/rails/symphony/tool_stream_events.py`**
- 源码对模块职责的说明：Streaming lifecycle support for Symphony orchestration tools.。
- `SymphonyToolStreamHandler` 定义类型边界；方法入口：`matches`, `bind_progress`, `reset_progress`, `enrich_result_payload`, `request_force_finish`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`from typing import Any`；`from openjiuwen.core.session.agent import Session`；`from openjiuwen.core.session.stream import OutputSchema`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/common/rails/symphony/tool_stream_events.py#L1-L124)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/common-rails/source-contracts-08.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
