---
name: control-store-contracts-01
description: control-store 源码接口与集成边界 01：control/store/project_queries.py 的 attribute_session_project、project_info_payload、split_project_ids、load_project_info 等纯磁盘项目查询声明
metadata:
  scope: 只收 control/store 下 project_queries.py 一个模块的静态声明，不证明运行行为；入口说明归 control-store-overview
---
# control-store 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/server/control/store/project_queries.py`**
- 源码对模块职责的说明：Disk-only project list/info/session queries. No ProjectAdapter or git CLI.。
- 调用入口 `attribute_session_project(metadata, visible_project_ids, removed_project_ids)`；声明返回 `str`。
- 调用入口 `project_info_payload(project, default_id, stats)`；声明返回 `dict[str, Any]`。
- 调用入口 `split_project_ids(projects)`；声明返回 `tuple[set[str], set[str]]`。
- 调用入口 `load_project_info(params)`；声明返回 `tuple[dict[str, Any] / None, str / None, str / None]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import logging`；`from typing import Any`；`from jiuwenswarm.common.cron_session import cron_session_matches_job`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/server/control/store/project_queries.py#L1-L434)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/agent-server-runtime/control-store/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
