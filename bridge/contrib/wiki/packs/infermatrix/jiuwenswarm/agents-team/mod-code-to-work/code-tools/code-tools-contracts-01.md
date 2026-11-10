---
name: code-tools-contracts-01
description: code-tools 源码接口与集成边界 01：harness/code/tools 的 __init__ 与 code_todo_tools（CodeTodoCreateTool、CodeTodoListTool、CodeTodoGetTool、CodeTodoModifyTool）声明
metadata:
  scope: 只收 harness/code/tools 下两个文件的静态声明；todo 工具的描述与 schema 常量声明归 code-prompt-contracts-01
---
# code-tools 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/agents/harness/code/tools/__init__.py`**
- 集成依赖（导入声明，不等于全部运行时依赖）：`from jiuwenswarm.agents.harness.code.tools.code_todo_tools import CodeTodoC`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/tools/__init__.py#L1-L15)。
- **`jiuwenswarm/agents/harness/code/tools/code_todo_tools.py`**
- 源码对模块职责的说明：Code-mode todo tools with CC-aligned descriptions and schemas.。
- `CodeTodoCreateTool` 继承 `TodoCreateTool`；方法入口：`__init__`。
- `CodeTodoListTool` 继承 `TodoListTool`；方法入口：`__init__`。
- `CodeTodoGetTool` 继承 `TodoGetTool`；方法入口：`__init__`。
- `CodeTodoModifyTool` 继承 `TodoModifyTool`；方法入口：`__init__`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import uuid`；`from typing import Optional`；`from openjiuwen.core.foundation.tool import ToolCard`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/agents/harness/code/tools/code_todo_tools.py#L1-L115)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agents-team/code-tools/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
