---
name: gitcode-api-scripts-contracts-01
description: gitcode-api-scripts 源码接口记录 01：gitcode-api 技能脚本（gitcode_api_cli.py 与 open_github_issue.py）；覆盖 gitcode_api_cli.py、open_github_issue.py
metadata:
  scope: 只收 gitcode-api-scripts 下这 2 个源文件的逐文件接口记录；本目录入口归 gitcode-api-scripts-overview
---
# gitcode-api-scripts 源码接口与集成边界 01

## 现状

- 本页逐文件说明这一源码模块声明的接口、类型与依赖。记录来自静态源码声明，不证明控制流、配置生效、外部服务可用或测试通过；功能语义与设计取舍沿上级功能页继续阅读。
- **`jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/gitcode_api_cli.py`**
- 源码对模块职责的说明：Run the gitcode-api package CLI from this skill.。
- 集成依赖（导入声明，不等于全部运行时依赖）：`from gitcode_api.cli import main`。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/gitcode_api_cli.py#L1-L6)。
- **`jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py`**
- 源码对模块职责的说明：Create a GitHub issue (e.g. feedback for GitCode-API).。
- 调用入口 `main(argv)`；声明返回 `int`。
- 集成依赖（导入声明，不等于全部运行时依赖）：`import argparse`；`from functools import partial`；`import os`；`import sys`。
- 模块级配置或常量名称：`DEFAULT_OWNER`, `DEFAULT_REPO`, `API_VERSION`；实际值与使用条件见源码。
- 源码依据：[完整声明与实现](https://github.com/openJiuwen-ai/jiuwenswarm/blob/f0a69728c96b5961d993449f1a901cbd2f4dac5b/jiuwenswarm/resources/agent/workspace/skills/gitcode-api/scripts/open_github_issue.py#L1-L55)。

## 关键事实

- 源页：`knowledge/repos/jiuwenswarm/components/config-resources/gitcode-api-scripts/source-contracts-01.md`（InferMatrixCopilot@ecfb84d0）；type: architecture；tags: jiuwenswarm；created: 2026-10-01；updated: 2026-10-01
