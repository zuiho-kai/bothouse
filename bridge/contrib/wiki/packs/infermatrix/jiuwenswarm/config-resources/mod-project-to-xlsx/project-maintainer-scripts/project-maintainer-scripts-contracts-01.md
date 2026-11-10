---
name: project-maintainer-scripts-contracts-01
description: project-maintainer-scripts 源码接口记录 01：project-maintainer 技能脚本（审计完整性、文档体积检查、符号清点、审计报告渲染）；覆盖 audit_integrity.py、check_doc_sizes.py、inventory_symbols.py、render_audit_report.py
metadata:
  scope: 只收 project-maintainer-scripts 下这 4 个源文件的逐文件接口记录；本目录入口归 project-maintainer-scripts-overview
---
# project-maintainer-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py`**
- 源码对模块职责的说明：Promote and verify project-maintainer symbol audit integrity metadata.。
- `AuditIntegrityError` 继承 `Exception`。
- 调用入口 `utc_now()`；声明返回 `str`。
- 调用入口 `canonical_json(value)`；声明返回 `str`。
- 调用入口 `sha256_bytes(data)`；声明返回 `str`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`from copy import deepcopy`；`from datetime import datetime, timezone`。
- 模块级配置或常量名称：`ALLOWED_AUDIT_STATUSES`, `AGENT_TRUST_RESULTS`, `DEFAULT_SCOPE`, `DEFAULT_SIGNING_KEY_ENV`, `DEFAULT_KEY_ID`, `GENERATED_BY`, `CANONICALIZATION`, `INTEGRITY_SCHEMA`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/audit_integrity.py#L1-L716)。
- **`jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/check_doc_sizes.py`**
- 源码对模块职责的说明：Check .doc_project_maintainer files against path-based size budgets.。
- 调用入口 `limit_for(relative_path)`；声明返回 `int`。
- 调用入口 `main()`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`from pathlib import Path`；`import sys`。
- 模块级配置或常量名称：`DEFAULT_LIMIT_KB`, `CODE_DETAIL_DOCS`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/check_doc_sizes.py#L1-L103)。
- **`jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/inventory_symbols.py`**
- 源码对模块职责的说明：Inventory source symbols for project-maintainer coverage audits.。
- 调用入口 `posix(path)`；声明返回 `str`。
- 调用入口 `file_hash(path)`；声明返回 `str`。
- 调用入口 `read_text(path)`；声明返回 `tuple[str / None, str / None]`。
- 调用入口 `git_ls_files(root)`；声明返回 `list[Path] / None`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`import ast`；`from datetime import datetime, timezone`。
- 模块级配置或常量名称：`SOURCE_EXTENSIONS`, `EXCLUDED_PARTS`, `GENERATED_NAME_PATTERNS`, `MULTI_AGENT_SOURCE_FILE_THRESHOLD`, `MULTI_AGENT_SYMBOL_THRESHOLD`, `MODULE_SYMBOL_THRESHOLD`, `MAX_SYMBOLS_PER_SLICE`, `AUDIT_STATUSES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/inventory_symbols.py#L1-L1828)。
- **`jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py`**
- 源码对模块职责的说明：Render a self-contained Project Maintainer audit visualization report.。
- `AuditReportError` 继承 `Exception`。
- 调用入口 `utc_now()`；声明返回 `str`。
- 调用入口 `read_json(path, label)`；声明返回 `dict[str, Any]`。
- 调用入口 `resolve_paths(args)`；声明返回 `dict[str, Path]`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from __future__ import annotations`；`import argparse`；`from datetime import datetime, timezone`；`import json`。
- 模块级配置或常量名称：`DEFAULT_ARTIFACT_ROOT`, `DEFAULT_SCOPE`, `ALL_SCOPE`, `SEVERITY_SCORE`, `HEALTH_RISK_VALUES`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/project-maintainer/scripts/render_audit_report.py#L1-L559)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/project-maintainer-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
