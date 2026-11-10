---
name: advanced-daily-report-collectors-contracts-01
description: advanced-daily-report-collectors 源码接口记录 01：advanced-daily-report 的 collectors 包（聚合器与邮件、Git、记忆、待办采集器）；覆盖 __init__.py、aggregator.py、email_collector.py、git_collector.py、memory_collector.py、todo_collector.py
metadata:
  scope: 只收 advanced-daily-report-collectors 下这 6 个源文件的逐文件接口记录；本目录入口归 advanced-daily-report-collectors-overview
---
# advanced-daily-report-collectors 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/__init__.py`**
- 源码对模块职责的说明：进阶版日报生成器 - 数据采集模块。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from .git_collector import GitCollector, GitCommit`；`from .email_collector import EmailCollector, EmailStats`；`from .memory_collector import MemoryCollector`；`from .todo_collector import TodoCollector`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/__init__.py#L1-L28)。
- **`jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py`**
- 源码对模块职责的说明：数据聚合器。
- `CollectedData` 定义类型边界；方法入口：`to_dict`, `to_json`。
- `DataAggregator` 定义类型边界；方法入口：`__init__`, `collect`, `collect_week`, `collect_month`, `collect_for_pattern_analysis`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import json`；`import logging`；`from dataclasses import dataclass, field`；`from datetime import datetime, timedelta`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/aggregator.py#L1-L244)。
- **`jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/email_collector.py`**
- 源码对模块职责的说明：邮件统计采集器。
- `EmailInfo` 定义类型边界；方法入口：`to_dict`。
- `EmailStats` 定义类型边界；方法入口：`to_dict`。
- `EmailCollector` 定义类型边界；方法入口：`__init__`, `connect`, `disconnect`, `get_stats`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import email`；`import logging`；`from dataclasses import dataclass, field`；`from datetime import datetime`。
- 模块级配置或常量名称：`NETEASE_IMAP_SERVERS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/email_collector.py#L1-L276)。
- **`jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/git_collector.py`**
- 源码对模块职责的说明：Git 提交记录采集器。
- `GitCommit` 定义类型边界；方法入口：`to_dict`。
- `GitStats` 定义类型边界；方法入口：`net_lines`, `to_dict`。
- `GitCollector` 定义类型边界；方法入口：`__init__`, `get_commits`, `get_week_commits`, `get_month_commits`, `get_commits_for_pattern_analysis`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import subprocess`；`from dataclasses import dataclass, field`；`from datetime import datetime, timedelta`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/git_collector.py#L1-L272)。
- **`jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/memory_collector.py`**
- 源码对模块职责的说明：记忆数据采集器。
- `MemoryData` 定义类型边界；方法入口：`to_dict`。
- `MemoryCollector` 定义类型边界；方法入口：`__init__`, `collect`, `get_week_memories`, `get_month_memories`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import re`；`from dataclasses import dataclass, field`；`from datetime import datetime, timedelta`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/memory_collector.py#L1-L157)。
- **`jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/todo_collector.py`**
- 源码对模块职责的说明：待办事项采集器。
- `TodoTask` 定义类型边界；方法入口：`to_dict`。
- `TodoStats` 定义类型边界；方法入口：`completion_rate`, `to_dict`。
- `TodoCollector` 定义类型边界；方法入口：`__init__`, `collect`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import re`；`from dataclasses import dataclass, field`；`from datetime import datetime`；`from pathlib import Path`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/collectors/todo_collector.py#L1-L226)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/advanced-daily-report-collectors/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
