---
name: advanced-daily-report-contracts-01
description: advanced-daily-report 源码接口记录 01：advanced-daily-report 技能的日报辅助脚本 report_helper.py 与入口脚本 run_report.py；覆盖 report_helper.py、run_report.py
metadata:
  scope: 只收 advanced-daily-report 下这 2 个源文件的逐文件接口记录；本目录入口归 advanced-daily-report-overview
---
# advanced-daily-report 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/report_helper.py`**
- 源码对模块职责的说明：日报生成器辅助脚本。
- 调用入口 `get_workspace_dir()`；声明返回 `Path`。
- 调用入口 `read_file_safe(file_path)`；声明返回 `str`。
- 调用入口 `parse_todo_status(content)`；声明返回 `dict[str, list[dict]]`。
- 调用入口 `extract_work_summary(content)`；声明返回 `list[str]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import io`；`import json`；`import os`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/report_helper.py#L1-L302)。
- **`jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py`**
- 源码对模块职责的说明：日报/周报/月报生成入口脚本（独立版）。
- 调用入口 `collect_git_stats(date)`；声明返回 `dict`。
- 调用入口 `collect_email_stats(date)`；声明返回 `dict`。
- 调用入口 `collect_email_content(limit, days)`；声明返回 `list`。
- 调用入口 `generate_daily_report(date, enable_ai)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`import io`；`import os`；`import re`。
- 模块级配置或常量名称：`SKILL_DIR`, `PACKAGE_ROOT`, `REPO_ROOT`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/advanced-daily-report/run_report.py#L1-L800)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/advanced-daily-report/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
